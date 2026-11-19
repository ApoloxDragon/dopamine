#!/usr/bin/env node
// Creates a Dopamine database (all migrations) filled with about 40 days of made-up listening history, with detailed
// statistics (end reasons, furthest position, heard parts), to look at the Statistics page. Deterministic.
//
// Usage: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/dev/seed-statistics.js <Dopamine.db>
//   (run with Electron's Node when the app will open the file, so better-sqlite3 matches; plain node works for
//   scripts that use better-sqlite3 built for Node)
const path = require('path');
const { createSandboxDatabase } = require('./db-sandbox');

const file = process.argv[2];
if (!file) {
    console.error('Usage: seed-statistics.js <Dopamine.db>');
    process.exit(2);
}

const db = createSandboxDatabase(file);
let state = 42;
const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
};

const albums = [
    { artist: 'Fleshgod Apocalypse', album: 'Oracles', tracks: ['In Honour Of Reason', 'Post-Enlightenment Executor', 'Thru Our Scars'] },
    { artist: '1914', album: 'Where Fear and Weapons Meet', tracks: ['War In', 'Fn .380 Acp#19074', 'Vimy Ridge', 'Coward'] },
    { artist: 'Cattle Decapitation', album: 'Homovore', tracks: ['Bodily Abuse', 'Molested, Digested', 'Regurgitate'] },
    { artist: 'Schubert', album: 'Winterreise', tracks: ['Gute Nacht', 'Die Wetterfahne', 'Gefrorene Tränen', 'Der Lindenbaum'] },
];

const insert = db.prepare(
    `INSERT INTO ListeningSession (TrackPath, TrackTitle, Artists, AlbumTitle, AlbumArtists, AlbumKey, StartedAtMs, ListenedMs,
        TrackDurationMs, IsCountedAsPlay, EndReason, FurthestPositionMs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insertPart = db.prepare('INSERT INTO ListeningSegment (ListeningSessionID, StartedAtMs, FromMs, ToMs) VALUES (?, ?, ?, ?)');

const now = Date.now();
const day = 24 * 60 * 60 * 1000;
let sessions = 0;

db.transaction(() => {
    for (let d = 40; d >= 0; d--) {
        if (d % 9 === 4) continue; // some days without music, for the streaks
        const plays = 3 + Math.floor(random() * 12);
        // Mostly evenings, some mornings.
        let at = now - d * day - (now % day) + (random() < 0.3 ? 8 : 19) * 3600000;
        for (let p = 0; p < plays; p++) {
            const a = albums[Math.floor(random() * albums.length)];
            const t = Math.floor(random() * a.tracks.length);
            const duration = (180 + Math.floor(random() * 240)) * 1000;
            const r = random();
            const parts = [];
            let endReason;
            if (r < 0.6) {
                parts.push([0, duration]);
                endReason = 1;
            } else if (r < 0.85) {
                parts.push([0, Math.floor(duration * random() * 0.5)]);
                endReason = 2;
            } else {
                // Seeked: heard the start, then a replayed part.
                const from = Math.floor(duration * 0.4);
                parts.push([0, 30000], [from, from + 45000], [from, from + 45000], [from + 45000, duration]);
                endReason = 1;
            }
            const listened = parts.reduce((n, [f, e]) => n + (e - f), 0);
            if (at > now) break;
            const info = insert.run(
                `/music/${a.album}/${a.album}.flac|${t + 1}`,
                a.tracks[t],
                `;${a.artist};`,
                a.album,
                `;${a.artist};`,
                a.album.toLowerCase(),
                at,
                listened,
                duration,
                listened >= Math.min(duration / 2, 240000) ? 1 : 0,
                endReason,
                Math.max(...parts.map(([, e]) => e)),
            );
            let partAt = at;
            for (const [f, e] of parts) {
                insertPart.run(info.lastInsertRowid, partAt, f, e);
                partAt += e - f;
            }
            at += listened + 5000;
            sessions++;
        }
    }
})();

console.log(`Seeded ${sessions} plays into ${path.resolve(file)}`);
