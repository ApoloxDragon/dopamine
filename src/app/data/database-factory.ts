/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@angular/core';
import Database from 'better-sqlite3';
import { FileAccessBase } from '../common/io/file-access.base';
import { DesktopBase } from '../common/io/desktop.base';

@Injectable()
export class DatabaseFactory {
    public constructor(
        private fileAccess: FileAccessBase,
        private desktop: DesktopBase,
    ) {}

    public create(): any {
        const databaseFile: string = this.fileAccess.combinePath([this.desktop.getApplicationDataDirectory(), 'Dopamine.db']);
        const database: any = new Database(databaseFile);
        DatabaseFactory.useWriteAheadLog(database);

        return database;
    }

    /**
     * WAL journal mode: the indexing worker and the window can use the database at the same time (in the default mode
     * every write blocks all readers, and writes from the window failed with "database is locked" during indexing).
     * The mode is stored in the database file, so after the first switch this is a no-op. If the switch fails (another
     * connection is writing at that moment), the next connection tries again. Same as
     * main/background-work/data/database.factory.js.
     */
    public static useWriteAheadLog(database: any): void {
        try {
            database.pragma('journal_mode = WAL');
        } catch (e: unknown) {
            // Retried by the next connection.
        }
    }
}
