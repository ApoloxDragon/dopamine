#!/usr/bin/env node
// Checks the equalizer against Chromium's own Web Audio engine:
// 1. The response curve drawn in the UI (ParametricEqualizer.responseDb) must match what the BiquadFilterNodes built by
//    AudioEqualizer really do (BiquadFilterNode.getFrequencyResponse), within 0.1 dB.
// 2. Audio passed through the equalizer (OfflineAudioContext) must have the expected level change.
// Usage: node scripts/dev/eq-harness/run.js
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');
const { chromium } = require('playwright');

async function main() {
    const work = fs.mkdtempSync('/tmp/eq-harness-');
    await esbuild.build({
        entryPoints: [path.join(__dirname, 'entry.ts')],
        bundle: true,
        outfile: path.join(work, 'bundle.js'),
        format: 'iife',
        target: 'es2020',
        logLevel: 'error',
    });
    fs.writeFileSync(path.join(work, 'index.html'), '<!doctype html><html><body><script src="bundle.js"></script></body></html>');

    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('page error:', e.message));
    await page.goto('file://' + path.join(work, 'index.html'));

    const result = await page.evaluate(async () => {
        const { AudioEqualizer, ParametricEqualizer: P } = window.eq;
        const sampleRate = 48000;
        const cases = {
            graphic: { filters: AudioEqualizer.graphicFilters([6, 4, 2, 0, -2, -3, 0, 3, 5, 6]), preamp: 0 },
            autoEq: {
                filters: P.toFilters(
                    P.parseApoText(
                        'Preamp: -6.2 dB\nFilter 1: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.70\nFilter 2: ON PK Fc 21 Hz Gain 7.4 dB Q 0.47\nFilter 3: ON PK Fc 3456 Hz Gain -4.2 dB Q 2.13\nFilter 4: ON HSC Fc 10000 Hz Gain -2.1 dB Q 0.70',
                    ).profile,
                ),
                preamp: -6.2,
            },
            passAndNotch: {
                filters: [
                    { type: 'highpass', frequency: 40, gain: 0, q: 0.71 },
                    { type: 'lowpass', frequency: 15000, gain: 0, q: 1.2 },
                    { type: 'notch', frequency: 60, gain: 0, q: 5 },
                    { type: 'peaking', frequency: 2500, gain: -8, q: 6 },
                ],
                preamp: 3,
            },
        };
        const frequencies = P.responseFrequencies(200).filter((f) => f < 19000);
        const out = {};

        for (const [name, c] of Object.entries(cases)) {
            const ctx = new OfflineAudioContext(1, 1, sampleRate);
            const eq = new AudioEqualizer(ctx);
            eq.setFilters(c.filters, c.preamp);

            // Chromium's measured response: product of each node's response, plus the preamp
            const measured = new Array(frequencies.length).fill(c.preamp);
            // eslint-disable-next-line no-underscore-dangle
            for (const node of eq._filters) {
                const mag = new Float32Array(frequencies.length);
                node.getFrequencyResponse(new Float32Array(frequencies), mag, new Float32Array(frequencies.length));
                mag.forEach((m, i) => (measured[i] += 20 * Math.log10(Math.max(m, 1e-12))));
            }

            const calculated = P.responseDb(c.filters, c.preamp, frequencies, sampleRate);
            let maxDiff = 0;
            calculated.forEach((v, i) => {
                // Ignore very deep notch values, where tiny numeric differences are huge in dB
                if (measured[i] > -40) maxDiff = Math.max(maxDiff, Math.abs(v - measured[i]));
            });
            out[name] = { maxDiffDb: +maxDiff.toFixed(4), filters: eq._filters.length };
        }

        // Real audio: a 1 kHz sine through a +6 dB peaking filter at 1 kHz, with a -2 dB preamp, should come out 4 dB louder
        async function rms(withEq) {
            const ctx = new OfflineAudioContext(1, sampleRate, sampleRate);
            const osc = ctx.createOscillator();
            osc.frequency.value = 1000;
            const eq = new AudioEqualizer(ctx);
            if (withEq) eq.setFilters([{ type: 'peaking', frequency: 1000, gain: 6, q: 1 }], -2);
            osc.connect(eq.input);
            eq.output.connect(ctx.destination);
            osc.start();
            const buffer = await ctx.startRendering();
            const data = buffer.getChannelData(0).slice(sampleRate / 2);
            return Math.sqrt(data.reduce((s, x) => s + x * x, 0) / data.length);
        }
        const flat = await rms(false);
        const boosted = await rms(true);
        out.audioLevelChangeDb = +(20 * Math.log10(boosted / flat)).toFixed(3);

        // Switching modes rebuilds the chain; changing values keeps the same nodes
        const ctx = new OfflineAudioContext(1, 1, sampleRate);
        const eq = new AudioEqualizer(ctx);
        const graphicNodes = eq._filters;
        eq.setGains([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        out.sameNodesForValueChange = eq._filters === graphicNodes || eq._filters.every((n, i) => n === graphicNodes[i]);
        eq.setFilters([{ type: 'peaking', frequency: 1000, gain: 3, q: 1 }], 0);
        out.rebuiltForParametric = eq._filters.length === 1;
        return out;
    });

    await browser.close();

    const checks = [
        ['graphic: drawn curve matches Chromium within 0.1 dB', result.graphic.maxDiffDb < 0.1],
        ['AutoEQ profile: drawn curve matches Chromium within 0.1 dB', result.autoEq.maxDiffDb < 0.1],
        ['high-pass, low-pass, notch, narrow cut: drawn curve matches Chromium within 0.1 dB', result.passAndNotch.maxDiffDb < 0.1],
        ['audio through +6 dB peak and -2 dB preamp is 4 dB louder', Math.abs(result.audioLevelChangeDb - 4) < 0.1],
        ['changing values keeps the same filter nodes (no clicks)', result.sameNodesForValueChange],
        ['switching to parametric rebuilds the chain', result.rebuiltForParametric],
    ];
    console.log(JSON.stringify(result));
    let failed = 0;
    for (const [name, ok] of checks) {
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
        if (!ok) failed++;
    }
    console.log(failed === 0 ? 'All equalizer checks passed' : `${failed} equalizer check(s) failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(2);
});
