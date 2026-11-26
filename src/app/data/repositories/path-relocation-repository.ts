/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@angular/core';
import { DatabaseFactory } from '../database-factory';
import { PathRelocationRepositoryBase } from './path-relocation-repository.base';

/** A column that holds a path ("path"), or a key that starts with ";<path>" (album keys of folder grouping). */
interface RelocatedColumn {
    table: string;
    column: string;
    style: 'path' | 'key';
    /** Kept as the lower-case copy of the column. */
    safeColumn?: string;
    where?: string;
}

@Injectable()
export class PathRelocationRepository implements PathRelocationRepositoryBase {
    public static readonly columns: RelocatedColumn[] = [
        { table: 'Folder', column: 'Path', style: 'path', safeColumn: 'SafePath' },
        { table: 'Track', column: 'Path', style: 'path', safeColumn: 'SafePath' },
        { table: 'Track', column: 'AudioPath', style: 'path' },
        { table: 'Track', column: 'CuePath', style: 'path' },
        { table: 'Track', column: 'AlbumKey3', style: 'key' },
        { table: 'RemovedTrack', column: 'Path', style: 'path', safeColumn: 'SafePath' },
        { table: 'QueuedTrack', column: 'Path', style: 'path', safeColumn: 'SafePath' },
        { table: 'TrackStatistic', column: 'Path', style: 'path', safeColumn: 'SafePath' },
        { table: 'PlaylistSessionTrack', column: 'Path', style: 'path' },
        { table: 'ListeningSession', column: 'TrackPath', style: 'path' },
        { table: 'ListeningSession', column: 'AlbumKey', style: 'key' },
        { table: 'Liked', column: 'Key', style: 'key', where: "Kind = 'album'" },
    ];

    public constructor(private databaseFactory: DatabaseFactory) {}

    public relocate(from: string, to: string): number | undefined {
        const source: string = PathRelocationRepository.trimEnd(from);
        const target: string = PathRelocationRepository.trimEnd(to);

        if (source.length === 0 || target.length === 0 || source === target) {
            return 0;
        }

        const database: any = this.databaseFactory.create();

        const alreadyThere: any = database
            .prepare("SELECT COUNT(*) AS count FROM Folder WHERE Path = @target OR substr(Path, 1, length(@target) + 1) = @target || '/';")
            .get({ target });

        if (alreadyThere.count > 0) {
            return undefined;
        }

        // Like the app's own SafePath (JavaScript lower case, which also handles letters such as "Ú").
        database.function('dopamine_lower', { deterministic: true }, (x: unknown) => (typeof x === 'string' ? x.toLowerCase() : x));

        const run = database.transaction((): number => {
            let changes: number = 0;

            for (const x of PathRelocationRepository.columns) {
                changes += database.prepare(PathRelocationRepository.sqlFor(x)).run({ source, target }).changes as number;
            }

            return changes;
        });

        return run() as number;
    }

    /** The UPDATE for one column. Only whole folder names match: "/a/music" moves "/a/music/x", never "/a/music-old/x". */
    public static sqlFor(x: RelocatedColumn): string {
        const extra: string = x.where !== undefined ? ` AND ${x.where}` : '';

        if (x.style === 'key') {
            return (
                `UPDATE OR REPLACE ${x.table} SET ${x.column} = ';' || @target || substr(${x.column}, length(@source) + 2) ` +
                `WHERE (substr(${x.column}, 1, length(@source) + 2) = ';' || @source || '/' ` +
                `OR substr(${x.column}, 1, length(@source) + 2) = ';' || @source || ';')${extra};`
            );
        }

        const moved: string = `@target || substr(${x.column}, length(@source) + 1)`;
        const safe: string = x.safeColumn !== undefined ? `, ${x.safeColumn} = dopamine_lower(${moved})` : '';

        return (
            `UPDATE ${x.table} SET ${x.column} = ${moved}${safe} ` +
            `WHERE (${x.column} = @source OR substr(${x.column}, 1, length(@source) + 1) = @source || '/')${extra};`
        );
    }

    private static trimEnd(path: string | undefined): string {
        return (path ?? '').replace(/\/+$/, '');
    }
}
