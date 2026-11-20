#!/usr/bin/env python3
"""
alac2flac: convert Apple Lossless (ALAC) .m4a files to FLAC, bit-perfect, offline.

Both formats are lossless, so the audio does not change: every converted file is decoded again and its samples are compared
with the original's (SHA-256 of the samples at 32-bit precision, so 24-bit audio is checked in full). A file only counts as
converted when they are identical. Tags and the cover are copied. AAC .m4a files (lossy) are skipped: turning them into
FLAC would only make them bigger.

Needs ffmpeg and ffprobe (any recent version). Python 3.8+, standard library only.

  alac2flac.py                                 text interface: pick a folder, choose files, convert
  alac2flac.py [FOLDER or FILE ...]            text interface, starting with those files
  alac2flac.py FOLDER --yes [options]          no interface: convert and print a summary (for scripts)
  alac2flac.py FOLDER --dry-run                show what would happen, change nothing

Options:
  --output DIR          write the FLAC files into DIR (same subfolders) instead of next to the originals
  --originals MODE      after a verified conversion: keep (default), move:DIR (same subfolders), delete
  --overwrite           replace FLAC files that already exist (default: skip them)
  --jobs N              files converted at the same time (default: number of CPUs, at most 8)
  --compression N       FLAC compression 0-12 (default 8; only size and speed change, never the sound)
"""

import argparse
import concurrent.futures
import curses
import datetime
import hashlib
import json
import locale
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

AUDIO_EXTENSIONS = ('.m4a', '.mp4', '.alac', '.caf')
PROBE_TIMEOUT = 60
CONVERT_TIMEOUT = 60 * 60


# ---------------------------------------------------------------------------------------------------------------- core


class Track:
    """One source file and what happened to it."""

    def __init__(self, path, root):
        self.path = path
        self.root = root
        self.selected = True
        self.codec = None  # 'alac', 'aac', ... or None while unknown
        self.bits = 0
        self.rate = 0
        self.channels = 0
        self.size = 0
        self.status = 'waiting'  # waiting, probing, ready, skip, working, done, failed, exists
        self.message = ''
        self.output = None
        self.tags = {}  # lower-case tag name -> value (title, artist, album_artist, album, date, track, disc)
        self.planned = None  # target chosen before converting (layouts that can give two songs the same name)

    @property
    def is_alac(self):
        return self.codec == 'alac'

    def describe(self):
        if self.codec is None:
            return '…'
        if not self.is_alac:
            return f'{self.codec.upper()} (lossy), skipped' if self.codec in ('aac', 'mp3', 'opus', 'vorbis') else f'{self.codec}, skipped'
        return f'ALAC {self.bits}-bit {self.rate / 1000:g} kHz {channel_name(self.channels)}'


def channel_name(channels):
    return {1: 'mono', 2: 'stereo'}.get(channels, f'{channels} ch')


def short_path(path, limit=50):
    """~ for the home folder, and the end of long paths (the part that tells folders apart)."""
    home = os.path.expanduser('~')
    if path == home or path.startswith(home + os.sep):
        path = '~' + path[len(home):]
    return path if len(path) <= limit else '…' + path[-(limit - 1):]


def human_size(size):
    for unit in ('B', 'KB', 'MB', 'GB'):
        if size < 1024 or unit == 'GB':
            return f'{size:.0f} {unit}' if unit == 'B' else f'{size:.1f} {unit}'
        size /= 1024


def ffmpeg_path(name):
    """file: keeps names that start with '-' or contain ':' from being read as options or protocols."""
    return 'file:' + os.path.abspath(name)


def check_tools():
    missing = [tool for tool in ('ffmpeg', 'ffprobe') if shutil.which(tool) is None]
    if missing:
        raise SystemExit(f"alac2flac needs {' and '.join(missing)}. Install ffmpeg (for example: sudo apt install ffmpeg).")


def find_files(paths):
    """All candidate files under the given files and folders, sorted, each once. Symlinked folders are not followed."""
    found = {}
    for given in paths:
        given = os.path.abspath(os.path.expanduser(given))
        if os.path.isfile(given):
            if given.lower().endswith(AUDIO_EXTENSIONS):
                found.setdefault(given, Track(given, os.path.dirname(given)))
            continue
        for folder, subfolders, files in os.walk(given, onerror=lambda e: None):
            subfolders.sort()
            for name in sorted(files):
                if name.lower().endswith(AUDIO_EXTENSIONS) and not name.startswith('._'):  # ._ = macOS resource forks
                    path = os.path.join(folder, name)
                    if os.path.isfile(path):
                        found.setdefault(path, Track(path, given))
    return sorted(found.values(), key=lambda t: t.path.lower())


