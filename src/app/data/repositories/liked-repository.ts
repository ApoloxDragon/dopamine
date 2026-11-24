/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@angular/core';
import { DatabaseFactory } from '../database-factory';
import { LikedKind, LikedRepositoryBase } from './liked-repository.base';

@Injectable()
export class LikedRepository implements LikedRepositoryBase {
    public constructor(private databaseFactory: DatabaseFactory) {}

    public getAll(kind: LikedKind): Map<string, number> {
        const database: any = this.databaseFactory.create();
        const rows: { key: string; value: number }[] = database
            .prepare('SELECT Key AS key, Value AS value FROM Liked WHERE Kind = ?;')
            .all(kind);

        return new Map(rows.filter((x) => x.value === 1 || x.value === -1).map((x) => [x.key, x.value]));
    }

    public set(kind: LikedKind, key: string, value: number, atMs: number): void {
        const database: any = this.databaseFactory.create();

        if (value === 1 || value === -1) {
            database
                .prepare(
                    'INSERT INTO Liked (Kind, Key, Value, LikedAtMs) VALUES (?, ?, ?, ?) ON CONFLICT(Kind, Key) DO UPDATE SET Value = excluded.Value, LikedAtMs = excluded.LikedAtMs;',
                )
                .run(kind, key, value, Math.round(atMs));
        } else {
            database.prepare('DELETE FROM Liked WHERE Kind = ? AND Key = ?;').run(kind, key);
        }
    }
}
