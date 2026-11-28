#!/usr/bin/env node
// Safeguard: a release build must never contain development-only features (dev warning, developer options, extra
// logging). They are switched on by package.json "apoloxChannel" unless it is "release" (src/app/common/application/dev-build.ts).
//
// Usage: node scripts/dev/check-release-channel.js              checks ./package.json (before building)
//        node scripts/dev/check-release-channel.js <app.asar>   checks the package.json packed into a built app
// Exits 1, with a message, when it is not a release build.
const fs = require('fs');
const path = require('path');

const target = process.argv[2];
let channel;

try {
    if (target === undefined) {
        channel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).apoloxChannel;
    } else if (target.endsWith('.asar')) {
        channel = JSON.parse(require('@electron/asar').extractFile(target, 'package.json').toString('utf8')).apoloxChannel;
    } else {
        channel = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).apoloxChannel;
    }
} catch (e) {
    console.error(`Could not read the build channel from ${target ?? 'package.json'}: ${e.message}`);
    process.exit(1);
}

if (channel !== 'release') {
    console.error(`Not a release build: apoloxChannel is ${JSON.stringify(channel)} in ${target ?? 'package.json'}.`);
    console.error('Development-only features would be in it. The release workflow must run "npm pkg set apoloxChannel=release" first.');
    process.exit(1);
}

console.log(`Release build confirmed (${target ?? 'package.json'}): no development-only features.`);
