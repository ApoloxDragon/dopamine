const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
const { FileFormats } = require('./background-work/common/application/file-formats');

/**
 * The dopamine-audio:// protocol: streams a local audio file to the <audio> element, with HTTP ranges (needed to seek).
 *
 * It exists for FLAC files that Chromium's FFmpeg refuses to open, such as files whose embedded cover (a PICTURE
 * metadata block) has an empty MIME type ("DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed").
 * While streaming, it changes the block type byte of every PICTURE block to PADDING, which FFmpeg skips. Nothing else
 * changes and every byte keeps its offset, so ranges map 1:1. The file on disk is never written. The <audio> element
 * never shows covers (the app reads them from the file itself), so nothing is lost.
 *
 * The renderer only uses this protocol as a fallback, when a file cannot be opened through file:// (see
 * LegacyAudioPlayer). It serves only absolute paths of supported audio files, read-only.
 */
const scheme = 'dopamine-audio';

const flacBlockTypePadding = 1;
const flacBlockTypePicture = 6;
const flacBlockTypeInvalid = 127;
const maximumFlacMetadataBlocks = 1024;

const contentTypes = {
    '.flac': 'audio/flac',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.aac': 'audio/aac',
    '.webm': 'audio/webm',
};

/** Privileges for protocol.registerSchemesAsPrivileged (must be called before the app is ready). */
const privilegedScheme = { scheme, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } };

/** The URL of a local file on this protocol (PathUtils.createStreamingAudioFilePath builds the same URL in the renderer). */
function audioUrl(filePath) {
    return `${scheme}://audio/?path=${encodeURIComponent(filePath)}`;
}

/**
 * Byte changes that make FFmpeg skip the PICTURE blocks of a FLAC file: [{ offset, value }]. Empty for other files.
 * Reads only the metadata block headers at the start of the file.
 */
function flacPatches(fd, size) {
    const read = (offset, length) => {
        const buffer = Buffer.alloc(length);
        const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
        return bytesRead === length ? buffer : undefined;
    };

    const marker = read(0, 4);
    if (marker === undefined || marker.toString('latin1') !== 'fLaC') {
        return [];
    }

    const patches = [];
    let offset = 4;
    for (let i = 0; i < maximumFlacMetadataBlocks && offset + 4 <= size; i++) {
        const header = read(offset, 4);
        if (header === undefined) {
            break;
        }

        const isLast = (header[0] & 0x80) !== 0;
        const type = header[0] & 0x7f;
        const length = header.readUIntBE(1, 3);

        if (type === flacBlockTypeInvalid) {
            break;
        }

        if (type === flacBlockTypePicture) {
            // Keep the "last block" flag, change only the type.
            patches.push({ offset, value: (header[0] & 0x80) | flacBlockTypePadding });
        }

        offset += 4 + length;

        if (isLast) {
            break;
        }
    }

    return patches;
}

/** Parses a single "bytes=" range. Returns { start, end } (inclusive), undefined for no range, or null if not satisfiable. */
function parseRange(header, size) {
    if (header == undefined || header === '') {
        return undefined;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (match === null || (match[1] === '' && match[2] === '')) {
        return null;
    }

    let start;
    let end;
    if (match[1] === '') {
        // Suffix range: the last N bytes.
        const suffix = Number(match[2]);
        if (suffix === 0) {
            return null;
        }
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    }

    return start <= end && start < size ? { start, end } : null;
}

/** A stream that applies the patches to the bytes passing through, which start at file offset `start`. */
function patchingStream(patches, start) {
    let position = start;
    return new Transform({
        transform(chunk, encoding, callback) {
            const chunkEnd = position + chunk.length;
            for (const patch of patches) {
                if (patch.offset >= position && patch.offset < chunkEnd) {
                    chunk[patch.offset - position] = patch.value;
                }
            }
            position = chunkEnd;
            callback(null, chunk);
        },
    });
}

function textResult(status, text) {
    return { status, headers: { 'Content-Type': 'text/plain' }, text };
}

/**
 * Serves one request: { method, url, range } -> { status, headers, stream?, text? }. Kept free of fetch's Request and
 * Response so it can be tested anywhere; registerAudioProtocol wraps it for Electron.
 */
function serveAudio(request, fileSystem = fs) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return textResult(405, 'Method not allowed');
    }

    let filePath;
    try {
        filePath = new URL(request.url).searchParams.get('path');
    } catch (e) {
        return textResult(400, 'Bad request');
    }

    const extension = filePath == undefined ? '' : path.extname(filePath).toLowerCase();
    if (filePath == undefined || !path.isAbsolute(filePath) || !FileFormats.supportedAudioExtensions.includes(extension)) {
        return textResult(403, 'Only audio files can be streamed');
    }

    let size;
    let patches;
    let fd;
    try {
        fd = fileSystem.openSync(filePath, 'r');
        const stat = fileSystem.fstatSync(fd);
        if (!stat.isFile()) {
            return textResult(404, 'Not found');
        }
        size = stat.size;
        patches = extension === FileFormats.flac ? flacPatches(fd, size) : [];
    } catch (e) {
        return textResult(404, 'Not found');
    } finally {
        if (fd !== undefined) {
            fileSystem.closeSync(fd);
        }
    }

    const range = parseRange(request.range, size);
    if (range === null) {
        return { status: 416, headers: { 'Content-Range': `bytes */${size}` } };
    }

    const { start, end } = range ?? { start: 0, end: size - 1 };
    const status = range !== undefined ? 206 : 200;
    const headers = {
        'Content-Type': contentTypes[extension] ?? 'application/octet-stream',
        'Content-Length': String(size === 0 ? 0 : end - start + 1),
        'Accept-Ranges': 'bytes',
    };
    if (range !== undefined) {
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }

    if (request.method === 'HEAD' || size === 0) {
        return { status, headers };
    }

    const source = fileSystem.createReadStream(filePath, { start, end });
    const patched = patchingStream(patches, start);
    source.on('error', (e) => patched.destroy(e));
    source.pipe(patched);

    return { status, headers, stream: patched };
}

/** Registers the protocol handler. Call when the app is ready. */
function registerAudioProtocol(protocol, log) {
    protocol.handle(scheme, (request) => {
        try {
            const result = serveAudio({ method: request.method, url: request.url, range: request.headers.get('range') });
            const body = result.stream !== undefined ? Readable.toWeb(result.stream) : (result.text ?? null);
            return new Response(body, { status: result.status, headers: result.headers });
        } catch (e) {
            log.error(`[AudioProtocol] [handle] Could not serve ${request.url}: ${e instanceof Error ? e.message : String(e)}`);
            return new Response('Could not read the file', { status: 500 });
        }
    });
}

module.exports = { scheme, privilegedScheme, audioUrl, flacPatches, parseRange, patchingStream, serveAudio, registerAudioProtocol };
