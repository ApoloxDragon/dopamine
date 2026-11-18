const { MimeTypes } = require('./mime-types');
const { StringUtils } = require('../common/utils/string-utils');
const { FileAccess } = require('../common/io/file-access');
const { CueTrackPath } = require('./cue-track-path');

class TrackFiller {
    constructor(
        fileMetadataFactory,
        albumKeyGenerator,
        trackFieldCreator,
        metadataPatcher,
        mimeTypes,
        fileAccess,
        dateTime,
        logger,
        cueSheetReader = undefined,
    ) {
        this.cueSheetReader = cueSheetReader;
        this.fileMetadataFactory = fileMetadataFactory;
        this.albumKeyGenerator = albumKeyGenerator;
        this.trackFieldCreator = trackFieldCreator;
        this.metadataPatcher = metadataPatcher;
        this.mimeTypes = mimeTypes;
        this.fileAccess = fileAccess;
        this.dateTime = dateTime;
        this.logger = logger;
    }

    addFileMetadataToTrack(track, fillOnlyEssentialMetadata) {
        try {
            // For CUE tracks, track.path is a virtual path. All file operations use the real album file.
            const audioPath = CueTrackPath.getAudioPath(track);
            const isCueTrack = CueTrackPath.isCueTrack(track);
            const fileMetadata = this.fileMetadataFactory.create(audioPath);

            track.artists = this.trackFieldCreator.createMultiTextField(
                this.metadataPatcher.joinUnsplittableMetadata(fileMetadata.artists),
            );

            const fileRating = this.trackFieldCreator.createNumberField(fileMetadata.rating);
            if (fileRating !== 0 && !isCueTrack) {
                track.rating = fileRating;
            }
            track.fileName = this.fileAccess.getFileName(audioPath);
            track.duration = this.trackFieldCreator.createNumberField(fileMetadata.durationInMilliseconds);
            track.trackTitle = this.trackFieldCreator.createTextField(fileMetadata.title);
            track.trackNumber = this.trackFieldCreator.createNumberField(fileMetadata.trackNumber);
            track.fileSize = this.fileAccess.getFileSizeInBytes(audioPath);
            track.albumKey = this.albumKeyGenerator.generateAlbumKey(
                fileMetadata.album,
                this.metadataPatcher.joinUnsplittableMetadata(fileMetadata.albumArtists),
            );
            track.albumKey2 = this.albumKeyGenerator.generateAlbumKey2(fileMetadata.album);
            track.albumKey3 = this.albumKeyGenerator.generateAlbumKey3(this.fileAccess.getDirectoryPath(audioPath));
            track.replayGainTrackGain = this.trackFieldCreator.createNumberField(fileMetadata.replayGainTrackGain);
            track.replayGainTrackPeak = this.trackFieldCreator.createNumberField(fileMetadata.replayGainTrackPeak);
            track.replayGainAlbumGain = this.trackFieldCreator.createNumberField(fileMetadata.replayGainAlbumGain);
            track.replayGainAlbumPeak = this.trackFieldCreator.createNumberField(fileMetadata.replayGainAlbumPeak);
            track.genres = this.trackFieldCreator.createMultiTextField(this.metadataPatcher.joinUnsplittableMetadata(fileMetadata.genres));
            track.albumTitle = this.trackFieldCreator.createTextField(fileMetadata.album);
            track.albumArtists = this.trackFieldCreator.createMultiTextField(
                this.metadataPatcher.joinUnsplittableMetadata(fileMetadata.albumArtists),
            );
            track.mimeType = this.#getMimeType(audioPath);
            track.bitRate = this.trackFieldCreator.createNumberField(fileMetadata.bitRate);
            track.sampleRate = this.trackFieldCreator.createNumberField(fileMetadata.sampleRate);
            track.trackCount = this.trackFieldCreator.createNumberField(fileMetadata.trackCount);
            track.discNumber = this.trackFieldCreator.createNumberField(fileMetadata.discNumber);
            track.discCount = this.trackFieldCreator.createNumberField(fileMetadata.discCount);
            track.year = this.trackFieldCreator.createNumberField(fileMetadata.year);
            track.hasLyrics = this.#getHasLyrics(fileMetadata.lyrics);
            track.composers = this.trackFieldCreator.createMultiTextField(
                this.metadataPatcher.joinUnsplittableMetadata(fileMetadata.composers),
            );
            track.conductor = this.trackFieldCreator.createTextField(fileMetadata.conductor);
            track.beatsPerMinute = this.trackFieldCreator.createNumberField(fileMetadata.beatsPerMinute);

            // Tag fields are already parsed above, so they are always filled. Only the extra file system
            // calls are skipped when only essential metadata is requested.
            if (!fillOnlyEssentialMetadata) {
                const dateNowTicks = this.dateTime.convertDateToTicks(new Date());

                track.dateAdded = dateNowTicks;
                track.dateFileCreated = this.fileAccess.getDateCreatedInTicks(audioPath);
                track.dateLastSynced = dateNowTicks;
                track.dateFileModified = this.fileAccess.getDateModifiedInTicks(audioPath);
            }

            if (isCueTrack) {
                this.#applyCueSheet(track, fileMetadata, fillOnlyEssentialMetadata);
            }

            track.needsIndexing = 0;
            track.needsAlbumArtworkIndexing = 1;
            track.indexingSuccess = 1;
            track.indexingFailureReason = '';
        } catch (e) {
            track.indexingSuccess = 0;
            track.indexingFailureReason = e instanceof Error ? e.message : 'Unknown error';

            this.logger.error(
                e,
                `Error while retrieving tag information for file ${track.path}`,
                'TrackFiller',
                'addFileMetadataToTrackAsync',
            );
        }

        return track;
    }

