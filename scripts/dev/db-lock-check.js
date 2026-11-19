#!/usr/bin/env node
// Compares the default journal mode with WAL (what DatabaseFactory sets) while one connection writes continuously, like
// the indexing worker, and another one does the window's small writes (listening statistics) every 50 ms.
// Reports how many of the window's writes failed ("database is locked") and how long the longest one blocked.
//
// Usage: node scripts/dev/db-lock-check.js [seconds]
// Needs better-sqlite3 built for Node (npm rebuild better-sqlite3); run scripts/dev/build-linux.sh or npm install
// again before building the app.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');

const root = path.resolve(__dirname, '../..');
const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const { DatabaseFactory } = require(path.join(root, 'main/background-work/data/database.factory'));

function open(dir, useFactory) {
    if (useFactory) {
        const factory = new DatabaseFactory({ combinePath: (parts) => path.join(...parts) }, { applicationDataDirectory: () => dir });
        return factory.create();
    }
    return new Database(path.join(dir, 'Dopamine.db'));
}

if (!isMainThread) {
    // The "indexer": continuous single-statement writes and reads, as the indexing worker does.
    const { dir, useFactory, seconds } = workerData;
    const db = open(dir, useFactory);
    const insert = db.prepare('INSERT INTO Track (Path, Data) VALUES (?, ?)');
    const count = db.prepare('SELECT COUNT(*) AS n FROM Track');
    const blob = 'x'.repeat(2000);
    const end = Date.now() + seconds * 1000;
    let writes = 0;
    while (Date.now() < end) {
        insert.run(`/music/${writes}.flac`, blob);
        if (writes % 50 === 0) count.get();
        writes++;
    }
    parentPort.postMessage(writes);
    return;
}

async function run(mode, seconds) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-lock-check-'));
    const useFactory = mode === 'wal';
    const setup = open(dir, useFactory);
    setup.exec('CREATE TABLE Track (TrackID INTEGER PRIMARY KEY, Path TEXT, Data TEXT); CREATE TABLE ListeningSession (Id INTEGER PRIMARY KEY, ListenedMs INTEGER);');
    setup.prepare('INSERT INTO ListeningSession (Id, ListenedMs) VALUES (1, 0)').run();
    const journalMode = setup.pragma('journal_mode', { simple: true });
    setup.close();

    const worker = new Worker(__filename, { workerData: { dir, useFactory, seconds } });
    const indexerWrites = new Promise((resolve) => worker.on('message', resolve));

    // The "window": a new connection per call, like the app's repositories, every 50 ms.
    let attempts = 0;
    let failures = 0;
    let longestMs = 0;
    const end = Date.now() + seconds * 1000;
    await new Promise((r) => setTimeout(r, 100));
    while (Date.now() < end - 100) {
        const started = Date.now();
        attempts++;
        try {
            const db = open(dir, useFactory);
            db.prepare('UPDATE ListeningSession SET ListenedMs = ? WHERE Id = 1').run(attempts * 50);
            db.prepare('SELECT COUNT(*) AS n FROM Track').get();
            db.close();
        } catch (e) {
            failures++;
        }
        longestMs = Math.max(longestMs, Date.now() - started);
        await new Promise((r) => setTimeout(r, 50));
    }

    const writes = await indexerWrites;
    fs.rmSync(dir, { recursive: true, force: true });
    return { mode: journalMode, indexerWrites: writes, windowWrites: attempts, failed: failures, longestBlockMs: longestMs };
}

(async () => {
    const seconds = Number(process.argv[2] ?? 4);
    const before = await run('default', seconds);
    const after = await run('wal', seconds);
    for (const r of [before, after]) {
        console.log(`${r.mode.padEnd(7)} indexer writes ${String(r.indexerWrites).padStart(6)} | window writes ${r.windowWrites}, failed ${r.failed}, longest block ${r.longestBlockMs} ms`);
    }
    const ok = after.mode === 'wal' && after.failed === 0 && after.longestBlockMs < 1000;
    console.log(ok ? 'PASS  with WAL the window can write while the indexer writes' : 'FAIL  the window is still blocked with WAL');
    process.exit(ok ? 0 : 1);
})();
