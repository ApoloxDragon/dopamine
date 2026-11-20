#!/usr/bin/env node
// Release notes = this version's section of CHANGELOG.md (what changed, in words) + GitHub's generated notes (pull requests,
// new contributors, full changelog link), so a release page has both.
//
// Usage: node scripts/release-notes.js <version> [generated-notes.md] > notes.md
//   version: e.g. 3.3.0-apolox (the CHANGELOG.md header is "## [3.3.0-apolox] - date")
//   generated-notes.md: GitHub's notes (gh api .../releases/generate-notes --jq .body); optional, empty or missing is fine
// Fails only when CHANGELOG.md has no section for the version.
const fs = require('fs');
const path = require('path');

function changelogSection(changelog, version) {
    const lines = changelog.split(/\r?\n/);
    const header = `## [${version}]`;
    const start = lines.findIndex((line) => line.startsWith(header));

    if (start < 0) {
        return undefined;
    }

    const end = lines.findIndex((line, i) => i > start && /^## \[/.test(line));
    const section = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();

    return section.length > 0 ? section : undefined;
}

function combine(section, generated) {
    const extra = (generated ?? '').trim();

    if (extra.length === 0) {
        return `${section}\n`;
    }

    // GitHub's part keeps its own headings ("## What's Changed", "## New Contributors", "**Full Changelog**").
    return `${section}\n\n---\n\n${extra}\n`;
}

if (require.main === module) {
    const [version, generatedFile] = process.argv.slice(2);

    if (!version) {
        console.error('Usage: release-notes.js <version> [generated-notes.md]');
        process.exit(2);
    }

    const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
    const section = changelogSection(changelog, version);

    if (section === undefined) {
        console.error(`CHANGELOG.md has no section for ${version}`);
        process.exit(1);
    }

    let generated = '';
    try {
        generated = generatedFile ? fs.readFileSync(generatedFile, 'utf8') : '';
    } catch (e) {
        // No generated notes: the change log alone is enough.
    }

    process.stdout.write(combine(section, generated));
}

module.exports = { changelogSection, combine };