    addReplayGainMetadataToTrack(track) {
        try {
            const fileMetadata = this.fileMetadataFactory.create(CueTrackPath.getAudioPath(track));

            track.replayGainTrackGain = this.trackFieldCreator.createNumberField(fileMetadata.replayGainTrackGain);
            track.replayGainTrackPeak = this.trackFieldCreator.createNumberField(fileMetadata.replayGainTrackPeak);
            track.replayGainAlbumGain = this.trackFieldCreator.createNumberField(fileMetadata.replayGainAlbumGain);
            track.replayGainAlbumPeak = this.trackFieldCreator.createNumberField(fileMetadata.replayGainAlbumPeak);

            track.indexingSuccess = 1;
            track.indexingFailureReason = '';
        } catch (e) {
            track.indexingSuccess = 0;
            track.indexingFailureReason = e instanceof Error ? e.message : 'Unknown error';

            this.logger.error(
                e,
                `Error while retrieving ReplayGain information for file ${track.path}`,
                'TrackFiller',
                'addReplayGainMetadataToTrack',
            );
        }

        return track;
    }

    /**
     * Overrides the whole-file tags with the values of this track in the .cue sheet. Sheet values win when present;
     * tags of the album file are kept as fallback (e.g. a sheet without REM GENRE keeps the file's genre).
     * Throws when the track is no longer in the sheet, so the track is marked as failed instead of getting wrong data.
     */
    #applyCueSheet(track, fileMetadata, fillOnlyEssentialMetadata) {
        if (this.cueSheetReader === undefined) {
            throw new Error('Cue sheet support is not available');
        }

        const parsedPath = CueTrackPath.parse(track.path);
        const cueTrack = parsedPath === undefined ? undefined : this.cueSheetReader.getTrack(track.cuePath, track.audioPath, parsedPath.trackNumber);

        if (cueTrack === undefined) {
            throw new Error(`Track not found in cue sheet '${track.cuePath}'`);
        }

        const fileDurationMs = this.trackFieldCreator.createNumberField(fileMetadata.durationInMilliseconds);
        const endMs = cueTrack.nextStartMs ?? fileDurationMs;

        if (endMs <= cueTrack.startMs) {
            throw new Error(`Track ${cueTrack.number} in cue sheet '${track.cuePath}' starts after the end of the audio file`);
        }

        const albumTitle = cueTrack.sheet.title.length > 0 ? cueTrack.sheet.title : this.trackFieldCreator.createTextField(fileMetadata.album);
        const albumArtists =
            cueTrack.sheet.performer.length > 0
                ? [cueTrack.sheet.performer]
                : this.metadataPatcher.joinUnsplittableMetadata(fileMetadata.albumArtists);
        const performer = cueTrack.performer.length > 0 ? cueTrack.performer : cueTrack.sheet.performer;

        track.trackTitle = cueTrack.title;
        track.trackNumber = cueTrack.number;
        track.trackCount = cueTrack.trackCount;
        track.cueStartMs = cueTrack.startMs;
        track.cueEndMs = endMs;
        track.duration = endMs - cueTrack.startMs;
        track.fileName = this.fileAccess.getFileName(track.audioPath);

        if (performer.length > 0) {
            track.artists = this.trackFieldCreator.createMultiTextField([performer]);
        }

        if (cueTrack.composer.length > 0) {
            track.composers = this.trackFieldCreator.createMultiTextField([cueTrack.composer]);
        }

        if (cueTrack.sheet.genre.length > 0) {
            track.genres = this.trackFieldCreator.createMultiTextField([cueTrack.sheet.genre]);
        }

        if (cueTrack.sheet.year > 0) {
            track.year = cueTrack.sheet.year;
        }

        track.albumTitle = albumTitle;
        track.albumArtists = this.trackFieldCreator.createMultiTextField(albumArtists);
        track.albumKey = this.albumKeyGenerator.generateAlbumKey(albumTitle, albumArtists);
        track.albumKey2 = this.albumKeyGenerator.generateAlbumKey2(albumTitle);

        // Lyrics in the album file's tags belong to the whole album, not to this track.
        track.hasLyrics = 0;

        if (!fillOnlyEssentialMetadata) {
            // Must match the value IndexablePathFetcher uses, so the collection is not seen as outdated on every start.
            track.dateFileModified = Math.max(
                this.fileAccess.getDateModifiedInTicks(track.audioPath),
                this.fileAccess.getDateModifiedInTicks(track.cuePath),
            );
        }
    }

    #getMimeType(filePath) {
        return this.mimeTypes.getMimeTypeForFileExtension(this.fileAccess.getFileExtension(filePath));
    }

    #getHasLyrics(lyrics) {
        if (!StringUtils.isNullOrWhiteSpace(lyrics)) {
            return 1;
        }

        return 0;
    }
}

exports.TrackFiller = TrackFiller;
