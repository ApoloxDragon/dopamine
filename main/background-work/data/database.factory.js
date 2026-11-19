const Database = require('better-sqlite3');

class DatabaseFactory {
    constructor(fileAccess, workerProxy) {
        this.fileAccess = fileAccess;
        this.workerProxy = workerProxy;
    }

    create() {
        const databaseFile = this.fileAccess.combinePath([this.workerProxy.applicationDataDirectory(), 'Dopamine.db']);

        const database = new Database(databaseFile);
        DatabaseFactory.useWriteAheadLog(database);

        return database;
    }

    /**
     * WAL journal mode: the indexing worker and the window can use the database at the same time (in the default mode
     * every write blocks all readers, and writes from the window failed with "database is locked" during indexing).
     * The mode is stored in the database file, so after the first switch this is a no-op. If the switch fails (another
     * connection is writing at that moment), the next connection tries again. Same as src/app/data/database-factory.ts.
     */
    static useWriteAheadLog(database) {
        try {
            database.pragma('journal_mode = WAL');
        } catch (e) {
            // Retried by the next connection.
        }
    }
}

exports.DatabaseFactory = DatabaseFactory;
