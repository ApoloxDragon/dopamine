const { IndexablePath } = require('./indexable-path');
const { FileFormats } = require('../common/application/file-formats');
const { CueTrackPath } = require('./cue-track-path');

class IndexablePathFetcher {
    constructor(folderRepository, directoryWalker, fileAccess, logger, cueSheetReader = undefined) {
        this.folderRepository = folderRepository;
        this.directoryWalker = directoryWalker;
        this.fileAccess = fileAccess;
        this.logger = logger;
        this.cueSheetReader = cueSheetReader;
    }

    async getIndexablePathsForAllFoldersAsync() {
        const indexablePaths = [];
        let folders = [];

        try {
            folders = this.folderRepository.getFolders() ?? [];
        } catch (e) {
            this.logger.error(e, 'An error occurred while getting folders', 'IndexablePathFetcher', 'getIndexablePathsForAllFoldersAsync');
        }

        for (const folder of folders) {
            if (this.fileAccess.pathExists(folder.path)) {
                try {
                    const indexablePathsForFolder = await this.getIndexablePathsForSingleFolderAsync(
                        folder,
                        FileFormats.supportedAudioExtensions,
                    );

                    indexablePaths.push(...indexablePathsForFolder);
                } catch (e) {
                    this.logger.error(
                        e,
                        `Could not get indexable paths for folder '${folder.path}'`,
                        'IndexablePathFetcher',
                        'getIndexablePathsForAllFoldersAsync',
                    );
                }
            }
        }

        return indexablePaths;
    }

    async getIndexablePathsForSingleFolderAsync(folder, validFileExtensions) {
        const indexablePaths = [];

        try {
            const directoryWalkResult = await this.directoryWalker.getFilesInDirectoryAsync(folder.path);

            for (const e of directoryWalkResult.errors) {
                this.logger.error(
                    e,
                    `Error occurred while getting files recursively for folder '${folder.path}'`,
                    'IndexablePathFetcher',
                    'getIndexablePathsForSingleFolderAsync',
                );
            }

            // Audio files described by a .cue sheet are indexed as one virtual track per cue track instead of as one track.
            const audioPathsCoveredByCueSheets = this.#addCueTrackIndexablePaths(directoryWalkResult.filePaths, folder, indexablePaths);

            for (const filePath of directoryWalkResult.filePaths) {
                try {
                    const fileExtension = this.fileAccess.getFileExtension(filePath);

                    if (validFileExtensions.includes(fileExtension.toLowerCase()) && !audioPathsCoveredByCueSheets.has(filePath)) {
                        const dateModifiedInTicks = this.fileAccess.getDateModifiedInTicks(filePath);
                        indexablePaths.push(new IndexablePath(filePath, dateModifiedInTicks, folder.folderId));
                    }
                } catch (e) {
                    this.logger.error(
                        e,
                        `Error occurred while getting indexable path for file '${filePath}'`,
                        'IndexablePathFetcher',
                        'getIndexablePathsForSingleFolderAsync',
                    );
                }
            }
        } catch (e) {
            this.logger.error(
                e,
                `An error occurred while fetching indexable paths for folder '${folder.path}'`,
                'IndexablePathFetcher',
                'getIndexablePathsForSingleFolderAsync',
            );
        }

        return indexablePaths;
    }

    #addCueTrackIndexablePaths(filePaths, folder, indexablePaths) {
        const coveredAudioPaths = new Set();

        if (this.cueSheetReader === undefined) {
            return coveredAudioPaths;
        }

        // Sorted, so that when two sheets describe the same audio file the choice is stable between runs.
        const cuePaths = filePaths.filter((x) => this.fileAccess.getFileExtension(x).toLowerCase() === '.cue').sort();

        for (const cuePath of cuePaths) {
            try {
                for (const audioFile of this.cueSheetReader.read(cuePath)) {
                    if (coveredAudioPaths.has(audioFile.audioPath) || !this.fileAccess.pathExists(audioFile.audioPath)) {
                        continue;
                    }

                    coveredAudioPaths.add(audioFile.audioPath);

                    // A cue track is out of date when either the audio file or the sheet changes.
                    const dateModifiedInTicks = Math.max(
                        this.fileAccess.getDateModifiedInTicks(audioFile.audioPath),
                        this.fileAccess.getDateModifiedInTicks(cuePath),
                    );

                    for (const track of audioFile.tracks) {
                        indexablePaths.push(
                            new IndexablePath(CueTrackPath.create(audioFile.audioPath, track.number), dateModifiedInTicks, folder.folderId, {
                                audioPath: audioFile.audioPath,
                                cuePath: cuePath,
                            }),
                        );
                    }
                }
            } catch (e) {
                this.logger.error(e, `Could not index cue sheet '${cuePath}'`, 'IndexablePathFetcher', 'addCueTrackIndexablePaths');
            }
        }

        return coveredAudioPaths;
    }
}

exports.IndexablePathFetcher = IndexablePathFetcher;
