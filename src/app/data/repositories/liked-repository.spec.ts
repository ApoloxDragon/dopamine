/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
// Real SQLite, through the app's own migrator (runs with: npm run test-database-integration).
import { DatabaseFactory } from '../database-factory';
import { DatabaseMigrator } from '../database-migrator';
import { Logger } from '../../common/logger';
import { LikedRepository } from './liked-repository';

const Database = require('better-sqlite3');

describe('LikedRepository', () => {
    let database: any;
    let repository: LikedRepository;

    beforeEach(() => {
        database = new Database(':memory:');
        const factory: DatabaseFactory = { create: (): any => database } as DatabaseFactory;
        new DatabaseMigrator(factory, {
            info: (): void => undefined,
            warn: (): void => undefined,
            error: (): void => undefined,
        } as unknown as Logger).migrate();
        repository = new LikedRepository(factory);
    });

    afterEach(() => database.close());

    it('should be at database version 18 with an empty Liked table', () => {
        expect(database.pragma('user_version', { simple: true })).toBe(18);
        expect(repository.getAll('album').size).toBe(0);
    });

    it('should store, change and remove likes, per kind', () => {
        repository.set('album', 'paranoid', 1, 1);
        repository.set('artist', 'paranoid', -1, 1);
        repository.set('album', 'paranoid', -1, 2);

        expect(repository.getAll('album')).toEqual(new Map([['paranoid', -1]]));
        expect(repository.getAll('artist')).toEqual(new Map([['paranoid', -1]]));

        repository.set('album', 'paranoid', 0, 3);
        expect(repository.getAll('album').size).toBe(0);
    });

    it("should keep keys with quotes, NUL and emoji exactly, and ignore values that aren't 1 or -1", () => {
        const keys: string[] = ["O'Brien", "'); DROP TABLE Liked; --", 'a\u0000b', '🦎', '%', '_'];
        keys.forEach((key) => repository.set('artist', key, 1, 1));
        repository.set('artist', 'seven', 7, 1);

        expect([...repository.getAll('artist').keys()].sort()).toEqual([...keys].sort());
    });
});
