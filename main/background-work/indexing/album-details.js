const path = require('path');

/**
 * Album details from an optional `dopamine.json` file in an album folder, to fix small things without retagging the music
 * files (which are never changed). For example:
 *
 *   { "year": 1970, "albumTitle": "Paranoid", "albumArtist": "Black Sabbath", "genre": "Heavy Metal", "discNumber": 1, "discCount": 2 }
 *
 * Every field is optional and applies to every song in that folder (not its subfolders). Unknown fields are ignored; a value
 * of the wrong kind is ignored and logged; a file that is too big or not valid JSON is ignored and logged. Results are kept
 * per folder for the rest of the refresh (the indexing worker is a new process every refresh).
 */
class AlbumDetails {
    static fileName = 'dopamine.json';
    static maximumBytes = 64 * 1024;
    static maximumTextLength = 500;

    constructor(fileAccess, logger, fileSystem = require('fs')) {
        this.fileAccess = fileAccess;
        this.logger = logger;
        this.fileSystem = fileSystem;
        this.cache = new Map();
    }

    /** The details for the folder of the given file, or undefined when there are none (or none that can be used). */
    forFile(filePath) {
        return this.#read(path.dirname(filePath)).details;
    }

    /** Ticks of the details file's last change (0 when there is none), to see when songs must be read again. */
    modifiedTicksForFile(filePath) {
        return this.#read(path.dirname(filePath)).modifiedTicks;
    }

    #read(directory) {
        const cached = this.cache.get(directory);

        if (cached !== undefined) {
            return cached;
        }

        const result = { details: undefined, modifiedTicks: 0 };
        const file = path.join(directory, AlbumDetails.fileName);

        try {
            const stats = this.fileSystem.statSync(file);

            if (stats.isFile()) {
                result.modifiedTicks = this.fileAccess.getDateModifiedInTicks(file);

                if (stats.size > AlbumDetails.maximumBytes) {
                    this.logger.warn(`'${file}' is too big (${stats.size} bytes) and was ignored`, 'AlbumDetails', 'read');
                } else {
                    result.details = AlbumDetails.parse(this.fileSystem.readFileSync(file, 'utf8'), (message) =>
                        this.logger.warn(`'${file}': ${message}`, 'AlbumDetails', 'read'),
                    );
                }
            }
        } catch (e) {
            // No details file (the usual case), or one that cannot be read: nothing to apply.
            if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') {
                this.logger.warn(`Could not read '${file}': ${e?.message ?? e}`, 'AlbumDetails', 'read');
            }
        }

        this.cache.set(directory, result);
        return result;
    }

    /** Checks the file's text. Returns the usable fields, or undefined when none are usable. */
    static parse(text, warn = () => {}) {
        let data;

        try {
            data = JSON.parse(String(text).replace(/^﻿/, ''));
        } catch (e) {
            warn('not valid JSON, ignored');
            return undefined;
        }

        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
            warn('must be an object like { "year": 1970 }, ignored');
            return undefined;
        }

        const details = {};
        const text1 = (key) => {
            const value = data[key];
            if (value === undefined) return undefined;
            if (
                typeof value === 'string' &&
                value.trim().length > 0 &&
                value.length <= AlbumDetails.maximumTextLength &&
                !value.includes('\0')
            ) {
                return value.trim();
            }
            warn(`"${key}" must be a non-empty text, ignored`);
            return undefined;
        };
        const textList = (key) => {
            const value = data[key];
            if (value === undefined) return undefined;
            const values = Array.isArray(value) ? value : [value];
            if (
                values.length > 0 &&
                values.length <= 50 &&
                values.every(
                    (x) => typeof x === 'string' && x.trim().length > 0 && x.length <= AlbumDetails.maximumTextLength && !x.includes('\0'),
                )
            ) {
                return values.map((x) => x.trim());
            }
            warn(`"${key}" must be a text or a list of texts, ignored`);
            return undefined;
        };
        const whole = (key, minimum, maximum) => {
            const value = data[key];
            if (value === undefined) return undefined;
            if (Number.isInteger(value) && value >= minimum && value <= maximum) {
                return value;
            }
            warn(`"${key}" must be a whole number from ${minimum} to ${maximum}, ignored`);
            return undefined;
        };

        details.albumTitle = text1('albumTitle');
        details.albumArtists = textList('albumArtist');
        details.genres = textList('genre');
        details.year = whole('year', 1000, 9999);
        details.discNumber = whole('discNumber', 1, 999);
        details.discCount = whole('discCount', 1, 999);

        if (details.discNumber !== undefined && details.discCount !== undefined && details.discNumber > details.discCount) {
            warn('"discNumber" is larger than "discCount", both ignored');
            details.discNumber = undefined;
            details.discCount = undefined;
        }

        const used = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));

        return Object.keys(used).length > 0 ? used : undefined;
    }
}

exports.AlbumDetails = AlbumDetails;
