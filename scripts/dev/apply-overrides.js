#!/usr/bin/env node
// Makes npm apply the "overrides" of package.json to packages that are already in package-lock.json.
// npm does not re-resolve locked nested copies when an override is added (they stay at the old version and show
// as "invalid" in npm ls). This removes the lock entries (and installed folders) that do not match their override,
// then runs npm install so they are resolved again under the override.
// Usage: node scripts/dev/apply-overrides.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '../..');
const semver = require(path.join(root, 'node_modules/semver'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lockPath = path.join(root, 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

let removed = 0;
// Flatten nested overrides ({ "parent": { "child": "^2" } }) into child selectors: their stale copies are re-resolved too.
const flat = [];
for (const [selector, target] of Object.entries(pkg.overrides ?? {})) {
    if (typeof target === 'string') flat.push([selector, target]);
    else for (const [child, childTarget] of Object.entries(target)) if (typeof childTarget === 'string' && child !== '.') flat.push([child, childTarget]);
}

for (const [selector, target] of flat) {
    const at = selector.lastIndexOf('@');
    const name = at > 0 ? selector.slice(0, at) : selector;
    const range = at > 0 ? selector.slice(at + 1) : '*';

    for (const [entry, info] of Object.entries(lock.packages)) {
        if (!(entry === `node_modules/${name}` || entry.endsWith(`/node_modules/${name}`))) continue;
        if (!info.version || !semver.satisfies(info.version, range) || semver.satisfies(info.version, target)) continue;
        delete lock.packages[entry];
        fs.rmSync(path.join(root, entry), { recursive: true, force: true });
        console.log(`re-resolve ${entry} (${info.version}, override ${selector} -> ${target})`);
        removed++;
    }
}

fs.writeFileSync(lockPath, JSON.stringify(lock, null, 4) + '\n');
console.log(removed === 0 ? 'Lockfile already matches the overrides.' : `Removed ${removed} stale entries; running npm install.`);
execSync('npm install --ignore-scripts --no-audit --no-fund', { cwd: root, stdio: 'ignore' });

// Verify: every locked copy covered by an override must now satisfy it (npm sometimes keeps the old version).
const after = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const stale = [];
for (const [selector, target] of flat) {
    const at = selector.lastIndexOf('@');
    const name = at > 0 ? selector.slice(0, at) : selector;
    const range = at > 0 ? selector.slice(at + 1) : '*';
    for (const [entry, info] of Object.entries(after.packages)) {
        if (!(entry === `node_modules/${name}` || entry.endsWith(`/node_modules/${name}`))) continue;
        if (info.version && semver.satisfies(info.version, range) && !semver.satisfies(info.version, target)) stale.push(`${entry}@${info.version} (wanted ${target})`);
    }
}
if (stale.length > 0) {
    console.log(`NOT applied (use a nested override: { "<parent>": { "<name>": "<version>" } }):\n  ${stale.join('\n  ')}`);
    process.exit(1);
}
console.log('Done: every override is applied.');
