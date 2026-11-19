#!/usr/bin/env node
// UserPromptSubmit hook (see .claude/settings.json): flags prompts that start work which needs high effort, so a
// session running at medium effort does not spend usage on a task it is likely to get wrong and redo.
// It shows the user a one-line warning and tells Claude to confirm the effort level before starting.
// Skip it for one prompt by adding "#high" (already on high) or "#medium" (medium is fine).
// Edit the list below to change what counts as high effort.
const highEffort = [
    [/\b(angular|electron|rxjs|typescript|jest|eslint)\b.{0,40}\b(upgrade|update|migrat|major|\d{2})/i, 'framework major upgrade'],
    [/\bcontext ?isolation|\bpreload\b|@electron\/remote|node ?integration|hardening\b/i, 'Electron security hardening'],
    [/\bmigration\b|\bschema\b|\bdatabase\b.{0,30}\b(change|column|table)/i, 'database migration (cannot be undone)'],
    [/\b(gapless|crossfade|audio (engine|player)|playback)\b.{0,40}\b(bug|broken|fail|glitch|click|gap|rewrite)/i, 'audio playback change or bug'],
    [/\b(vulnerab|security|cve|xss|sanitiz)/i, 'security fix'],
    [/\brefactor|\brewrite\b|\barchitecture\b/i, 'refactor'],
    [/\b(can'?t|cannot|couldn'?t|not) reproduc|\bintermittent|\brandom(ly)? (fail|crash)/i, 'hard-to-reproduce bug'],
];

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
    let prompt = '';
    try {
        prompt = String(JSON.parse(input).prompt ?? '');
    } catch {
        return;
    }
    if (/#(high|medium)\b/i.test(prompt)) return;
    const reasons = [...new Set(highEffort.filter(([re]) => re.test(prompt)).map(([, why]) => why))];
    if (reasons.length === 0) return;
    const list = reasons.join(', ');
    process.stdout.write(
        JSON.stringify({
            systemMessage: `High-effort task? (${list}). If this session is on medium, switch with /effort high, or add #medium to skip this check.`,
            hookSpecificOutput: {
                hookEventName: 'UserPromptSubmit',
                additionalContext:
                    `effort-check: this prompt looks like high-effort work (${list}); see "Effort and usage" in CLAUDE.md. ` +
                    'Unless you know this session runs at high effort or more, say so in one line and ask the user to confirm before starting the work. ' +
                    'Read-only questions about it can be answered right away.',
            },
        }),
    );
});
