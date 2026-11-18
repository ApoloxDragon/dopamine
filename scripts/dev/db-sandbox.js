#!/usr/bin/env node
// Creates a SQLite database with every migration from src/app/data/migrations applied, for quick manual or scripted checks
// of repository code against the real schema.
//
//   const { createSandboxDatabase } = require('./scripts/dev/db-sandbox');
//   const db = createSandboxDatabase();          // in memory
//   const factory = { create: () => db };       // what the repositories expect
//
// CLI: node scripts/dev/db-sandbox.js [file.db]   -> prints the Track table columns (and writes the db file if given)
//
// Needs better-sqlite3 built for Node: npm rebuild better-sqlite3
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '../..');
const migrationsDir = path.join(root, 'src/app/data/migrations');

class Migration {
    constructor() {
        this.statements = [];
    }

    sql(statement) {
        this.statements.push(statement);
    }
}

function loadMigrations() {
    const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => /^migration\d+\.ts$/.test(f))
        .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));

    return files.map((file) => {
        const source = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
            .outputText;
        const module = { exports: {} };
        const requireShim = (request) => (request === '../migration' ? { Migration } : require(request));
        new Function('require', 'module', 'exports', js)(requireShim, module, module.exports);
        const MigrationClass = Object.values(module.exports)[0];
        const migration = new MigrationClass();
        migration.up();
        return migration;
    });
}

function createSandboxDatabase(file = ':memory:') {
    const db = new Database(file);

    for (const migration of loadMigrations()) {
        db.exec(migration.statements.join('\n'));
    }

    return db;
}

module.exports = { createSandboxDatabase, loadMigrations };

if (require.main === module) {
    const db = createSandboxDatabase(process.argv[2] ?? ':memory:');
    const columns = db.prepare('PRAGMA table_info(Track);').all();
    console.log(`Applied ${loadMigrations().length} migrations. Track has ${columns.length} columns:`);
    console.log(columns.map((c) => c.name).join(', '));
}