def probe(track):
    """Fills codec, bit depth, sample rate and channels of the first audio stream. Never raises."""
    try:
        track.size = os.path.getsize(track.path)
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries',
             'stream=codec_name,sample_fmt,bits_per_raw_sample,bits_per_sample,sample_rate,channels:format_tags', '-of', 'json',
             ffmpeg_path(track.path)],
            capture_output=True, timeout=PROBE_TIMEOUT, check=False,
        )
        data = json.loads(result.stdout or b'{}')
        streams = data.get('streams') or []
        tags = (data.get('format') or {}).get('tags') or {}
        track.tags = {str(k).lower(): str(v) for k, v in tags.items() if isinstance(v, (str, int, float))}
        if not streams:
            track.codec = 'none'
            track.status = 'skip'
            track.message = 'no audio (not a music file, or damaged)'
            return
        stream = streams[0]
        track.codec = stream.get('codec_name') or 'unknown'
        track.rate = int(stream.get('sample_rate') or 0)
        track.channels = int(stream.get('channels') or 0)
        bits = int(stream.get('bits_per_raw_sample') or 0)
        if bits == 0:
            bits = {'s16': 16, 's16p': 16, 's32': 32, 's32p': 32}.get(stream.get('sample_fmt'), 0)
        track.bits = bits
        if track.is_alac:
            track.status = 'ready'
        else:
            track.status = 'skip'
            track.message = 'not Apple Lossless'
            track.selected = False
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        track.codec = 'none'
        track.status = 'skip'
        track.selected = False
        track.message = f'cannot read: {error}'


LAYOUTS = ('folders', 'tags')
FALLBACK_ARTIST, FALLBACK_ALBUM = 'Unknown Artist', 'Unknown Album'
MAXIMUM_NAME_BYTES = 180


def safe_name(text, fallback):
    """A tag value as one file or folder name (Linux). Never a path: '/' and '..' cannot leave the output folder.
    Only what Linux forbids is changed, so names like "Album: Part 2?" stay as they are."""
    text = ''.join(c for c in str(text or '') if ord(c) >= 32 and c != '\x7f')
    for c in '/':
        text = text.replace(c, '-')
    text = ' '.join(text.split()).strip(' .')
    if not text or set(text) <= {'.', '_', '-', ' '}:
        text = fallback
    while len(text.encode('utf-8')) > MAXIMUM_NAME_BYTES:
        text = text[:-1]
    return text.rstrip(' .') or fallback


def tag_number(value):
    """'3', '03', '3/10' -> 3; anything else -> 0."""
    head = str(value or '').split('/')[0].strip()
    # Only 0-9: isdigit() also accepts other scripts' digits ("٣") and superscripts ("³"), which int() may not read as meant.
    return int(head) if head and len(head) <= 4 and all(c in '0123456789' for c in head) else 0


def tag_path(track):
    """Artist/Year - Album/NN Title.flac from the tags (disc number first when the album has more than one disc)."""
    tags = track.tags
    artist = safe_name(tags.get('album_artist') or tags.get('albumartist') or tags.get('artist'), FALLBACK_ARTIST)
    album = safe_name(tags.get('album'), FALLBACK_ALBUM)
    year = str(tags.get('date') or tags.get('year') or '')[:4]
    if len(year) == 4 and all(c in '0123456789' for c in year):
        album = safe_name(f'{year} - {album}', FALLBACK_ALBUM)
    title = safe_name(tags.get('title'), safe_name(os.path.splitext(os.path.basename(track.path))[0], 'Track'))
    number = tag_number(tags.get('track'))
    disc = tag_number(tags.get('disc'))
    discs = tag_number(str(tags.get('disc') or '').split('/')[1] if '/' in str(tags.get('disc') or '') else '')
    prefix = ''
    if number:
        prefix = f'{disc}-{number:02} ' if disc and (discs > 1 or disc > 1) else f'{number:02} '
    name = safe_name(prefix + title, 'Track')
    return os.path.join(artist, album, name + '.flac')


def output_path(track, output_dir, layout='folders'):
    if layout == 'tags' and output_dir is not None:
        return os.path.join(os.path.abspath(output_dir), tag_path(track))
    base = os.path.splitext(os.path.basename(track.path))[0] + '.flac'
    if output_dir is None:
        return os.path.join(os.path.dirname(track.path), base)
    relative = os.path.relpath(os.path.dirname(track.path), track.root)
    return os.path.normpath(os.path.join(os.path.abspath(output_dir), relative, base))


def plan_targets(tracks, options):
    """Fixes every target before converting, so two songs that would get the same name get "(2)", "(3)" instead of
    overwriting each other (with files converted at the same time, this cannot be left to chance)."""
    used = set()
    for track in tracks:
        track.planned = None
        target = output_path(track, options.output, getattr(options, 'layout', 'folders'))
        stem, extension = os.path.splitext(target)
        n = 2
        while target.lower() in used:
            target = f'{stem} ({n}){extension}'
            n += 1
        used.add(target.lower())
        track.planned = target


