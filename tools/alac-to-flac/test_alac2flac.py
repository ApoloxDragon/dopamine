"""
Tests for alac2flac. Real files are made with ffmpeg. Run: python3 -m unittest discover tools/alac-to-flac

Normal use first (it must just work), then a tester walking into a bar: fake .m4a files, empty files, names starting with
"-", a full disk, a FLAC that does not match, and so on.
"""

import contextlib
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alac2flac  # noqa: E402


def make_audio(path, codec='alac', bits=16, rate=44100, channels=2, seconds=1, cover=True, title='Song', tags=None):
    sample_format = {16: 's16p', 24: 's32p'}[bits] if codec == 'alac' else 'fltp'
    command = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'anoisesrc=d={seconds}:c=pink:a=0.5:r={rate}']
    if cover:
        command += ['-i', cover_image()]
    command += ['-map', '0:a', '-ac', str(channels), '-c:a', codec, '-sample_fmt', sample_format, '-ar', str(rate)]
    if cover:
        command += ['-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic']
    values = {'title': title, 'artist': 'Band', 'album': 'Album', 'track': '3/10', 'date': '1970', 'album_artist': 'Band'}
    if tags is not None:
        values = tags
    for key, value in values.items():
        command += ['-metadata', f'{key}={value}']
    command += ['file:' + path]
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    subprocess.run(command, check=True)
    return path


_cover = None


def cover_image():
    global _cover
    if _cover is None:
        _cover = os.path.join(tempfile.mkdtemp(prefix='alac2flac-cover-'), 'cover.jpg')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', _cover], check=True)
    return _cover


def info(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,bits_per_raw_sample,sample_rate,channels:format_tags',
                          '-of', 'json', 'file:' + path], capture_output=True, check=True).stdout
    return json.loads(out)


def options(**changes):
    values = dict(output=None, layout='folders', originals='keep', overwrite=False, jobs=2, compression=8, yes=True, dry_run=False, log_dir=None, paths=[])
    values.update(changes)
    return types.SimpleNamespace(**values)


def convert_folder(folder, **changes):
    tracks = alac2flac.find_files([folder])
    for track in tracks:
        alac2flac.probe(track)
    alac2flac.run_all(tracks, options(**changes))
    return tracks


class AlacToFlacTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp(prefix='alac2flac-test-')

    def tearDown(self):
        for root, folders, files in os.walk(self.folder):
            os.chmod(root, 0o755)
        subprocess.run(['rm', '-rf', '--', self.folder], check=False)

    def path(self, *parts):
        full = os.path.join(self.folder, *parts)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        return full

    # The regular customer

    def test_16_bit_is_identical_and_keeps_tags_and_cover(self):
        make_audio(self.path('Album', '01 Song.m4a'))

        tracks = convert_folder(self.folder)

        self.assertEqual(tracks[0].status, 'done', tracks[0].message)
        flac = self.path('Album', '01 Song.flac')
        self.assertEqual(alac2flac.audio_hash(flac), alac2flac.audio_hash(self.path('Album', '01 Song.m4a')))
        streams = info(flac)['streams']
        self.assertEqual(streams[0]['codec_name'], 'flac')
        self.assertEqual(streams[0]['bits_per_raw_sample'], '16')
        self.assertTrue(any(s['codec_name'] == 'mjpeg' for s in streams), 'cover kept')
        tags = {k.lower(): v for k, v in info(flac)['format']['tags'].items()}
        self.assertEqual((tags['title'], tags['album'], tags['date']), ('Song', 'Album', '1970'))
        self.assertTrue(os.path.exists(self.path('Album', '01 Song.m4a')), 'original kept by default')

    def test_24_bit_96_khz_stays_24_bit_and_identical(self):
        make_audio(self.path('hires.m4a'), bits=24, rate=96000)

        tracks = convert_folder(self.folder)

        self.assertEqual(tracks[0].status, 'done', tracks[0].message)
        stream = info(self.path('hires.flac'))['streams'][0]
        self.assertEqual((stream['bits_per_raw_sample'], stream['sample_rate']), ('24', '96000'))
        self.assertEqual(alac2flac.audio_hash(self.path('hires.flac')), alac2flac.audio_hash(self.path('hires.m4a')))

    def test_the_check_sees_a_change_in_the_lowest_bit_of_24_bit_audio(self):
        # A check at 16-bit precision would call these equal: flip the lowest of the 24 bits in one sample.
        base = make_audio(self.path('a.m4a'), bits=24)
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', base, '-map', '0:a', '-f', 's32le', '-'], capture_output=True, check=True).stdout
        changed = bytearray(raw)
        changed[4 * 1000 + 1] ^= 0x01  # s32le, 24-bit audio lives in the top 3 bytes: byte 1 bit 0 is its lowest bit
        flac = self.path('b.flac')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's32le', '-ar', '44100', '-ac', '2', '-i', '-', '-c:a', 'flac',
                        '-sample_fmt', 's32', '-bits_per_raw_sample', '24', flac], input=bytes(changed), check=True)
        self.assertEqual(info(flac)['streams'][0]['bits_per_raw_sample'], '24')
        self.assertNotEqual(alac2flac.audio_hash(base), alac2flac.audio_hash(flac))

    def test_mono_surround_and_no_cover(self):
        make_audio(self.path('mono.m4a'), channels=1, cover=False)
        make_audio(self.path('surround.m4a'), channels=6)

        tracks = convert_folder(self.folder)

        self.assertEqual([t.status for t in tracks], ['done', 'done'], [t.message for t in tracks])

    def test_output_folder_keeps_the_subfolders(self):
        make_audio(self.path('Artist', 'Album', 'Song.m4a'))
        out = os.path.join(self.folder, 'out')

        convert_folder(os.path.join(self.folder, 'Artist'), output=out)

        self.assertTrue(os.path.exists(os.path.join(out, 'Album', 'Song.flac')))
        self.assertFalse(os.path.exists(self.path('Artist', 'Album', 'Song.flac')))

    def test_originals_can_be_moved_or_deleted_after_verification(self):
        make_audio(self.path('music', 'a.m4a'))
        make_audio(self.path('music2', 'b.m4a'))
        backup = os.path.join(self.folder, 'backup')

        convert_folder(os.path.join(self.folder, 'music'), originals=f'move:{backup}')
        convert_folder(os.path.join(self.folder, 'music2'), originals='delete')

        self.assertTrue(os.path.exists(os.path.join(backup, 'a.m4a')))
        self.assertFalse(os.path.exists(self.path('music', 'a.m4a')))
        self.assertFalse(os.path.exists(self.path('music2', 'b.m4a')))
        self.assertTrue(os.path.exists(self.path('music2', 'b.flac')))

    # Trying to break it

    def test_aac_is_lossy_and_is_skipped(self):
        make_audio(self.path('lossy.m4a'), codec='aac')

        tracks = convert_folder(self.folder)

        self.assertEqual(tracks[0].status, 'skip')
        self.assertFalse(os.path.exists(self.path('lossy.flac')))

    def test_fake_empty_and_garbage_files_are_skipped_not_fatal(self):
        open(self.path('empty.m4a'), 'wb').close()
        with open(self.path('text.m4a'), 'w') as f:
            f.write('qwertyuiop, a lizard in a beer glass')
        with open(self.path('random.m4a'), 'wb') as f:
            f.write(os.urandom(4096))
        make_audio(self.path('good.m4a'))

        tracks = convert_folder(self.folder)
        by_name = {os.path.basename(t.path): t.status for t in tracks}

        self.assertEqual(by_name, {'empty.m4a': 'skip', 'good.m4a': 'done', 'random.m4a': 'skip', 'text.m4a': 'skip'})

    def test_truncated_alac_fails_cleanly_and_leaves_nothing_behind(self):
        good = make_audio(self.path('cut.m4a'), seconds=3)
        with open(good, 'rb') as f:
            data = f.read()
        with open(good, 'wb') as f:
            f.write(data[: len(data) // 2])

        tracks = convert_folder(self.folder)

        if tracks[0].status == 'done':  # ffmpeg may decode what is there: then it must still be identical
            self.assertEqual(alac2flac.audio_hash(self.path('cut.flac')), alac2flac.audio_hash(good))
        else:
            self.assertIn(tracks[0].status, ('failed', 'skip'))
        self.assertEqual([n for n in os.listdir(self.folder) if n.startswith('.alac2flac-')], [])

    def test_strange_file_names(self):
        names = ['-dash.m4a', 'colon: name.m4a', "quote ' \" name.m4a", 'ünïcødé 盤 🍺.m4a', 'semi;colon $HOME.m4a', 'UPPER.M4A']
        for name in names:
            make_audio(self.path(name))

        tracks = convert_folder(self.folder)

        self.assertEqual({t.status for t in tracks}, {'done'}, [(t.path, t.message) for t in tracks])
        for name in names:
            self.assertTrue(os.path.exists(self.path(os.path.splitext(name)[0] + '.flac')), name)

    def test_existing_flac_is_not_replaced_unless_asked(self):
        make_audio(self.path('a.m4a'))
        with open(self.path('a.flac'), 'w') as f:
            f.write('my own file')

        tracks = convert_folder(self.folder)
        self.assertEqual(tracks[0].status, 'exists')
        with open(self.path('a.flac')) as f:
            self.assertEqual(f.read(), 'my own file')

        tracks = convert_folder(self.folder, overwrite=True)
        self.assertEqual(tracks[0].status, 'done')

    def test_a_flac_that_does_not_match_is_never_kept_and_the_original_is_never_touched(self):
        make_audio(self.path('a.m4a'))
        real = alac2flac.audio_hash
        with mock.patch.object(alac2flac, 'audio_hash', side_effect=lambda p: ('different', 1) if p.endswith('.flac') else real(p)):
            tracks = convert_folder(self.folder, originals='delete')

        self.assertEqual(tracks[0].status, 'failed')
        self.assertIn('verification failed', tracks[0].message)
        self.assertTrue(os.path.exists(self.path('a.m4a')), 'original must survive a failed check, even with delete')
        self.assertEqual([n for n in os.listdir(self.folder) if n.endswith('.flac')], [])

    @unittest.skipIf(os.geteuid() == 0, 'root can write to read-only folders')
    def test_read_only_folder_fails_that_file_and_continues(self):
        make_audio(self.path('locked', 'a.m4a'))
        make_audio(self.path('open', 'b.m4a'))
        os.chmod(self.path('locked'), stat.S_IREAD | stat.S_IEXEC)

        tracks = convert_folder(self.folder)

        self.assertEqual({os.path.basename(t.path): t.status for t in tracks}, {'a.m4a': 'failed', 'b.m4a': 'done'})

    def test_full_disk_fails_that_file_and_continues(self):
        make_audio(self.path('a.m4a'))
        make_audio(self.path('b.m4a'))
        real = alac2flac.tempfile.mkstemp
        calls = []

        def first_disk_full(*args, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                raise OSError(28, 'No space left on device')
            return real(*args, **kwargs)

        with mock.patch.object(alac2flac.tempfile, 'mkstemp', side_effect=first_disk_full):
            tracks = convert_folder(self.folder, jobs=1)

        self.assertEqual(sorted(t.status for t in tracks), ['done', 'failed'])
        self.assertIn('No space left', [t for t in tracks if t.status == 'failed'][0].message)

    def test_move_target_that_already_exists_keeps_the_original(self):
        make_audio(self.path('music', 'a.m4a'))
        backup = os.path.join(self.folder, 'backup')
        os.makedirs(backup)
        with open(os.path.join(backup, 'a.m4a'), 'w') as f:
            f.write('older backup')

        tracks = convert_folder(os.path.join(self.folder, 'music'), originals=f'move:{backup}')

        self.assertTrue(os.path.exists(self.path('music', 'a.m4a')))
        self.assertIn('already exists', tracks[0].message)

    def test_dry_run_changes_nothing(self):
        make_audio(self.path('a.m4a'))
        before = sorted(os.listdir(self.folder))
        with contextlib.redirect_stdout(io.StringIO()):
            code = alac2flac.main([self.folder, '--dry-run', '--log-dir', self.folder])
        self.assertEqual(code, 0)
        self.assertEqual(sorted(os.listdir(self.folder)), before)

    def test_bad_options_are_refused(self):
        for argv in (['--originals', 'shred'], ['--originals', 'move:'], ['--compression', '99'], ['--compression', '-1']):
            with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                alac2flac.parse_arguments(argv)
        self.assertEqual(alac2flac.parse_arguments(['--jobs', '0']).jobs, 1)
        self.assertEqual(alac2flac.parse_arguments(['--jobs', '9999']).jobs, 32)

    def test_missing_folder_and_files_named_like_audio_folders(self):
        os.makedirs(self.path('folder.m4a', 'x'))
        self.assertEqual(alac2flac.find_files([self.path('folder.m4a'), os.path.join(self.folder, 'does-not-exist')]), [])

    def test_symlink_loop_does_not_hang(self):
        os.makedirs(self.path('loop'))
        os.symlink(self.path('loop'), self.path('loop', 'again'))
        make_audio(self.path('loop', 'a.m4a'))

        self.assertEqual(len(alac2flac.find_files([self.folder])), 1)

    def test_same_file_given_twice_is_converted_once(self):
        song = make_audio(self.path('a.m4a'))
        self.assertEqual(len(alac2flac.find_files([song, self.folder, song])), 1)

    def test_many_files_in_parallel(self):
        for i in range(24):
            make_audio(self.path(f'{i:02}.m4a'), seconds=0.2, cover=False)

        tracks = convert_folder(self.folder, jobs=8)

        self.assertEqual({t.status for t in tracks}, {'done'})


class TagLayoutTest(unittest.TestCase):
    """Sorting the FLAC files into Artist/Album (Year)/NN Title.flac from their tags."""

    def track(self, path='/music/x/file name.m4a', **tags):
        track = alac2flac.Track(path, '/music')
        track.codec, track.tags = 'alac', {k.lower(): v for k, v in tags.items()}
        return track

    def path(self, **tags):
        return alac2flac.tag_path(self.track(**tags))

    def test_the_usual_album(self):
        self.assertEqual(self.path(album_artist='Black Sabbath', artist='Black Sabbath', album='Paranoid', date='1970-09-18', track='2/8', title='Paranoid'),
                         os.path.join('Black Sabbath', 'Paranoid (1970)', '02 Paranoid.flac'))

    def test_multi_disc_albums_get_the_disc_number(self):
        self.assertEqual(self.path(artist='Amon Amarth', album='Deceiver Of The Gods', disc='2/2', track='3', title='Warriors'),
                         os.path.join('Amon Amarth', 'Deceiver Of The Gods', '2-03 Warriors.flac'))
        self.assertEqual(self.path(artist='A', album='B', disc='1/1', track='3', title='T'), os.path.join('A', 'B', '03 T.flac'))

    def test_missing_tags_fall_back(self):
        self.assertEqual(self.path(), os.path.join('Unknown Artist', 'Unknown Album', 'file name.flac'))
        self.assertEqual(self.path(artist='Only Artist'), os.path.join('Only Artist', 'Unknown Album', 'file name.flac'))

    # Trying to break it

    def test_tags_cannot_make_paths_that_leave_the_output_folder(self):
        for evil in ('../../../etc', '..', '.', '/etc/passwd', '\\\\server\\share', 'C:\\Windows', '~/.ssh', '....//....//'):
            path = self.path(album_artist=evil, album=evil, title=evil)
            self.assertEqual(os.path.normpath(path), path, evil)
            self.assertFalse(os.path.isabs(path), evil)
            self.assertNotIn('..', path.split(os.sep), evil)
            self.assertEqual(len(path.split(os.sep)), 3, evil)

    def test_names_that_windows_or_macos_refuse(self):
        for name in ('CON', 'nul', 'com1.txt', 'LPT9', 'a:b*c?d"e<f>g|h', 'trailing dot.', '   spaces   ', 'tab\there', 'nul\x00byte', 'bell\x07'):
            part = alac2flac.safe_name(name, 'X')
            self.assertFalse(any(c in part for c in ':*?"<>|/\\\x00\x07\t'), name)
            self.assertNotIn(part.split('.')[0].upper(), alac2flac.RESERVED_NAMES, name)
            self.assertFalse(part.endswith(('.', ' ')), name)

    def test_very_long_and_emoji_names_are_cut_on_a_character(self):
        part = alac2flac.safe_name('🍺' * 500, 'X')
        self.assertLessEqual(len(part.encode('utf-8')), alac2flac.MAXIMUM_NAME_BYTES)
        part.encode('utf-8')  # still valid text

    def test_odd_track_and_disc_numbers(self):
        for value in ('abc', '-1', '', '99999999', '3.5', '1e3', None, '٣', '³', '１'):
            name = os.path.basename(self.path(artist='A', album='B', track=value, disc=value, title='T'))
            self.assertIn(name, ('T.flac', '01 T.flac'), value)

    def test_odd_years(self):
        for value, folder in (('١٩٧٠', 'B'), ('1970', 'B (1970)'), ('19', 'B'), ('abcd', 'B'), ('2026-11-20T10:00:00Z', 'B (2026)'), ('', 'B')):
            self.assertEqual(self.path(artist='A', album='B', date=value).split(os.sep)[1], folder, value)

    def test_two_songs_with_the_same_name_do_not_overwrite_each_other(self):
        tracks = [self.track(f'/music/{i}.m4a', artist='A', album='B', title='Intro', track='1') for i in range(3)]
        tracks.append(self.track('/music/x.m4a', artist='a', album='b', title='INTRO', track='1'))  # same name, other case

        alac2flac.plan_targets(tracks, options(output='/out', layout='tags'))

        names = [os.path.basename(t.planned) for t in tracks]
        self.assertEqual(names, ['01 Intro.flac', '01 Intro (2).flac', '01 Intro (3).flac', '01 INTRO (4).flac'])

    def test_tags_layout_needs_an_output_folder_on_the_command_line(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            alac2flac.parse_arguments(['--layout', 'tags'])
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            alac2flac.parse_arguments(['--layout', 'lizard', '--output', '/out'])
        self.assertEqual(alac2flac.parse_arguments(['--layout', 'tags', '--output', '/out']).layout, 'tags')

    def test_real_files_end_up_sorted(self):
        folder = tempfile.mkdtemp(prefix='alac2flac-tags-')
        out = os.path.join(folder, 'sorted')
        make_audio(os.path.join(folder, 'messy', 'track01.m4a'), tags={'artist': 'Band', 'album': 'Debut', 'date': '1999', 'track': '1/2', 'title': 'First'})
        make_audio(os.path.join(folder, 'messy', 'other', 'zzz.m4a'), tags={'artist': 'Band', 'album': 'Debut', 'date': '1999', 'track': '2/2', 'title': 'Second'})

        tracks = convert_folder(os.path.join(folder, 'messy'), output=out, layout='tags')

        self.assertEqual({t.status for t in tracks}, {'done'}, [t.message for t in tracks])
        self.assertEqual(sorted(os.listdir(os.path.join(out, 'Band', 'Debut (1999)'))), ['01 First.flac', '02 Second.flac'])
        subprocess.run(['rm', '-rf', '--', folder], check=False)


class InterfaceTest(unittest.TestCase):
    """The text interface draws without errors at odd sizes and with odd names (no real terminal needed)."""

    class Screen:
        def __init__(self, height, width):
            self.size = (height, width)
            self.lines = {}

        def getmaxyx(self):
            return self.size

        def erase(self):
            self.lines = {}

        def addnstr(self, y, x, text, n, attribute=0):
            # Like curses: writes over what is there, and fails past the edge.
            if n < 0 or y >= self.size[0] or x >= self.size[1]:
                raise alac2flac.curses.error()
            text = text[:n]
            if x + len(text) > self.size[1]:
                raise alac2flac.curses.error()
            line = self.lines.get(y, '').ljust(x)
            self.lines[y] = line[:x] + text + line[x + len(text):]

        def refresh(self):
            pass

    def interface(self, height, width, names):
        tracks = []
        for name in names:
            track = alac2flac.Track(os.path.join('/music', name), '/music')
            track.codec, track.bits, track.rate, track.channels, track.status = 'alac', 24, 96000, 2, 'ready'
            tracks.append(track)
        screen = self.Screen(height, width)
        with mock.patch.object(alac2flac.curses, 'color_pair', return_value=0), mock.patch.object(alac2flac.curses, 'has_colors', return_value=False):
            ui = alac2flac.Interface(screen, tracks, options())
            ui.draw()
        return screen

    def test_normal_terminal(self):
        screen = self.interface(30, 100, ['01 Song.m4a', 'ünïcødé 盤 🍺.m4a'])
        self.assertIn('2 Apple Lossless', screen.lines[1])

    def test_tiny_terminal_asks_for_more_room(self):
        screen = self.interface(5, 20, ['a.m4a'])
        self.assertIn('small', screen.lines[0])

    def test_very_long_names_and_thousands_of_files(self):
        screen = self.interface(40, 200, ['x' * 1000 + '.m4a'] + [f'{i}.m4a' for i in range(5000)])
        self.assertTrue(all(len(line) < 200 for line in screen.lines.values()))
        self.assertIn('5001 Apple Lossless', screen.lines[1])

    def test_empty_list(self):
        self.interface(30, 100, [])

    # The folder browser (what opens when there is no folder, or no .m4a files where it was started)

    def browser(self, folder, height=30, width=100):
        screen = self.Screen(height, width)
        with mock.patch.object(alac2flac.curses, 'color_pair', return_value=0), mock.patch.object(alac2flac.curses, 'has_colors', return_value=False):
            ui = alac2flac.Interface(screen, [], options(), folder)
            ui.draw()
        return ui, screen

    def test_browser_opens_when_there_are_no_files_and_lists_subfolders(self):
        root = tempfile.mkdtemp(prefix='alac2flac-browse-')
        for name in ('Music', 'Downloads', '.hidden'):
            os.makedirs(os.path.join(root, name))
        open(os.path.join(root, 'song.m4a'), 'w').close()

        ui, screen = self.browser(root)

        self.assertEqual(ui.mode, 'browse')
        self.assertEqual([e[0] for e in ui.entries], ['search', 'up', 'dir', 'dir'])
        self.assertEqual([e[1] for e in ui.entries if e[0] == 'dir'], ['Downloads', 'Music'])
        self.assertIn('1 .m4a here', ui.entries[0][1])
        self.assertIn('Search this folder', ''.join(screen.lines.values()))

    def test_browser_at_the_root_has_no_parent_and_unreadable_folders_only_give_a_message(self):
        ui, _ = self.browser('/')
        self.assertNotIn('up', [e[0] for e in ui.entries])

        ui.open_folder('/does/not/exist')
        self.assertEqual(ui.folder, '/')
        self.assertIn('Cannot open', ui.message)

    def list_ui(self, root):
        song = os.path.join(root, 'music', 'a.m4a')
        os.makedirs(os.path.dirname(song), exist_ok=True)
        open(song, 'w').close()
        track = alac2flac.Track(song, os.path.join(root, 'music'))
        track.codec, track.status = 'alac', 'ready'
        screen = self.Screen(30, 120)
        patches = [mock.patch.object(alac2flac.curses, 'color_pair', return_value=0), mock.patch.object(alac2flac.curses, 'has_colors', return_value=False)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        return alac2flac.Interface(screen, [track], options()), screen

    def test_output_folder_is_picked_in_the_browser(self):
        root = tempfile.mkdtemp(prefix='alac2flac-out-')
        os.makedirs(os.path.join(root, 'flac'))
        ui, screen = self.list_ui(root)

        ui.list_key(ord('o'))
        self.assertEqual((ui.mode, ui.purpose), ('browse', 'output'))
        self.assertEqual([e[0] for e in ui.entries][:2], ['choose', 'beside'])
        ui.open_folder(os.path.join(root, 'flac'))
        ui.browse_key(10)  # Enter on "Use this folder"
        ui.draw()

        self.assertEqual(ui.mode, 'list')
        self.assertEqual(ui.options.output, os.path.join(root, 'flac'))
        self.assertIn(os.path.join(root, 'flac'), screen.lines[2])

    def test_output_can_go_back_to_next_to_the_originals_and_cancel_changes_nothing(self):
        ui, _ = self.list_ui(tempfile.mkdtemp(prefix='alac2flac-out-'))
        ui.options.output = '/somewhere'

        ui.pick_folder('output')
        ui.cursor = 1  # "Next to the originals"
        ui.browse_key(10)
        self.assertIsNone(ui.options.output)

        ui.options.output = '/kept'
        ui.pick_folder('output')
        self.assertEqual(ui.mode, 'browse')
        ui.leave_browser()
        self.assertEqual(ui.options.output, '/kept')

    def test_picking_the_music_folder_itself_or_a_folder_inside_it(self):
        root = tempfile.mkdtemp(prefix='alac2flac-out-')
        ui, _ = self.list_ui(root)
        music = os.path.join(root, 'music')

        ui.pick_folder('output')
        ui.choose_folder(music)
        self.assertIsNone(ui.options.output)
        self.assertIn('music folder itself', ui.message)

        os.makedirs(os.path.join(music, 'flac'))
        ui.pick_folder('output')
        ui.choose_folder(os.path.join(music, 'flac'))
        self.assertIn('Dopamine will also find', ui.message)

        ui.pick_folder('originals')
        ui.choose_folder(music)
        self.assertEqual(ui.mode, 'browse', 'moving originals into the music folder is refused')
        self.assertEqual(ui.options.originals, 'keep')

    def test_originals_folder_is_picked_in_the_browser_and_new_folders_can_be_made(self):
        root = tempfile.mkdtemp(prefix='alac2flac-out-')
        ui, _ = self.list_ui(root)

        ui.list_key(ord('r'))  # keep -> move: opens the browser
        self.assertEqual(ui.purpose, 'originals')
        ui.open_folder(root)
        with mock.patch.object(ui, 'ask', return_value='alac backup 🍺'):
            ui.browse_key(ord('m'))
        self.assertTrue(os.path.isdir(os.path.join(root, 'alac backup 🍺')))
        ui.browse_key(ord('s'))

        self.assertEqual(ui.options.originals, 'move:' + os.path.join(root, 'alac backup 🍺'))
        self.assertEqual(ui.mode, 'list')

    def test_long_paths_keep_their_end(self):
        self.assertEqual(alac2flac.short_path('/a/' + 'x' * 100 + '/FLAC rips', 20), '…' + ('x' * 100 + '/FLAC rips')[-19:])
        self.assertEqual(alac2flac.short_path(os.path.expanduser('~') + '/Music', 50), '~/Music')
        self.assertEqual(alac2flac.short_path(os.path.expanduser('~') + 'other', 50), os.path.expanduser('~') + 'other')

    def test_layout_key_asks_for_an_output_folder_and_cancel_goes_back(self):
        ui, screen = self.list_ui(tempfile.mkdtemp(prefix='alac2flac-out-'))

        ui.list_key(ord('l'))
        self.assertEqual((ui.mode, ui.purpose, ui.options.layout), ('browse', 'output', 'tags'))
        ui.cancel_browser()

        self.assertEqual(ui.options.layout, 'folders')

    def test_layout_shows_where_the_current_song_goes(self):
        root = tempfile.mkdtemp(prefix='alac2flac-out-')
        ui, screen = self.list_ui(root)
        ui.tracks[0].tags = {'artist': 'Band', 'album': 'Debut', 'track': '1', 'title': 'First'}
        ui.options.output, ui.options.layout = os.path.join(root, 'out'), 'tags'

        ui.draw()

        self.assertIn('Artist/Album from tags', screen.lines[2])
        self.assertIn('→ ' + os.path.join('Band', 'Debut', '01 First.flac'), ''.join(screen.lines.values()))

    def test_a_new_folder_that_cannot_be_made_only_gives_a_message(self):
        ui, _ = self.list_ui(tempfile.mkdtemp(prefix='alac2flac-out-'))
        ui.pick_folder('output')
        with mock.patch.object(ui, 'ask', return_value='x'), mock.patch.object(alac2flac.os, 'makedirs', side_effect=OSError(13, 'Permission denied')):
            ui.browse_key(ord('m'))

        self.assertIn('Cannot make', ui.message)
        self.assertEqual(ui.mode, 'browse')

    def test_searching_a_folder_without_music_stays_in_the_browser(self):
        root = tempfile.mkdtemp(prefix='alac2flac-browse-')
        ui, _ = self.browser(root)

        ui.search(root)
        for _ in range(50):
            if not ui.searching:
                break
            alac2flac.time.sleep(0.05)

        self.assertEqual(ui.mode, 'browse')
        self.assertIn('No .m4a files', ui.message)


if __name__ == '__main__':
    unittest.main()
