#!/usr/bin/env node
// Compact report of npm audit findings, grouped per vulnerable package, with what it takes to fix each.
//
// Usage:
//   node scripts/dev/vuln-report.js                    critical + high, all dependencies
//   node scripts/dev/vuln-report.js --all              every severity
//   node scripts/dev/vuln-report.js --json out.json    also write the machine-readable result
//   node scripts/dev/vuln-report.js --check baseline   exit 1 when there are critical/high findings not in the baseline
//   node scripts/dev/vuln-report.js --write-baseline baseline
//
// For every vulnerable package it shows: severity, installed versions, whether it ships in the app ("app") or is
// only used to build/test ("dev"), the direct dependencies that pull it in, and the fix:
//   in-major: a fixed version exists that is compatible with the installed one (^installed; usually safe, see npm "overrides")
//   major:    only a new major version fixes it
//   none:     no fixed version published
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const semver = require(path.join(root, 'node_modules/semver'));
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const severities = args.includes('--all') ? ['critical', 'high', 'moderate', 'low'] : ['critical', 'high'];
const rank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };

function audit(omitDev) {
    const out = execSync(`npm audit --json${omitDev ? ' --omit=dev' : ''}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64e6 }).toString();
    return JSON.parse(out);
}

function safeAudit(omitDev) {
    try {
        return audit(omitDev);
    } catch (e) {
        // npm audit exits 1 when it finds something; the JSON is still on stdout.
        return JSON.parse(e.stdout.toString());
    }
}

const versionsCache = new Map();
function publishedVersions(name) {
    if (!versionsCache.has(name)) {
        try {
            const out = execSync(`npm view ${name} versions --json`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
            versionsCache.set(name, [].concat(JSON.parse(out)));
        } catch {
            versionsCache.set(name, []);
        }
    }
    return versionsCache.get(name);
}

const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const direct = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);

function installedVersions(name) {
    return [...new Set(Object.entries(lock.packages).filter(([p]) => p === `node_modules/${name}` || p.endsWith(`/node_modules/${name}`)).map(([, v]) => v.version).filter(Boolean))];
}

// Walk "via" (package names) up to the direct dependencies that bring a package in.
function roots(vulns, name, seen = new Set()) {
    if (seen.has(name)) return [];
    seen.add(name);
    const v = vulns[name];
    const result = new Set();
    if (direct.has(name)) result.add(name);
    for (const effect of v?.effects ?? []) {
        for (const r of roots(vulns, effect, seen)) result.add(r);
    }
    return [...result];
}

const all = safeAudit(false);
const shipped = safeAudit(true);
const vulns = all.vulnerabilities ?? {};

// One row per package that has its own advisories (not only "via" other packages).
const rows = [];
for (const [name, v] of Object.entries(vulns)) {
    const advisories = v.via.filter((x) => typeof x === 'object');
    if (advisories.length === 0) continue;
    const severity = advisories.map((a) => a.severity).sort((a, b) => rank[a] - rank[b])[0];
    if (!severities.includes(severity)) continue;

    const installed = installedVersions(name);
    const published = publishedVersions(name).filter((x) => !semver.prerelease(x));
    const isFixed = (version) => advisories.every((a) => !semver.satisfies(version, a.range, { includePrerelease: true }));
    const vulnerable = installed.filter((x) => !isFixed(x));
    const fixes = vulnerable.map((x) => {
        // "Compatible" as npm defines it (^x): same major, and for 0.x versions also the same minor.
        const inMajor = published.filter((p) => semver.satisfies(p, `^${x}`) && semver.gt(p, x) && isFixed(p));
        const any = published.filter((p) => semver.gt(p, x) && isFixed(p));
        if (inMajor.length > 0) return { from: x, kind: 'in-major', to: semver.minSatisfying(inMajor, '*') };
        if (any.length > 0) return { from: x, kind: 'major', to: semver.minSatisfying(any, '*') };
        return { from: x, kind: 'none', to: '' };
    });

    rows.push({
        name,
        severity,
        app: Boolean(shipped.vulnerabilities?.[name]),
        installed: vulnerable,
        fixes,
        roots: roots(vulns, name).sort(),
        titles: [...new Set(advisories.map((a) => a.title))],
        ids: advisories.map((a) => a.source).sort((a, b) => a - b),
    });
}

rows.sort((a, b) => rank[a.severity] - rank[b.severity] || Number(b.app) - Number(a.app) || a.name.localeCompare(b.name));

const meta = all.metadata?.vulnerabilities ?? {};
const metaShipped = shipped.metadata?.vulnerabilities ?? {};
console.log(
    `npm audit: ${meta.total} packages (critical ${meta.critical}, high ${meta.high}, moderate ${meta.moderate}, low ${meta.low}); in the app: ${metaShipped.total} (critical ${metaShipped.critical}, high ${metaShipped.high})`,
);
console.log(`Packages with their own ${severities.join('/')} advisories: ${rows.length}\n`);
for (const r of rows) {
    const fix = r.fixes.map((f) => `${f.from}->${f.to || '?'} ${f.kind}`).join(', ') || 'fixed in lockfile';
    console.log(`${r.severity.padEnd(8)} ${r.app ? 'app' : 'dev'}  ${r.name.padEnd(34)} ${fix}`);
    console.log(`         from: ${r.roots.join(', ') || '(transitive)'}  |  ${r.titles[0].slice(0, 90)}${r.titles.length > 1 ? ` (+${r.titles.length - 1})` : ''}`);
}

if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(rows, null, 2));

// Baseline: every advisory (all severities) known today, as "package#advisory-id" with its severity.
// --check fails on new critical/high advisories and warns about new moderate/low ones (those are often published for
// packages that did not change, so they should not block unrelated work).
const advisoryMap = {};
for (const [name, v] of Object.entries(vulns)) {
    for (const a of v.via) {
        if (typeof a === 'object') advisoryMap[`${name}#${a.source}`] = a.severity;
    }
}
if (arg('--write-baseline')) {
    const sorted = Object.fromEntries(Object.entries(advisoryMap).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(
        arg('--write-baseline'),
        JSON.stringify({ note: 'Known npm advisories (package#advisory: severity). Update with --write-baseline after fixing. See docs/dependency-upgrade-plan.md.', advisories: sorted }, null, 2) + '\n',
    );
    console.log(`\nWrote ${Object.keys(sorted).length} known advisories to ${arg('--write-baseline')}`);
}
if (arg('--check')) {
    const baseline = JSON.parse(fs.readFileSync(arg('--check'), 'utf8')).advisories;
    // Older baselines were a list of critical/high ids.
    const known = Array.isArray(baseline) ? Object.fromEntries(baseline.map((x) => [x, 'high'])) : baseline;
    const added = Object.entries(advisoryMap).filter(([id]) => !(id in known));
    const removed = Object.keys(known).filter((id) => !(id in advisoryMap));
    const blocking = added.filter(([, sev]) => sev === 'critical' || sev === 'high');
    const warnings = added.filter(([, sev]) => sev !== 'critical' && sev !== 'high');
    if (removed.length > 0) console.log(`\nFixed since the baseline (${removed.length}): ${removed.join(', ')}  -> update the baseline`);
    if (warnings.length > 0) console.log(`\nWARNING new moderate/low advisories (${warnings.length}): ${warnings.map(([id, sev]) => `${id} (${sev})`).join(', ')}`);
    if (blocking.length > 0) {
        console.log(`\nNEW critical/high advisories (${blocking.length}): ${blocking.map(([id, sev]) => `${id} (${sev})`).join(', ')}`);
        process.exit(1);
    }
    console.log('\nNo new critical/high advisories compared to the baseline.');
}
