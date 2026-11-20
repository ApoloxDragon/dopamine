#!/usr/bin/env node
// Release notes in this fork's own format, for people who just use the app:
//
//   ## What's Changed
//   <the short intro of the change log section>
//   ### New / ### Changed / ### Fixed / ### Good to know      (plain-language items from CHANGELOG.md)
//   ### Pull requests                                          (one line each: title and link, for those who want detail)
//   **Full Changelog**: <compare link>
//
// The items come from CHANGELOG.md, which is written in plain words (technical detail goes in docs/cue-support/LOG.md).
// Only the pull request lines and the compare link are taken from GitHub's generated notes.
//
// Usage: node scripts/release-notes.js <version> [github-generated-notes.md] > notes.md
// Fails only when CHANGELOG.md has no section for the version.
const fs = require('fs');
const path = require('path');

// Change log headings and what the release page calls them, in page order.
const sectionNames = [
    ['Added', 'New'],
    ['Changed', 'Changed'],
    ['Fixed', 'Fixed'],
    ['Security', 'Security'],
    ['Removed', 'Removed'],
    ['Good to know', 'Good to know'],
];

/** The lines of this version's section of CHANGELOG.md, or undefined. */
function changelogSection(changelog, version) {
    const lines = changelog.split(/\r?\n/);
    const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));

    if (start < 0) {
        return undefined;
    }

    const end = lines.findIndex((line, i) => i > start && /^## \[/.test(line));
    const section = lines.slice(start + 1, end < 0 ? undefined : end);

    return section.join('\n').trim().length > 0 ? section : undefined;
}

/** { intro, parts: Map<heading, text> } from the section's lines. */
function splitSection(lines) {
    const parts = new Map();
    const intro = [];
    let current;

    for (const line of lines) {
        const heading = /^###\s+(.+?)\s*$/.exec(line);

        if (heading) {
            current = heading[1];
            parts.set(current, []);
        } else if (current === undefined) {
            intro.push(line);
        } else {
            parts.get(current).push(line);
        }
    }

    const text = (x) => x.join('\n').trim();

    return { intro: text(intro), parts: new Map([...parts].map(([k, v]) => [k, text(v)]).filter(([, v]) => v.length > 0)) };
}

/** The pull request lines and the compare link from GitHub's generated notes ("* Title by @user in https://…/pull/12"). */
function fromGitHubNotes(generated) {
    const pullRequests = [];
    let compare;

    for (const line of (generated ?? '').split(/\r?\n/)) {
        const pr = /^\*\s+(.+?)(?:\s+by\s+@\S+)?\s+in\s+(https:\/\/\S+\/pull\/\d+)\s*$/.exec(line.trim());

        if (pr) {
            pullRequests.push(`* ${pr[1]} in ${pr[2]}`);
        }

        const link = /^\*\*Full Changelog\*\*:\s*(https:\/\/\S+)/.exec(line.trim());

        if (link) {
            compare = link[1];
        }
    }

    return { pullRequests, compare };
}

function format(sectionLines, generated) {
    const { intro, parts } = splitSection(sectionLines);
    const { pullRequests, compare } = fromGitHubNotes(generated);
    const out = ["## What's Changed", ''];

    if (intro.length > 0) {
        out.push(intro, '');
    }

    const known = new Set(sectionNames.map(([heading]) => heading));
    const ordered = [
        ...sectionNames.filter(([heading]) => parts.has(heading)),
        // Any other heading in the change log is kept, under its own name, after the known ones.
        ...[...parts.keys()].filter((heading) => !known.has(heading)).map((heading) => [heading, heading]),
    ];

    for (const [heading, name] of ordered) {
        out.push(`### ${name}`, '', parts.get(heading), '');
    }

    if (pullRequests.length > 0) {
        out.push('### Pull requests', '', ...pullRequests, '');
    }

    if (compare !== undefined) {
        out.push(`**Full Changelog**: ${compare}`, '');
    }

    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

if (require.main === module) {
    const [version, generatedFile] = process.argv.slice(2);

    if (!version) {
        console.error('Usage: release-notes.js <version> [github-generated-notes.md]');
        process.exit(2);
    }

    const section = changelogSection(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'), version);

    if (section === undefined) {
        console.error(`CHANGELOG.md has no section for ${version}`);
        process.exit(1);
    }

    let generated = '';
    try {
        generated = generatedFile ? fs.readFileSync(generatedFile, 'utf8') : '';
    } catch (e) {
        // No generated notes: the page has no pull request list, the rest is the same.
    }

    process.stdout.write(format(section, generated));
}

module.exports = { changelogSection, splitSection, fromGitHubNotes, format };
