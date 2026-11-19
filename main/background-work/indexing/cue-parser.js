const { TextDecoder } = require('util');

const FRAMES_PER_SECOND = 75;

class CueParser {
    /**
     * Decodes the raw bytes of a .cue file to text. Handles UTF-8 (with or without BOM), UTF-16 (BOM) and
     * falls back to Windows-1252 when the bytes are not valid UTF-8 (older rips are often not UTF-8).
     */
    decode(buffer) {
        if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
            return buffer.subarray(2).toString('utf16le');
        }

        if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
            const swapped = Buffer.from(buffer.subarray(2));
            swapped.swap16();
            return swapped.toString('utf16le');
        }

        const withoutBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? buffer.subarray(3) : buffer;

        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(withoutBom);
        } catch {
            try {
                return new TextDecoder('windows-1252').decode(withoutBom);
            } catch {
                // Node builds without full ICU have no windows-1252 decoder. Latin-1 differs only in 0x80-0x9F.
                return Buffer.from(withoutBom).toString('latin1');
            }
        }
    }

    /** Converts mm:ss:ff (75 frames per second) to milliseconds. Returns undefined when the value is invalid. */
    timeToMilliseconds(time) {
        const match = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(time.trim());

        if (!match) {
            return undefined;
        }

        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const frames = parseInt(match[3], 10);

        return Math.round((minutes * 60 + seconds) * 1000 + (frames * 1000) / FRAMES_PER_SECOND);
    }

    /**
     * Parses cue sheet text. Returns:
     * { performer, title, genre, year, files: [{ fileName, tracks: [{ number, title, performer, composer, startMs, pregapStartMs }] }] }
     * Only AUDIO tracks with an INDEX 01 are returned. startMs is the time of INDEX 01 within the referenced file.
     */
    parse(text) {
        const sheet = { performer: '', title: '', genre: '', year: 0, files: [] };

        let currentFile;
        let currentTrack;

        const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);

        for (const rawLine of lines) {
            const line = rawLine.trim();

            if (line.length === 0) {
                continue;
            }

            const command = this.#readWord(line);
            const rest = line.substring(command.length).trim();

            switch (command.toUpperCase()) {
                case 'REM': {
                    const key = this.#readWord(rest);
                    const value = this.#unquote(rest.substring(key.length).trim());

                    if (value.length === 0) {
                        break;
                    }

                    if (currentTrack === undefined) {
                        if (key.toUpperCase() === 'GENRE') {
                            sheet.genre = value;
                        } else if (key.toUpperCase() === 'DATE') {
                            const year = parseInt(value, 10);
                            sheet.year = Number.isNaN(year) ? 0 : year;
                        }
                    } else if (key.toUpperCase() === 'COMPOSER') {
                        currentTrack.composer = value;
                    }

                    break;
                }
                case 'PERFORMER':
                    (currentTrack ?? sheet).performer = this.#unquote(rest);
                    break;
                case 'TITLE':
                    (currentTrack ?? sheet).title = this.#unquote(rest);
                    break;
                case 'FILE':
                    currentFile = { fileName: this.#readFileName(rest), tracks: [] };
                    sheet.files.push(currentFile);
                    currentTrack = undefined;
                    break;
                case 'TRACK': {
                    const parts = rest.split(/\s+/);
                    const number = parseInt(parts[0], 10);
                    const isAudio = (parts[1] ?? '').toUpperCase() === 'AUDIO';

                    if (currentFile === undefined) {
                        currentTrack = undefined;
                        break;
                    }

                    currentTrack = {
                        number: Number.isNaN(number) ? currentFile.tracks.length + 1 : number,
                        title: '',
                        performer: '',
                        composer: '',
                        startMs: undefined,
                        pregapStartMs: undefined,
                        isAudio: isAudio,
                    };
                    currentFile.tracks.push(currentTrack);
                    break;
                }
                case 'INDEX': {
                    if (currentTrack === undefined) {
                        break;
                    }

                    const parts = rest.split(/\s+/);
                    const indexNumber = parseInt(parts[0], 10);
                    const ms = this.timeToMilliseconds(parts[1] ?? '');

                    if (ms === undefined) {
                        break;
                    }

                    if (indexNumber === 1) {
                        currentTrack.startMs = ms;
                    } else if (indexNumber === 0) {
                        currentTrack.pregapStartMs = ms;
                    }

                    break;
                }
                default:
                    break;
            }
        }

        for (const file of sheet.files) {
            file.tracks = file.tracks.filter((t) => t.isAudio && t.startMs !== undefined).map(({ isAudio, ...track }) => track);
        }

        sheet.files = sheet.files.filter((f) => f.tracks.length > 0);

        return sheet;
    }

    /**
     * Turns the tracks of one FILE entry into playable ranges. Track N ends where track N+1 starts (INDEX 01), so any
     * INDEX 00 pregap audio stays at the end of the previous track and no audio is dropped. The last track ends at the
     * end of the file (durationMs). Tracks with a non-positive length are dropped.
     */
    createTrackRanges(cueFile, durationMs) {
        const ranges = [];
        const tracks = [...cueFile.tracks].sort((a, b) => a.startMs - b.startMs);

        for (let i = 0; i < tracks.length; i++) {
            const startMs = tracks[i].startMs;
            const endMs = i + 1 < tracks.length ? tracks[i + 1].startMs : durationMs;

            if (endMs <= startMs) {
                continue;
            }

            ranges.push({ ...tracks[i], startMs, endMs });
        }

        return ranges;
    }

    #readWord(text) {
        const match = /^\S+/.exec(text);
        return match ? match[0] : '';
    }

    #unquote(text) {
        const trimmed = text.trim();

        if (trimmed.startsWith('"')) {
            const end = trimmed.lastIndexOf('"');
            // Rippers sometimes leave spaces inside the quotes (TITLE " High Wood"); they are not part of the text.
            return (end > 0 ? trimmed.substring(1, end) : trimmed.substring(1)).trim();
        }

        return trimmed;
    }

    #readFileName(text) {
        const trimmed = text.trim();

        if (trimmed.startsWith('"')) {
            const end = trimmed.lastIndexOf('"');
            return end > 0 ? trimmed.substring(1, end) : trimmed.substring(1);
        }

        // Unquoted: the last word is the file type (WAVE, MP3, ...)
        const lastSpace = trimmed.lastIndexOf(' ');
        return lastSpace > 0 ? trimmed.substring(0, lastSpace) : trimmed;
    }
}

exports.CueParser = CueParser;
