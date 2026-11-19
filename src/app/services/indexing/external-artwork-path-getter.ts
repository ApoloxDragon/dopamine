import { Injectable } from '@angular/core';
import { Constants } from '../../common/application/constants';
import { StringUtils } from '../../common/utils/string-utils';
import { FileAccessBase } from '../../common/io/file-access.base';

@Injectable()
export class ExternalArtworkPathGetter {
    public constructor(private fileAccess: FileAccessBase) {}

    public async getExternalArtworkPathAsync(audioFilePath: string | undefined): Promise<string> {
        if (StringUtils.isNullOrWhiteSpace(audioFilePath)) {
            return '';
        }

        const directory: string = this.fileAccess.getDirectoryPath(audioFilePath!);
        const filesInDirectory: string[] = await this.fileAccess.getFilesInDirectoryAsync(directory);
        const audioFilePathWithoutExtension: string = this.fileAccess.getFileNameWithoutExtension(audioFilePath!);
        const lowerCaseCoverArtPossibilities: string[] = Constants.externalCoverArtPatterns.map((externalCoverArtPattern) => {
            return StringUtils.replaceAll(externalCoverArtPattern, '%filename%', audioFilePathWithoutExtension).toLowerCase();
        });

        const inAlbumFolder: string = this.findCover(filesInDirectory, lowerCaseCoverArtPossibilities);

        if (inAlbumFolder.length > 0) {
            return inAlbumFolder;
        }

        // Rips often keep the cover with the booklet scans: "Album/Artwork/Front.jpg", "Album/Scans/cover.jpg".
        return this.findCoverInArtworkSubfoldersAsync(directory, lowerCaseCoverArtPossibilities);
    }

    /** Names of subfolders (lower case) where a cover is also looked for. */
    public static readonly artworkSubfolderNames: string[] = ['artwork', 'artworks', 'scans', 'scan', 'covers', 'cover', 'art', 'images'];

    private findCover(filePaths: string[], lowerCaseCoverArtPossibilities: string[]): string {
        // In the order of the patterns, so "front" wins over "folder" whatever order the files are listed in.
        for (const possibility of lowerCaseCoverArtPossibilities) {
            const match: string | undefined = filePaths.find((x) => this.fileAccess.getFileName(x).toLowerCase() === possibility);

            if (match !== undefined) {
                return match;
            }
        }

        return '';
    }

    private async findCoverInArtworkSubfoldersAsync(directory: string, lowerCaseCoverArtPossibilities: string[]): Promise<string> {
        let subfolders: string[];

        try {
            subfolders = await this.fileAccess.getDirectoriesInDirectoryAsync(directory);
        } catch (e: unknown) {
            return '';
        }

        const artworkSubfolders: string[] = (subfolders ?? []).filter((x) =>
            ExternalArtworkPathGetter.artworkSubfolderNames.includes(this.fileAccess.getFileName(x).toLowerCase()),
        );

        for (const subfolder of artworkSubfolders) {
            try {
                const cover: string = this.findCover(
                    await this.fileAccess.getFilesInDirectoryAsync(subfolder),
                    lowerCaseCoverArtPossibilities,
                );

                if (cover.length > 0) {
                    return cover;
                }
            } catch (e: unknown) {
                // An unreadable subfolder is skipped.
            }
        }

        return '';
    }
}
