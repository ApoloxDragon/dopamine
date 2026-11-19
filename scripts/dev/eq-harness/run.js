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
        // Fade: a constant signal through the equalizer, faded out over 0.5 s from t = 0.
        async function renderFade(setup, seconds) {
            const ctx = new OfflineAudioContext(1, Math.round(sampleRate * seconds), sampleRate);
            const source = ctx.createConstantSource();
            const eq = new AudioEqualizer(ctx);
            source.connect(eq.input);
            eq.output.connect(ctx.destination);
            source.start();
            await setup(ctx, eq);
            const buffer = await ctx.startRendering();
            return buffer.getChannelData(0);
        }
        const db = (x) => 20 * Math.log10(Math.max(Math.abs(x), 1e-9));

        const fadeOut = await renderFade(async (ctx, eq) => {
            eq.fadeAsync(0, 500);
        }, 0.7);
        let monotonic = true;
        for (let i = 1; i < sampleRate * 0.5; i++) if (fadeOut[i] > fadeOut[i - 1] + 1e-6) monotonic = false;
        out.fadeOut = {
            startDb: +db(fadeOut[1]).toFixed(2),
            quarterDb: +db(fadeOut[Math.round(sampleRate * 0.125)]).toFixed(1),
            halfDb: +db(fadeOut[Math.round(sampleRate * 0.25)]).toFixed(1),
            afterEnd: fadeOut[Math.round(sampleRate * 0.6)],
            monotonic,
        };

        // Turning a fade around half way: fade out over 1 s, at 0.5 s fade back in over 0.5 s.
        const reversed = await renderFade(async (ctx, eq) => {
            eq.fadeAsync(0, 1000);
            ctx.suspend(0.5).then(() => {
                eq.fadeAsync(1, 500);
                ctx.resume();
            });
        }, 1.2);
        let maxStep = 0;
        for (let i = 1; i < reversed.length; i++) maxStep = Math.max(maxStep, Math.abs(reversed[i] - reversed[i - 1]));
        out.reversal = {
            atTurnDb: +db(reversed[Math.round(sampleRate * 0.5)]).toFixed(1),
            endLevel: +reversed[Math.round(sampleRate * 1.1)].toFixed(4),
            maxSampleStep: +maxStep.toFixed(5),
        };

        // Real use: resume (fade in from 0), listen, then pause (fade out). The fade in leaves its ramp in the gain's
        // timeline; the fade out must still start from full level at the moment of the pause.
        const afterFadeIn = await renderFade(async (ctx, eq) => {
            eq.setFadeLevel(0);
            eq.fadeAsync(1, 200);
            ctx.suspend(1).then(() => {
                eq.fadeAsync(0, 500);
                ctx.resume();
            });
        }, 1.7);
        out.fadeOutAfterFadeIn = {
            atPauseDb: +db(afterFadeIn[Math.round(sampleRate * 1.01)]).toFixed(1),
            halfDb: +db(afterFadeIn[Math.round(sampleRate * 1.25)]).toFixed(1),
            afterEnd: afterFadeIn[Math.round(sampleRate * 1.6)],
        };

        // A very short fade (1 ms) and an instant level change
        const short = await renderFade(async (ctx, eq) => {
            eq.fadeAsync(0, 1);
        }, 0.05);
        out.shortFadeSilentAfter5ms = Math.abs(short[Math.round(sampleRate * 0.005)]) < 1e-6;
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
        ['fade out starts at full level', Math.abs(result.fadeOut.startDb) < 0.1],
        [
            'fade out is even in dB (about -40 dB half way, -20 dB a quarter in)',
            Math.abs(result.fadeOut.halfDb + 40) < 1.5 && Math.abs(result.fadeOut.quarterDb + 20) < 1.5,
        ],
        ['fade out only goes down and ends in silence', result.fadeOut.monotonic && result.fadeOut.afterEnd === 0],
        ['reversing a fade half way has no jump (largest step under 0.002)', result.reversal.maxSampleStep < 0.002],
        ['reversed fade is back at full level', Math.abs(result.reversal.endLevel - 1) < 0.001],
        [
            'fade out after a fade in starts from full level (no cut) and is about -40 dB half way',
            result.fadeOutAfterFadeIn.atPauseDb > -2 &&
                Math.abs(result.fadeOutAfterFadeIn.halfDb + 40) < 1.5 &&
                result.fadeOutAfterFadeIn.afterEnd === 0,
        ],
        ['a 1 ms fade works', result.shortFadeSilentAfter5ms],
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
