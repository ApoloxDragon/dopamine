const fs = require('fs');
const path = require('path');
const { FileFormats } = require('../common/application/file-formats');

/**
 * Reads .cue sheets from disk and works out which audio file each FILE entry refers to.
 *
 * The FILE name in a sheet does not always match what is on disk (renamed files, a .wav rip that was later converted to
 * .flac, different case). Resolution order for each FILE entry:
 *   1. the exact name next to the .cue file
 *   2. the same name with a different case
 *   3. the same base name with another supported audio extension (e.g. sheet says .wav, disk has .flac)
 *   3b. the same letters and digits, ignoring spaces and punctuation, when exactly one file matches
 *   4. for single-FILE sheets: the audio file named like the sheet ("Album.flac.cue" -> "Album.flac", "Album.cue" -> "Album.*")
 *   5. for single-FILE sheets: the only supported audio file in the folder
 * Entries that cannot be resolved are skipped (and logged), so a bad sheet never hides existing files.
 */
class CueSheetReader {
    constructor(cueParser, logger, fileSystem = fs) {
        this.cueParser = cueParser;
        this.logger = logger;
        this.fileSystem = fileSystem;
        this.cache = new Map();
    }

    /**
     * Returns [{ audioPath, sheet, tracks: [{ number, title, performer, composer, startMs, nextStartMs }] }] for the sheet,
     * or [] when it cannot be read. nextStartMs is the start of the next track in the same file (undefined for the last
     * track, which ends at the end of the audio file). Results are cached until the .cue file changes.
     */
    read(cuePath) {
        let modifiedMs;

        try {
            modifiedMs = this.fileSystem.statSync(cuePath).mtimeMs;
        } catch (e) {
            return [];
        }

        const cached = this.cache.get(cuePath);

        if (cached !== undefined && cached.modifiedMs === modifiedMs) {
            return cached.audioFiles;
        }

        let audioFiles = [];

        try {
            const sheet = this.cueParser.parse(this.cueParser.decode(this.fileSystem.readFileSync(cuePath)));
            audioFiles = this.#resolveAudioFiles(cuePath, sheet);
        } catch (e) {
            this.logger.error(e, `Could not read cue sheet '${cuePath}'`, 'CueSheetReader', 'read');
        }

        this.cache.set(cuePath, { modifiedMs, audioFiles });

        return audioFiles;
    }

    /** Returns the track with the given number for the given audio file of the sheet, or undefined. */
    getTrack(cuePath, audioPath, trackNumber) {
        const audioFile = this.read(cuePath).find((x) => x.audioPath === audioPath);

        if (audioFile === undefined) {
            return undefined;
        }

        const track = audioFile.tracks.find((x) => x.number === trackNumber);

        return track === undefined ? undefined : { ...track, sheet: audioFile.sheet, trackCount: audioFile.tracks.length };
    }

    #resolveAudioFiles(cuePath, sheet) {
        const directory = path.dirname(cuePath);
        let directoryEntries;

        try {
            directoryEntries = this.fileSystem.readdirSync(directory);
        } catch (e) {
            directoryEntries = [];
        }

        const audioEntries = directoryEntries.filter((x) => FileFormats.supportedAudioExtensions.includes(path.extname(x).toLowerCase()));
        const result = [];

        for (const file of sheet.files) {
            const entry = this.#resolveEntry(cuePath, file.fileName, audioEntries, sheet.files.length === 1);

            if (entry === undefined) {
                this.logger.warn(
                    `Cue sheet '${cuePath}' refers to '${file.fileName}', which was not found`,
                    'CueSheetReader',
                    'resolveAudioFiles',
                );
                continue;
            }

            const audioPath = path.join(directory, entry);

            if (result.some((x) => x.audioPath === audioPath)) {
                continue;
            }

            const sorted = [...file.tracks].sort((a, b) => a.startMs - b.startMs);
            const tracks = sorted.map((t, i) => ({
                number: t.number,
                title: t.title,
                performer: t.performer,
                composer: t.composer,
                startMs: t.startMs,
                nextStartMs: i + 1 < sorted.length ? sorted[i + 1].startMs : undefined,
            }));

            result.push({ audioPath, sheet: { performer: sheet.performer, title: sheet.title, genre: sheet.genre, year: sheet.year }, tracks });
        }

        return result;
    }

    #resolveEntry(cuePath, fileName, audioEntries, isSingleFileSheet) {
        // Sheets written on Windows can use backslashes. Only the file name part is used: the audio must sit next to the sheet.
        const name = fileName.split(/[\\/]/).pop();
        const lowerName = name.toLowerCase();

        const exact = audioEntries.find((x) => x === name);
        if (exact !== undefined) {
            return exact;
        }

        const differentCase = audioEntries.find((x) => x.toLowerCase() === lowerName);
        if (differentCase !== undefined) {
            return differentCase;
        }

        const baseName = this.#stripExtension(lowerName);
        const otherExtension = audioEntries.find((x) => this.#stripExtension(x.toLowerCase()) === baseName);
        if (otherExtension !== undefined) {
            return otherExtension;
        }

        // Small spelling differences ("13. Molested,Digested.flac" for "13. Molested, Digested.flac"): compare letters and
        // digits only, and only accept a single match so a sheet never picks a file by guessing.
        const looseName = this.#looseName(baseName);
        const looseMatches = audioEntries.filter((x) => this.#looseName(this.#stripExtension(x.toLowerCase())) === looseName);
        if (looseName.length > 0 && looseMatches.length === 1) {
            return looseMatches[0];
        }

        if (!isSingleFileSheet) {
            return undefined;
        }

        // "Album.flac.cue" -> "album.flac"; "Album.cue" -> "album"
        const cueBaseName = this.#stripExtension(path.basename(cuePath).toLowerCase());
        const namedLikeSheet = audioEntries.find(
            (x) => x.toLowerCase() === cueBaseName || this.#stripExtension(x.toLowerCase()) === this.#stripExtension(cueBaseName),
        );
        if (namedLikeSheet !== undefined) {
            return namedLikeSheet;
        }

        return audioEntries.length === 1 ? audioEntries[0] : undefined;
    }

    #looseName(name) {
        return name.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    }

    #stripExtension(fileName) {
        const extension = path.extname(fileName);
        return extension.length > 0 ? fileName.substring(0, fileName.length - extension.length) : fileName;
    }
}

exports.CueSheetReader = CueSheetReader;