def audio_hash(path):
    """SHA-256 of the decoded samples at 32-bit precision (16 and 24-bit audio are both checked in full)."""
    process = subprocess.Popen(
        ['ffmpeg', '-v', 'error', '-nostdin', '-i', ffmpeg_path(path), '-map', '0:a:0', '-c:a', 'pcm_s32le', '-f', 's32le', '-'],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    digest = hashlib.sha256()
    samples = 0
    for chunk in iter(lambda: process.stdout.read(1 << 20), b''):
        digest.update(chunk)
        samples += len(chunk)
    error = process.stderr.read().decode(errors='replace').strip()
    if process.wait(timeout=CONVERT_TIMEOUT) != 0:
        raise RuntimeError(f'could not decode {os.path.basename(path)}: {error[-300:]}')
    return digest.hexdigest(), samples


def flac_command(source, target, compression, with_cover):
    command = ['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', ffmpeg_path(source), '-map', '0:a:0']
    if with_cover:
        command += ['-map', '0:v?', '-c:v', 'copy', '-disposition:v', 'attached_pic']
    return command + ['-map_metadata', '0', '-c:a', 'flac', '-compression_level', str(compression), ffmpeg_path(target)]


def convert(track, options, cancel=None):
    """Converts and verifies one track. Sets track.status to done, exists or failed. Never raises."""
    try:
        target = track.planned or output_path(track, options.output, getattr(options, 'layout', 'folders'))
        track.output = target
        if os.path.exists(target) and not options.overwrite:
            track.status = 'exists'
            track.message = 'a FLAC file with this name already exists'
            return
        os.makedirs(os.path.dirname(target), exist_ok=True)

        # Write next to the target under a temporary name, so a half-written file never has the real name.
        handle, partial = tempfile.mkstemp(prefix='.alac2flac-', suffix='.flac', dir=os.path.dirname(target))
        os.close(handle)
        try:
            result = subprocess.run(flac_command(track.path, partial, options.compression, True), capture_output=True, timeout=CONVERT_TIMEOUT, check=False)
            if result.returncode != 0:
                # Some covers cannot be copied into FLAC: try once more without the cover rather than fail.
                result = subprocess.run(flac_command(track.path, partial, options.compression, False), capture_output=True, timeout=CONVERT_TIMEOUT, check=False)
                if result.returncode != 0:
                    raise RuntimeError(result.stderr.decode(errors='replace').strip()[-300:] or 'ffmpeg failed')
                track.message = 'cover could not be copied'
            if cancel is not None and cancel.is_set():
                raise RuntimeError('cancelled')

            source_hash, source_bytes = audio_hash(track.path)
            flac_hash, flac_bytes = audio_hash(partial)
            if source_bytes == 0:
                raise RuntimeError('the original has no audio samples')
            if source_hash != flac_hash or source_bytes != flac_bytes:
                raise RuntimeError('verification failed: the FLAC audio is not identical (nothing was replaced)')

            os.replace(partial, target)
        finally:
            if os.path.exists(partial):
                os.remove(partial)

        track.status = 'done'
        track.message = ('verified identical; ' + track.message).rstrip('; ')
        handle_original(track, options)
    except Exception as error:  # one bad file must never stop the others
        track.status = 'failed'
        track.message = str(error).splitlines()[-1] if str(error) else type(error).__name__


def handle_original(track, options):
    mode = options.originals
    if mode == 'keep':
        return
    if mode == 'delete':
        os.remove(track.path)
        track.message += '; original deleted'
        return
    if mode.startswith('move:'):
        folder = os.path.abspath(os.path.expanduser(mode[5:]))
        relative = os.path.relpath(track.path, track.root)
        destination = os.path.join(folder, relative)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        if os.path.exists(destination):
            raise RuntimeError(f'original kept: {destination} already exists')
        shutil.move(track.path, destination)
        track.message += '; original moved'


def run_all(tracks, options, on_change=None, cancel=None):
    todo = [t for t in tracks if t.selected and t.is_alac]
    plan_targets(todo, options)
    for track in todo:
        track.status = 'queued'

    def work(track):
        if cancel is not None and cancel.is_set():
            track.status, track.message = 'failed', 'cancelled'
            return
        track.status = 'working'
        if on_change:
            on_change()
        convert(track, options, cancel)
        if on_change:
            on_change()

    with concurrent.futures.ThreadPoolExecutor(max_workers=options.jobs) as pool:
        list(pool.map(work, todo))
    return todo


def write_log(tracks, options):
    name = f"alac2flac-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
    path = os.path.join(options.log_dir or os.getcwd(), name)
    try:
        with open(path, 'w', encoding='utf-8') as log:
            for t in tracks:
                if t.status in ('done', 'failed', 'exists', 'skip'):
                    log.write(f'{t.status.upper():8} {t.path}\n         -> {t.output or "-"}  {t.message}\n')
        return path
    except OSError:
        return None


def summary(tracks):
    count = lambda status: sum(1 for t in tracks if t.status == status)
    return {'converted': count('done'), 'failed': count('failed'), 'already there': count('exists'), 'skipped': count('skip')}


def validate_options(options):
    if options.originals not in ('keep', 'delete') and not options.originals.startswith('move:'):
        raise SystemExit('--originals must be keep, delete or move:FOLDER')
    if options.originals.startswith('move:') and not options.originals[5:].strip():
        raise SystemExit('--originals move: needs a folder, for example move:~/alac-backup')
    if getattr(options, 'layout', 'folders') not in LAYOUTS:
        raise SystemExit('--layout must be folders or tags')
    if getattr(options, 'layout', 'folders') == 'tags' and not options.output:
        raise SystemExit('--layout tags needs --output: the sorted copy goes into its own folder, not between your originals')
    if not 0 <= options.compression <= 12:
        raise SystemExit('--compression must be between 0 and 12')
    options.jobs = max(1, min(options.jobs, 32))


# ---------------------------------------------------------------------------------------------------------------- text interface

ORIGINAL_MODES = ['keep', 'move', 'delete']


class Interface:
    def __init__(self, screen, tracks, options, folder=None, message=''):
        self.screen = screen
        self.tracks = tracks
        self.options = options
        self.cursor = 0
        self.top = 0
        # browse (pick a folder), list (choose files), running, finished
        self.mode = 'list' if tracks else 'browse'
        self.message = message
        self.folder = os.path.abspath(os.path.expanduser(folder or os.getcwd()))
        self.entries = []
        self.searching = False
        # What the browser is picking: 'source' (music to convert), 'output' (where the FLAC files go), 'originals' (where
        # originals are moved after a verified conversion).
        self.purpose = 'source'
        if self.mode == 'browse':
            self.open_folder(self.folder)
        self.lock = threading.Lock()
        self.cancel = threading.Event()
        self.started = None
        self.log_path = None

    # drawing helpers
    def put(self, y, x, text, attribute=0):
        height, width = self.screen.getmaxyx()
        if 0 <= y < height and x < width:
            try:
                self.screen.addnstr(y, x, text, max(0, width - x - 1), attribute)
            except curses.error:
                pass

    def color(self, n):
        return curses.color_pair(n) if curses.has_colors() else 0

    def draw(self):
        with self.lock:
            self.screen.erase()
            height, width = self.screen.getmaxyx()
            if height < 10 or width < 50:
                self.put(0, 0, 'Window too small (needs 50 x 10)')
                self.screen.refresh()
                return
            self.put(0, 0, ' ALAC → FLAC  ·  bit-perfect, verified  ·  offline '.ljust(width), curses.A_REVERSE | curses.A_BOLD)
            if self.mode == 'browse':
                self.draw_browser(height, width)
                self.put(height - 2, 0, ' ' + self.message)
                self.put(height - 1, 0, self.help_text().ljust(width), curses.A_REVERSE)
                self.screen.refresh()
                return
            alac = [t for t in self.tracks if t.is_alac]
            chosen = [t for t in alac if t.selected]
            probing = sum(1 for t in self.tracks if t.codec is None)
            info = f' {len(self.tracks)} files · {len(alac)} Apple Lossless · {len(chosen)} chosen ({human_size(sum(t.size for t in chosen))})'
            if probing:
                info += f' · reading {probing}…'
            self.put(1, 0, info, curses.A_BOLD)
            out = 'next to the originals' if self.options.output is None else short_path(self.options.output, max(20, width // 3))
            orig = 'move to ' + short_path(self.options.originals[5:], max(20, width // 4)) if self.options.originals.startswith('move:') else self.options.originals
            layout = 'Artist/Album from tags' if self.options.layout == 'tags' else 'same as source'
            self.put(2, 0, f' Output: {out}   Folders: {layout}   Originals: {orig}   Existing FLAC: {"replace" if self.options.overwrite else "skip"}   Jobs: {self.options.jobs}')

            list_top, list_height = 4, height - 7
            if self.mode == 'list':
                self.cursor = max(0, min(self.cursor, len(self.tracks) - 1))
            if self.cursor < self.top:
                self.top = self.cursor
            if self.cursor >= self.top + list_height:
                self.top = self.cursor - list_height + 1
            for row, track in enumerate(self.tracks[self.top:self.top + list_height]):
                index = self.top + row
                mark = '[x]' if track.selected and track.is_alac else ('[ ]' if track.is_alac else ' - ')
                status, attribute = self.status_text(track)
                name = os.path.relpath(track.path, track.root)
                right = f' {status} '
                left_width = max(10, width - len(right) - 32)
                line = f' {mark} {name[-left_width:]:<{left_width}} {track.describe()[:30]:<30}'
                highlight = curses.A_REVERSE if index == self.cursor and self.mode == 'list' else 0
                self.put(list_top + row, 0, line, highlight)
                self.put(list_top + row, width - len(right) - 1, right, attribute | highlight)

            if self.mode != 'list':
                self.draw_progress(height - 3, width)
            message = self.message
            if not message and self.mode == 'list' and self.tracks and self.options.output:
                track = self.tracks[self.cursor]
                if track.is_alac:
                    target = output_path(track, self.options.output, self.options.layout)
                    message = '→ ' + os.path.relpath(target, self.options.output)
            self.put(height - 2, 0, ' ' + message)
            self.put(height - 1, 0, self.help_text().ljust(width), curses.A_REVERSE)
            self.screen.refresh()

    BROWSER_TITLES = {
        'source': ' Pick the folder with your Apple Lossless (.m4a) music. Subfolders are searched too.',
        'output': ' Pick the folder for the FLAC files (the subfolders of your music are made inside it).',
        'originals': ' Pick the folder the originals are moved to, after their FLAC is verified.',
    }

    def draw_browser(self, height, width):
        title = self.BROWSER_TITLES[self.purpose]
        if self.purpose == 'output' and self.options.layout == 'tags':
            title = ' Pick the folder for the FLAC files (Artist / Album folders are made inside it, from the tags).'
        self.put(1, 0, title, curses.A_BOLD)
        self.put(2, 0, f' {short_path(self.folder, width - 3)}', self.color(4))
        list_top, list_height = 4, height - 7
        self.cursor = max(0, min(self.cursor, len(self.entries) - 1))
        if self.cursor < self.top:
            self.top = self.cursor
        if self.cursor >= self.top + list_height:
            self.top = self.cursor - list_height + 1
        for row, (kind, label, _) in enumerate(self.entries[self.top:self.top + list_height]):
            index = self.top + row
            text = {
                'search': f' ▶ {label}', 'choose': f' ✓ {label}', 'beside': f' ↺ {label}',
                'up': '  ↑ .. (parent folder)', 'dir': f'  ▸ {label}/',
            }[kind]
            attribute = curses.A_BOLD if kind in ('search', 'choose', 'beside') else 0
            if index == self.cursor:
                attribute |= curses.A_REVERSE
            self.put(list_top + row, 0, text.ljust(width - 1), attribute)

    def open_folder(self, folder):
        """Shows a folder in the browser: a 'search here' line, the parent, then the subfolders."""
        folder = os.path.abspath(os.path.expanduser(folder))
        try:
            names = sorted(os.listdir(folder), key=str.lower)
        except OSError as error:
            self.message = f'Cannot open {folder}: {error.strerror or error}'
            return
        here = sum(1 for n in names if n.lower().endswith(AUDIO_EXTENSIONS))
        subfolders = [n for n in names if not n.startswith('.') and os.path.isdir(os.path.join(folder, n))]
        self.folder = folder
        if self.purpose == 'source':
            label = f'Search this folder ({here} .m4a here' + (', and its subfolders)' if subfolders else ')')
            self.entries = [('search', label, folder)]
        else:
            self.entries = [('choose', 'Use this folder', folder)]
            if self.purpose == 'output':
                self.entries.append(('beside', 'Next to the originals (no output folder)', None))
        if os.path.dirname(folder) != folder:
            self.entries.append(('up', '..', os.path.dirname(folder)))
        self.entries += [('dir', n, os.path.join(folder, n)) for n in subfolders]
        self.cursor, self.top = 0, 0

    def search(self, folder):
        if self.searching:
            return
        self.searching = True
        self.message = f'Searching {folder} …'

        def worker():
            found = find_files([folder])
            self.searching = False
            if not found:
                self.message = f'No .m4a files in {folder} or its subfolders. Pick another folder.'
                return
            with self.lock:
                self.tracks = found
                self.cursor, self.top = 0, 0
                self.mode = 'list'
                self.message = ''
            threading.Thread(target=self.probe_all, daemon=True).start()

        threading.Thread(target=worker, daemon=True).start()

    def browse_key(self, key):
        if key in (curses.KEY_UP, ord('k')):
            self.cursor = max(0, self.cursor - 1)
        elif key in (curses.KEY_DOWN, ord('j')):
            self.cursor = min(len(self.entries) - 1, self.cursor + 1)
        elif key == curses.KEY_PPAGE:
            self.cursor = max(0, self.cursor - 10)
        elif key == curses.KEY_NPAGE:
            self.cursor = min(len(self.entries) - 1, self.cursor + 10)
        elif key in (curses.KEY_BACKSPACE, 127, 8, curses.KEY_LEFT, ord('h')):
            self.open_folder(os.path.dirname(self.folder))
        elif key in (10, 13, curses.KEY_ENTER, curses.KEY_RIGHT, ord('l')) and self.entries:
            kind, _, path = self.entries[self.cursor]
            if kind == 'search':
                self.search(path)
            elif kind in ('choose', 'beside'):
                self.choose_folder(path)
            else:
                self.open_folder(path)
        elif key in (ord('s'), ord('S')):
            if self.purpose == 'source':
                self.search(self.folder)
            else:
                self.choose_folder(self.folder)
        elif key in (ord('m'), ord('M')) and self.purpose != 'source':
            name = self.ask('Name of the new folder:', '')
            if name:
                path = os.path.join(self.folder, os.path.expanduser(name))
                try:
                    os.makedirs(path, exist_ok=True)
                    self.open_folder(path)
                except OSError as error:
                    self.message = f'Cannot make {path}: {error.strerror or error}'
        elif key in (ord('g'), ord('G'), ord('~'), ord('/')):
            typed = self.ask('Go to folder:', '')
            if typed:
                self.open_folder(typed)

    def pick_folder(self, purpose):
        """Opens the browser to pick the output folder or the folder for the originals."""
        self.return_cursor = self.cursor
        self.purpose = purpose
        self.mode = 'browse'
        self.message = ''
        current = self.options.output if purpose == 'output' else self.options.originals[5:] if self.options.originals.startswith('move:') else None
        start = current if current and os.path.isdir(current) else self.source_folder()
        self.open_folder(start)

    def source_folder(self):
        roots = sorted({t.root for t in self.tracks})
        return roots[0] if roots else self.folder

    def choose_folder(self, path):
        """The folder was picked: store it and go back to the file list."""
        sources = {os.path.abspath(t.root) for t in self.tracks}
        if self.purpose == 'output':
            if path is None and self.options.layout == 'tags':
                self.options.layout = 'folders'
            self.options.output = path
            self.message = 'The FLAC files go next to the originals.' if path is None else f'The FLAC files go to {path}'
            if path is not None and os.path.abspath(path) in sources:
                self.options.output = None
                self.message = 'That is the music folder itself: the FLAC files go next to the originals.'
            elif path is not None and any(os.path.abspath(path).startswith(root + os.sep) for root in sources):
                self.message += ' (inside the music folder: Dopamine will also find these)'
        elif self.purpose == 'originals':
            if os.path.abspath(path) in sources:
                self.message = 'The originals cannot be moved into the music folder itself. Pick another folder.'
                return
            self.options.originals = f'move:{path}'
            self.message = f'Originals are moved to {path} after their FLAC is verified.'
        self.leave_browser()

    def cancel_browser(self):
        self.message = 'Nothing changed.'
        if self.options.layout == 'tags' and self.options.output is None:
            self.options.layout = 'folders'
            self.message = 'No output folder picked: folders stay the same as in the source.'
        self.leave_browser()

    def leave_browser(self):
        self.purpose = 'source'
        self.mode = 'list'
        self.cursor = getattr(self, 'return_cursor', 0)
        self.top = 0

    def status_text(self, track):
        return {
            'waiting': ('', 0),
            'ready': ('', 0),
            'skip': ('skipped', self.color(3)),
            'queued': ('queued', 0),
            'working': ('converting…', self.color(4) | curses.A_BOLD),
            'done': ('✓ verified', self.color(1) | curses.A_BOLD),
            'exists': ('exists, skipped', self.color(3)),
            'failed': ('✗ failed', self.color(2) | curses.A_BOLD),
        }.get(track.status, (track.status, 0))

    def draw_progress(self, y, width):
        jobs = [t for t in self.tracks if t.status in ('queued', 'working', 'done', 'failed', 'exists')]
        finished = sum(1 for t in jobs if t.status in ('done', 'failed', 'exists'))
        total = max(1, len(jobs))
        bar_width = max(10, width - 40)
        filled = int(bar_width * finished / total)
        elapsed = time.time() - (self.started or time.time())
        self.put(y, 0, f' [{"█" * filled}{"░" * (bar_width - filled)}] {finished}/{len(jobs)}  {elapsed:.0f}s', self.color(4))

    def help_text(self):
        if self.mode == 'browse' and self.purpose != 'source':
            return ' ↑↓ move  enter open  ← back  s use this folder  m new folder  g type a path  q cancel'
        if self.mode == 'browse':
            return ' ↑↓ move  enter open  ← back  s search this folder  g type a path  q quit'
        if self.mode == 'list':
            return ' ↑↓ move  space choose  a all  n none  o output  l layout  r originals  e existing  +/- jobs  b folders  enter convert  q quit'
        if self.mode == 'running':
            return ' Converting… press c to stop after the files that are being converted'
        return ' Done. ↑↓ scroll through the results, f show failed, q quit'

    # input helpers
    def ask(self, question, default=''):
        height, width = self.screen.getmaxyx()
        curses.echo()
        curses.curs_set(1)
        self.screen.timeout(-1)  # wait for the answer (the main loop polls every 150 ms)
        self.put(height - 2, 0, ' ' * (width - 1))
        self.put(height - 2, 0, f' {question} ')
        try:
            raw = self.screen.getstr(height - 2, min(width - 2, len(question) + 2), 400)
            answer = raw.decode(errors='replace').strip()
        except curses.error:
            answer = ''
        finally:
            curses.noecho()
            curses.curs_set(0)
            self.screen.timeout(150)
        return answer or default

    # main loop
    def run(self):
        curses.curs_set(0)
        if curses.has_colors():
            curses.start_color()
            curses.use_default_colors()
            for n, c in ((1, curses.COLOR_GREEN), (2, curses.COLOR_RED), (3, curses.COLOR_YELLOW), (4, curses.COLOR_CYAN)):
                curses.init_pair(n, c, -1)
        self.screen.timeout(150)

        if self.tracks:
            threading.Thread(target=self.probe_all, daemon=True).start()

        while True:
            self.draw()
            key = self.screen.getch()
            if key == -1:
                continue
            if key == curses.KEY_RESIZE:
                continue
            if self.mode == 'running':
                if key in (ord('c'), ord('C')):
                    self.cancel.set()
                    self.message = 'Stopping after the files that are being converted…'
                continue
            if key in (ord('q'), ord('Q'), 27) and self.mode == 'browse' and self.purpose != 'source':
                self.cancel_browser()
                continue
            if key in (ord('q'), ord('Q'), 27):
                if self.mode in ('finished', 'browse') or self.ask('Quit? (y/n)', 'n').lower().startswith('y'):
                    return
                continue
            if self.mode == 'browse':
                self.browse_key(key)
                continue
            if key in (curses.KEY_UP, ord('k')):
                self.cursor = max(0, self.cursor - 1)
            elif key in (curses.KEY_DOWN, ord('j')) and self.mode == 'finished':
                self.cursor = min(len(self.tracks) - 1, self.cursor + 1)
            elif key == curses.KEY_DOWN:
                self.cursor = min(len(self.tracks) - 1, self.cursor + 1)
            elif key == curses.KEY_PPAGE:
                self.cursor = max(0, self.cursor - 10)
            elif key == curses.KEY_NPAGE:
                self.cursor = min(len(self.tracks) - 1, self.cursor + 10)
            elif self.mode == 'finished' and key in (ord('f'), ord('F')):
                failed = [i for i, t in enumerate(self.tracks) if t.status == 'failed']
                if failed:
                    after = [i for i in failed if i > self.cursor]
                    self.cursor = (after or failed)[0]
                    self.message = self.tracks[self.cursor].message
            elif self.mode == 'list':
                self.list_key(key)

    def list_key(self, key):
        track = self.tracks[self.cursor] if self.tracks else None
        if key == ord(' ') and track is not None:
            if track.is_alac:
                track.selected = not track.selected
                self.cursor = min(len(self.tracks) - 1, self.cursor + 1)
            else:
                self.message = track.message or 'Only Apple Lossless files can be converted.'
        elif key in (ord('a'), ord('A')):
            for t in self.tracks:
                t.selected = t.is_alac
        elif key in (ord('n'), ord('N')):
            for t in self.tracks:
                t.selected = False
        elif key in (ord('o'), ord('O')):
            self.pick_folder('output')
        elif key in (ord('r'), ord('R')):
            current = 'move' if self.options.originals.startswith('move:') else self.options.originals
            mode = ORIGINAL_MODES[(ORIGINAL_MODES.index(current) + 1) % len(ORIGINAL_MODES)]
            if mode == 'move':
                self.options.originals = 'keep'  # until a folder is picked
                self.pick_folder('originals')
            elif mode == 'delete':
                sure = self.ask('Delete each original after its FLAC is verified? Type delete to confirm:', '')
                self.options.originals = 'delete' if sure == 'delete' else 'keep'
            else:
                self.options.originals = 'keep'
        elif key in (ord('e'), ord('E')):
            self.options.overwrite = not self.options.overwrite
        elif key in (ord('l'), ord('L')):
            if self.options.layout == 'tags':
                self.options.layout = 'folders'
                self.message = 'Folders: the same as in the source folder.'
            else:
                self.options.layout = 'tags'
                self.message = 'Folders: Artist / Year - Album / NN Title, from the tags.'
                if self.options.output is None:
                    self.pick_folder('output')
                    self.message = 'Sorting by tags needs its own output folder: pick one.'
        elif key == ord('+'):
            self.options.jobs = min(32, self.options.jobs + 1)
        elif key == ord('-'):
            self.options.jobs = max(1, self.options.jobs - 1)
        elif key in (10, 13, curses.KEY_ENTER):
            self.start()
        elif key in (ord('b'), ord('B')):
            self.mode = 'browse'
            self.message = ''
            self.open_folder(self.folder)
        if track is not None and key == ord('?'):
            self.message = track.message

    def probe_all(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.options.jobs) as pool:
            for track in self.tracks:
                track.status = 'probing'
            list(pool.map(probe, self.tracks))

    def start(self):
        chosen = [t for t in self.tracks if t.selected and t.is_alac]
        if any(t.codec is None for t in self.tracks):
            self.message = 'Still reading the files, one moment…'
            return
        if not chosen:
            self.message = 'Nothing chosen. Press a to choose all Apple Lossless files.'
            return
        if not self.ask(f'Convert {len(chosen)} files? (y/n)', 'n').lower().startswith('y'):
            return
        self.mode = 'running'
        self.started = time.time()
        self.message = ''

        def worker():
            run_all(self.tracks, self.options, on_change=None, cancel=self.cancel)
            self.log_path = write_log(self.tracks, self.options)
            result = summary(chosen)
            self.message = ', '.join(f'{n} {k}' for k, n in result.items() if n) + (f' · log: {self.log_path}' if self.log_path else '')
            self.mode = 'finished'

        threading.Thread(target=worker, daemon=True).start()


# ---------------------------------------------------------------------------------------------------------------- command line


def parse_arguments(argv):
    parser = argparse.ArgumentParser(prog='alac2flac', description='Convert Apple Lossless (.m4a) to FLAC, bit-perfect and verified.')
    parser.add_argument('paths', nargs='*', help='folders or files (none: pick a folder in the interface; batch mode: the current folder)')
    parser.add_argument('--output', help='write FLAC files into this folder instead of next to the originals')
    parser.add_argument('--layout', default='folders', help='folders: the same subfolders as the source (default); tags: Artist/Year - Album/NN Title.flac from the tags')
    parser.add_argument('--originals', default='keep', help='keep (default), move:FOLDER or delete, after a verified conversion')
    parser.add_argument('--overwrite', action='store_true', help='replace FLAC files that already exist')
    parser.add_argument('--jobs', type=int, default=min(8, os.cpu_count() or 2), help='files at the same time')
    parser.add_argument('--compression', type=int, default=8, help='FLAC compression level 0-12 (size and speed only)')
    parser.add_argument('--yes', action='store_true', help='no interface: convert everything found')
    parser.add_argument('--dry-run', action='store_true', help='only show what would be done')
    parser.add_argument('--log-dir', help='where to write the log (default: the current folder)')
    options = parser.parse_args(argv)
    validate_options(options)
    if options.output is not None:
        options.output = os.path.abspath(os.path.expanduser(options.output))
    return options


def run_without_interface(tracks, options):
    for track in tracks:
        probe(track)
    alac = [t for t in tracks if t.is_alac]
    print(f'{len(tracks)} files, {len(alac)} Apple Lossless.')
    for track in tracks:
        if not track.is_alac:
            print(f'  skip  {track.path}  ({track.message})')
    if options.dry_run:
        plan_targets(alac, options)
    for track in alac:
        if options.dry_run:
            print(f'  would convert  {track.path}  ->  {track.planned}')
    if options.dry_run or not alac:
        return 0

    def progress():
        done = sum(1 for t in alac if t.status in ('done', 'failed', 'exists'))
        print(f'\r  {done}/{len(alac)}', end='', flush=True)

    run_all(tracks, options, on_change=progress)
    print()
    for track in alac:
        if track.status != 'done':
            print(f'  {track.status:7} {track.path}: {track.message}')
    result = summary(alac)
    print(', '.join(f'{n} {k}' for k, n in result.items() if n) or 'nothing to do')
    log = write_log(tracks, options)
    if log:
        print(f'Log: {log}')
    return 1 if result['failed'] else 0


def main(argv=None):
    options = parse_arguments(sys.argv[1:] if argv is None else argv)
    check_tools()
    interactive = sys.stdin.isatty() and sys.stdout.isatty() and not options.yes and not options.dry_run

    if not interactive:
        if not options.yes and not options.dry_run:
            options.dry_run = True
            print('No terminal: showing what would be done. Add --yes to convert.')
        paths = options.paths or ['.']
        tracks = find_files(paths)
        if not tracks:
            print(f"No .m4a files in {', '.join(os.path.abspath(p) for p in paths)} (subfolders included).")
            return 0
        return run_without_interface(tracks, options)

    # The text interface: with a folder, its files; without one (or when it has no .m4a files), the folder browser.
    tracks = find_files(options.paths) if options.paths else []
    folder = options.paths[0] if options.paths and os.path.isdir(os.path.expanduser(options.paths[0])) else None
    message = '' if tracks or not options.paths else 'No .m4a files there. Pick another folder.'
    locale.setlocale(locale.LC_ALL, '')
    interface = {}
    curses.wrapper(lambda screen: interface.setdefault('ui', Interface(screen, tracks, options, folder, message)).run())
    done = summary(interface['ui'].tracks) if 'ui' in interface else {}
    print(', '.join(f'{n} {k}' for k, n in done.items() if n) or 'Nothing converted.')
    return 1 if done.get('failed') else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
