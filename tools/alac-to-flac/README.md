# alac2flac

Converts Apple Lossless (ALAC) `.m4a` files to FLAC, offline, without changing the sound.

Both formats are lossless. After converting a file, the tool decodes the original and the FLAC again and compares every
sample (at 32-bit precision, so 24-bit music is checked in full). A file only counts as converted when they are identical;
otherwise nothing is replaced. Tags (title, artist, album, track, disc, year, ...) and the cover are copied, and the
bit depth and sample rate stay the same (16-bit stays 16-bit, 24-bit/96 kHz stays 24-bit/96 kHz).

AAC `.m4a` files (the lossy kind from iTunes purchases or YouTube downloads) are left alone: converting them would only make
them bigger, not better.

## What you need

- Python 3.8 or newer (already on most Linux systems)
- ffmpeg: `sudo apt install ffmpeg`, `sudo pacman -S ffmpeg` or `sudo dnf install ffmpeg`

## Use it

```bash
python3 tools/alac-to-flac/alac2flac.py
```

It opens a full-screen text interface. First pick a folder: arrow keys and Enter to move through folders, `s` to search the
folder you are in (subfolders included), `g` to type a path. You can also start with a folder:
`python3 tools/alac-to-flac/alac2flac.py ~/Music`.

Then a list of the `.m4a` files appears, with what each one is (for example "ALAC 24-bit 96 kHz stereo"). Keys:

| Key | What it does |
| --- | --- |
| ↑ ↓, Page Up/Down | move |
| space | choose or unchoose a file |
| a / n | choose all / none |
| o | pick the output folder in the folder browser (or "Next to the originals"); `m` there makes a new folder |
| l | layout: the same subfolders as the source, or sorted by the tags into `Artist/Album (Year)/01 Title.flac` (needs an output folder) |
| r | what to do with the originals after a verified conversion: keep, move to a folder (picked in the browser), or delete |
| e | replace FLAC files that already exist, or skip them |
| + / - | how many files at the same time |
| b | back to the folders |
| Enter | convert |
| q | quit |

When it is done, every file shows "✓ verified" or "✗ failed" (press `f` to jump to the failed ones and see why), and a log
file is written in the current folder.

**With Dopamine:** if the FLAC files are written next to the originals and the originals are kept, Dopamine shows every song
twice. Either move the originals out of the music folder (`r`, then a folder such as `~/alac-backup`), or write the FLAC files
into a new folder (`o`) and point Dopamine at that one. Then refresh the collection.

## Without the interface (for scripts)

```bash
python3 tools/alac-to-flac/alac2flac.py ~/Music --dry-run
```

```bash
python3 tools/alac-to-flac/alac2flac.py ~/Music --yes --originals move:~/alac-backup
```

Options: `--output DIR`, `--layout folders|tags` (tags needs `--output`), `--originals keep|move:DIR|delete`, `--overwrite`, `--jobs N`, `--compression 0-12`
(only size and speed, never the sound), `--log-dir DIR`. The exit code is 1 when a file failed.

## Safety

- Nothing is written under the final name until the conversion is verified; a half-written file never looks finished.
- Originals are only moved or deleted after their FLAC passed the check. Delete asks you to type `delete` first.
- Existing FLAC files are skipped unless you ask to replace them.
- One damaged file does not stop the others.

## Tests

```bash
python3 -m unittest discover tools/alac-to-flac
```

They make real ALAC files with ffmpeg and include odd cases: fake and empty `.m4a` files, AAC, names starting with `-` or
full of quotes and emoji, a full disk, a FLAC that does not match, mono and 5.1, 24-bit/96 kHz, symlink loops, and a check
that a change in the lowest bit of 24-bit audio is caught.
