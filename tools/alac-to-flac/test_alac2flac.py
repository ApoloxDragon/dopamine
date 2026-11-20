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


def make_audio(path, codec='alac', bits=16, rate=44100, channels=2, seconds=1, cover=True, title='Song'):
    sample_format = {16: 's16p', 24: 's32p'}[bits] if codec == 'alac' else 'fltp'
    command = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'anoisesrc=d={seconds}:c=pink:a=0.5:r={rate}']
    if cover:
        command += ['-i', cover_image()]
    command += ['-map', '0:a', '-ac', str(channels), '-c:a', codec, '-sample_fmt', sample_format, '-ar', str(rate)]
    if cover:
        command += ['-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic']
    command += ['-metadata', f'title={title}', '-metadata', 'artist=Band', '-metadata', 'album=Album', '-metadata', 'track=3/10',
                '-metadata', 'date=1970', '-metadata', 'album_artist=Band', 'file:' + path]
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
    values = dict(output=None, originals='keep', overwrite=False, jobs=2, compression=8, yes=True, dry_run=False, log_dir=None, paths=[])
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


if __name__ == '__main__':
    unittest.main()
