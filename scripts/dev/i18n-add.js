#!/usr/bin/env node
// Adds translation keys to every language file (src/assets/i18n/*.json) and to the list of valid keys in
// src/app/common/application/i18n.spec.ts. The English text is used in every language (translators can change it).
// Keys are inserted after an existing key, keeping the files' formatting. Refuses keys that already exist.
//
// Usage: node scripts/dev/i18n-add.js <after-key> <keys.json>
//   keys.json: { "new-key": "English text", ... } (in the order they should appear)
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const [afterKey, keysFile] = process.argv.slice(2);
if (!afterKey || !keysFile) {
    console.error('Usage: i18n-add.js <after-key> <keys.json>');
    process.exit(2);
}
const keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
const names = Object.keys(keys);

const i18nDir = path.join(root, 'src/assets/i18n');
const files = fs.readdirSync(i18nDir).filter((f) => f.endsWith('.json'));
for (const file of files) {
    const filePath = path.join(i18nDir, file);
    const text = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(text);
    const existing = names.filter((n) => n in data);
    if (existing.length > 0) {
        console.error(`${file}: already has ${existing.join(', ')}`);
        process.exit(1);
    }
    const lines = text.split('\n');
    const index = lines.findIndex((l) => l.trimStart().startsWith(`"${afterKey}":`));
    if (index < 0) {
        console.error(`${file}: key "${afterKey}" not found`);
        process.exit(1);
    }
    const indent = lines[index].match(/^\s*/)[0];
    const isLast = !lines[index].trimEnd().endsWith(',');
    if (isLast) lines[index] = lines[index].trimEnd() + ',';
    const added = names.map((n, i) => `${indent}${JSON.stringify(n)}: ${JSON.stringify(keys[n])}${i < names.length - 1 || !isLast ? ',' : ''}`);
    lines.splice(index + 1, 0, ...added);
    const result = lines.join('\n');
    JSON.parse(result); // must still be valid
    fs.writeFileSync(filePath, result);
}

const specPath = path.join(root, 'src/app/common/application/i18n.spec.ts');
const spec = fs.readFileSync(specPath, 'utf8').split('\n');
const specIndex = spec.findIndex((l) => l.trim() === `'${afterKey}',` || l.trim() === `"${afterKey}",`);
if (specIndex < 0) {
    console.error(`i18n.spec.ts: key "${afterKey}" not found in the list (the last key of the list is not supported)`);
    process.exit(1);
}
const specIndent = spec[specIndex].match(/^\s*/)[0];
spec.splice(specIndex + 1, 0, ...names.map((n) => `${specIndent}'${n}',`));
fs.writeFileSync(specPath, spec.join('\n'));

console.log(`Added ${names.length} keys to ${files.length} language files and i18n.spec.ts`);
