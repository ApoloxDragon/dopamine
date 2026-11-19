#!/usr/bin/env node
// Real-music playback checks: builds a single-file CD-style album (FLAC + CUE) from the given recordings, plays it in
// headless Chromium through the real LegacyAudioPlayer and AudioEqualizer, RECORDS what the player outputs, and compares
// the recording sample by sample with the album:
//   - transitions between CUE tracks: no gap, no click, no repeated audio (the output must match the album exactly)
//   - fade out and in: smooth (no steps or clicks), silent in between, back to full level
//   - graphic equalizer: the measured level change per band matches the filters' response
//
// Usage: node scripts/dev/playback-harness/real-music.js <recording> [<recording> ...] [--work <dir>]
//   Recordings in album order, any format ffmpeg reads. Needs ffmpeg. Public-domain recordings to use: see
//   docs/cue-support/LOG.md (Musopen, CC0).
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const args = process.argv.slice(2);
const workArg = args.indexOf('--work');
const work = path.resolve(workArg >= 0 ? args[workArg + 1] : fs.mkdtempSync('/tmp/real-music-'));
const inputs = args.filter((a, i) => !(workArg >= 0 && (i === workArg || i === workArg + 1)));
if (inputs.length < 2) {
    console.error('Usage: real-music.js <recording> <recording> [...] [--work <dir>]');
    process.exit(2);
}

const rate = 44100;
const framesPerCueFrame = rate / 75; // 588: CD tracks always start on a cue frame

// ---------- Album ----------

function decode(file) {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '2', '-ar', String(rate), '-'], { maxBuffer: 1 << 30 });
    return new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
}

function cueTime(frames) {
    const cueFrames = frames / framesPerCueFrame;
    const mm = Math.floor(cueFrames / (75 * 60));
    const ss = Math.floor(cueFrames / 75) % 60;
    const ff = cueFrames % 75;
    return [mm, ss, ff].map((x) => String(x).padStart(2, '0')).join(':');
}

function buildAlbum() {
    const music = path.join(work, 'music', 'Real Music Test');
    fs.mkdirSync(music, { recursive: true });
    const parts = inputs.map(decode).map((samples) => {
        // Pad each recording with silence to a whole cue frame, like a CD track.
        const frames = samples.length / 2;
        const padded = Math.ceil(frames / framesPerCueFrame) * framesPerCueFrame;
        const out = new Int16Array(padded * 2);
        out.set(samples);
        return out;
    });
    const totalFrames = parts.reduce((n, p) => n + p.length / 2, 0);
    const album = new Int16Array(totalFrames * 2);
    const starts = [];
    let at = 0;
    for (const p of parts) {
        starts.push(at);
        album.set(p, at * 2);
        at += p.length / 2;
    }

    const rawPath = path.join(work, 'album.raw');
    fs.writeFileSync(rawPath, Buffer.from(album.buffer));
    const flac = path.join(music, 'Real Music Test.flac');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 's16le', '-ac', '2', '-ar', String(rate), '-i', rawPath, flac]);
    fs.rmSync(rawPath);

    const cue = ['PERFORMER "Real Music Test"', 'TITLE "Real Music Test"', 'FILE "Real Music Test.flac" WAVE'];
    starts.forEach((s, i) => {
        cue.push(`  TRACK ${String(i + 1).padStart(2, '0')} AUDIO`, `    TITLE "${path.parse(inputs[i]).name.slice(0, 60)}"`, `    INDEX 01 ${cueTime(s)}`);
    });
    fs.writeFileSync(path.join(music, 'Real Music Test.cue'), cue.join('\r\n') + '\r\n');

    // Reference: what the album decodes to, as floats like Web Audio uses (stereo, interleaved).
    const reference = new Float32Array(album.length);
    for (let i = 0; i < album.length; i++) reference[i] = album[i] / 32768;
    return { flac, starts, totalFrames, reference };
}

// The loudest second inside [from, to) frames, so fade, EQ and mid-music cuts are checked on music, not silence.
function loudestSecond(reference, from, to) {
    let best = from;
    let bestEnergy = -1;
    for (let s = from; s + rate <= to; s += rate / 4) {
        let e = 0;
        for (let i = s; i < s + rate; i += 4) e += reference[i * 2] * reference[i * 2];
        if (e > bestEnergy) {
            bestEnergy = e;
            best = s;
        }
    }
    return Math.round(best / framesPerCueFrame) * framesPerCueFrame;
}

// ---------- Analysis ----------

// Normalized correlation of recording frames [k, k+w) with album frames [a, a+w) (left channel): 1 = same shape,
// whatever the gain, so it also aligns faded or equalized audio.
function correlation(recording, reference, k, a, w) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = 0; i < w; i++) {
        const x = recording[(k + i) * 2];
        const y = reference[(a + i) * 2];
        xy += x * y;
        xx += x * x;
        yy += y * y;
    }
    return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
}

function bestOffset(recording, reference, k, around, range, w) {
    let best = { offset: around, score: -2 };
    for (let o = around - range; o <= around + range; o++) {
        if (k + o < 0 || (k + o + w) * 2 > reference.length) continue;
        const score = correlation(recording, reference, k, k + o, w);
        if (score > best.score) best = { offset: o, score };
    }
    return best;
}

function windowEnergy(data, k, w) {
    let e = 0;
    for (let i = k; i < k + w; i++) e += data[i * 2] * data[i * 2];
    return e / w;
}

/**
 * Follows which album frame the recording plays, window by window (offset = album frame - recording frame).
 * A change of the offset is a discontinuity: audio skipped (offset grows) or inserted/repeated (offset shrinks).
 * `from` is where playback started in the album; the recording starts before playback (latency up to 1 s).
 * Returns windows [{ k, albumFrame, offset, score }] and the discontinuities [{ albumFrame, frames }].
 */
function follow(recording, reference, from) {
    const w = 2048;
    const hop = 1024;
    const frames = recording.length / 2;
    const i0 = onset(recording);
    if (i0 < 0) return { windows: [], jumps: [], i0 };

    // First window with music: search the whole possible latency range.
    let k = i0 + 1024;
    while (k + w < frames && windowEnergy(recording, k, w) < 1e-7) k += hop;
    let current = bestOffset(recording, reference, k, from - Math.round(rate / 2), Math.round(rate / 2) + 2048, w).offset;

    const windows = [];
    const jumps = [];
    for (; k + w < frames; k += hop) {
        if (windowEnergy(recording, k, w) < 1e-7 || windowEnergy(reference, k + current, w) < 1e-7) {
            windows.push({ k, albumFrame: k + current, offset: current, score: NaN, silent: true });
            continue;
        }
        let found = bestOffset(recording, reference, k, current, 8, w);
        if (found.score < 0.98) found = bestOffset(recording, reference, k, current, 6000, w);
        if (found.offset !== current && found.score > 0.9) {
            jumps.push({ albumFrame: k + found.offset, frames: found.offset - current });
            current = found.offset;
        }
        windows.push({ k, albumFrame: k + current, offset: current, score: found.score });
    }
    return { windows, jumps, i0 };
}

function onset(recording) {
    for (let i = 0; i < recording.length / 2; i++) if (Math.abs(recording[i * 2]) > 1e-4 || Math.abs(recording[i * 2 + 1]) > 1e-4) return i;
    return -1;
}

// Largest |recording - album| over the windows, each with its own offset (both channels).
function maxResidual(recording, reference, windows, fromAlbum, toAlbum) {
    let max = 0;
    for (const win of windows) {
        if (win.albumFrame < fromAlbum || win.albumFrame + 1024 > toAlbum) continue;
        for (let i = win.k; i < win.k + 1024; i++) {
            for (let ch = 0; ch < 2; ch++) max = Math.max(max, Math.abs(recording[i * 2 + ch] - reference[(i + win.offset) * 2 + ch]));
        }
    }
    return max;
}

const ms = (frames) => Math.round((frames / rate) * 1000);

// Transition: across the boundary the output must be exactly the album: no jump, no click.
function analyzeTransition(recording, reference, from, boundary) {
    const { windows, jumps, i0 } = follow(recording, reference, from);
    if (i0 < 0) return { ok: false, reason: 'recording is silent' };
    const near = jumps.filter((j) => Math.abs(j.albumFrame - boundary) < rate * 0.75);
    const last = windows[windows.length - 1];
    const residual = maxResidual(recording, reference, windows, boundary - rate * 0.5, boundary + rate * 1.0);
    return {
        ok: near.length === 0 && residual < 1e-3 && last.albumFrame > boundary + rate,
        residualAroundBoundary: residual,
        jumpsNearBoundary: near.map((j) => ({ msFromBoundary: ms(j.albumFrame - boundary), frames: j.frames })),
        // Elsewhere in the recording (for example when playback starts): reported, not part of this check.
        otherJumps: jumps.filter((j) => !near.includes(j)).map((j) => ({ msFromBoundary: ms(j.albumFrame - boundary), frames: j.frames })),
    };
}

// Gain of the recording against the album per window (least squares, both channels).
function windowGains(recording, reference, windows) {
    return windows.map((win) => {
        let num = 0;
        let den = 0;
        for (let i = win.k; i < win.k + 1024; i++) {
            for (let ch = 0; ch < 2; ch++) {
                const x = reference[(i + win.offset) * 2 + ch];
                num += recording[i * 2 + ch] * x;
                den += x * x;
            }
        }
        return den > 1e-5 ? num / den : NaN;
    });
}

function analyzeFade(recording, reference, from, fadeMs, holdMs) {
    const { windows, jumps } = follow(recording, reference, from);
    const gains = windowGains(recording, reference, windows);
    const windowMs = (1024 / rate) * 1000;
    const start = gains.findIndex((g, i) => i > 4 && g < 0.97);
    const fadeWindows = Math.round(fadeMs / windowMs);
    const holdWindows = Math.round(holdMs / windowMs);
    const valid = (xs) => xs.filter((g) => !Number.isNaN(g));
    const out = valid(gains.slice(start, start + fadeWindows));
    const silent = valid(gains.slice(start + fadeWindows + 2, start + fadeWindows + holdWindows - 2));
    const inStart = gains.findIndex((g, i) => i > start + fadeWindows && g > 0.002);
    const fadeIn = valid(gains.slice(inStart, inStart + fadeWindows));
    const end = valid(gains.slice(inStart + fadeWindows + 3));
    const monotonic = (xs, sign) => xs.every((g, i) => i === 0 || sign * (g - xs[i - 1]) >= -0.01);
    // The fade is an exponential ramp from full level to AudioEqualizer.silentLevel (0.0001, -80 dB): every window
    // must change by the same number of dB. Measured between -50 dB and full level (lower, the music's own noise counts).
    const expectedDbPerWindow = (80 * windowMs) / fadeMs;
    const dbSteps = (xs) =>
        xs
            // Only steps inside the ramp: both windows between -50 dB and just below full level.
            .map((g, i) => (i === 0 || Math.min(g, xs[i - 1]) < 0.003 || Math.max(g, xs[i - 1]) > 0.97 ? NaN : Math.abs(20 * Math.log10(g / xs[i - 1]))))
            .filter((x) => !Number.isNaN(x));
    const evenInDb = (xs) => {
        const steps = dbSteps(xs);
        return {
            steps: steps.length,
            minDb: +Math.min(...steps).toFixed(2),
            maxDb: +Math.max(...steps).toFixed(2),
            ok: steps.length >= 5 && steps.every((x) => x > expectedDbPerWindow * 0.5 && x < expectedDbPerWindow * 1.5),
        };
    };
    return {
        fadeOutFound: start > 0,
        fadeOutMonotonic: monotonic(out, -1),
        fadeOut: evenInDb(out),
        silentMaxGain: silent.length > 0 ? +Math.max(...silent.map(Math.abs)).toFixed(5) : NaN,
        fadeInMonotonic: monotonic(fadeIn, 1),
        fadeIn: evenInDb(fadeIn),
        expectedDbPerWindow: +expectedDbPerWindow.toFixed(2),
        endGain: end.length > 0 ? +(end.reduce((a, b) => a + b, 0) / end.length).toFixed(4) : NaN,
        endGainSpread: end.length > 0 ? +(Math.max(...end) - Math.min(...end)).toFixed(4) : NaN,
        jumps: jumps.length,
    };
}

// Radix-2 FFT (in place) for the equalizer check.
function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        for (let i = 0; i < n; i += len) {
            for (let k = 0; k < len / 2; k++) {
                const wr = Math.cos(ang * k);
                const wi = Math.sin(ang * k);
                const ur = re[i + k];
                const ui = im[i + k];
                const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
                const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
                re[i + k] = ur + vr;
                im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr;
                im[i + k + len / 2] = ui - vi;
            }
        }
    }
}

function powerSpectrum(get, from, to, n = 8192) {
    const power = new Float64Array(n / 2);
    let count = 0;
    for (let s = from; s + n <= to; s += n / 2) {
        const re = new Float64Array(n);
        const im = new Float64Array(n);
        for (let k = 0; k < n; k++) re[k] = get(s + k) * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1)));
        fft(re, im);
        for (let b = 0; b < n / 2; b++) power[b] += re[b] * re[b] + im[b] * im[b];
        count++;
    }
    return { power, count, n };
}

function analyzeEqualizer(recording, reference, from, changeAfterSeconds, bands) {
    const frames = recording.length / 2;
    // Follow only the part before the change: the equalized audio no longer correlates exactly with the album.
    const i0 = onset(recording);
    const changeFrame = i0 + Math.round(changeAfterSeconds * rate);
    const before = follow(recording.subarray(0, (changeFrame - 2205) * 2), reference, from);
    const flatMaxResidual = maxResidual(recording, reference, before.windows.slice(4), 0, Infinity);
    const offset = before.windows[before.windows.length - 1].offset;

    const s = changeFrame + Math.round(rate * 0.4);
    const mono = (data, o) => (i) => (data[(i + o) * 2] + data[(i + o) * 2 + 1]) / 2;
    const rec = powerSpectrum(mono(recording, 0), s, frames);
    const ref = powerSpectrum(mono(reference, offset), s, frames);
    const binHz = rate / rec.n;
    const measured = bands.map(({ frequency, expectedDb }) => {
        let pr = 0;
        let pf = 0;
        for (let b = Math.floor((frequency * 0.97) / binHz); b <= Math.ceil((frequency * 1.03) / binHz); b++) {
            pr += rec.power[b];
            pf += ref.power[b];
        }
        // Bands where the music has (almost) nothing are not measurable.
        const usable = pf > 1e-3 * rec.count;
        return { frequency, expectedDb: +expectedDb.toFixed(2), measuredDb: +(10 * Math.log10(pr / pf)).toFixed(2), usable };
    });
    return { flatMaxResidual, jumpsBeforeChange: before.jumps.length, measured, segments: rec.count };
}

// ---------- Browser ----------

async function main() {
    console.log(`Work folder: ${work}`);
    const { flac, starts, totalFrames, reference } = buildAlbum();
    const boundaries = [...starts.slice(1), totalFrames];
    console.log(`Album: ${(totalFrames / rate).toFixed(1)} s, ${starts.length} tracks, starts at ${starts.map((s) => cueTime(s)).join(', ')}`);

    // Mid-music cut: a second sheet layout with a track boundary in the loudest part of track 1 (like a live album),
    // so the gapless check runs on music, not on the silence between movements.
    const cut = loudestSecond(reference, starts[0] + rate * 5, boundaries[0] - rate * 5) + rate / 2;
    const fadeAt = loudestSecond(reference, starts[1] + rate * 5, boundaries[1] - rate * 5);
    const eqAt = loudestSecond(reference, starts[starts.length - 1] + rate * 5, totalFrames - rate * 5);

    await esbuild.build({
        entryPoints: [path.join(__dirname, 'entry.ts')],
        bundle: true,
        outfile: path.join(work, 'bundle.js'),
        format: 'iife',
        target: 'es2020',
        logLevel: 'error',
        banner: {
            js: [
                'window.Buffer = window.Buffer || { from: () => new Uint8Array(0) };',
                // The album's rate, so the recording is not resampled and can be compared sample by sample.
                'const NativeAudioContext = window.AudioContext;',
                'window.AudioContext = class extends NativeAudioContext { constructor(o) { super({ ...(o || {}), sampleRate: 44100 }); } };',
                // Record everything a context sends to its speakers, on the audio thread (AudioWorklet), so no block is
                // lost when the page's main thread is busy. Data comes back in batches through the worklet's port.
                'window.recorders = [];',
                'const recorderSource = `class Recorder extends AudioWorkletProcessor {',
                '  constructor() { super(); this.on = false; this.batch = []; this.size = 0;',
                '    this.port.onmessage = (e) => { this.on = e.data.on; if (!this.on) { this.flush(); this.port.postMessage({ done: true }); } }; }',
                '  flush() { if (this.size === 0) return; const out = new Float32Array(this.size); let at = 0;',
                '    for (const c of this.batch) { out.set(c, at); at += c.length; } this.batch = []; this.size = 0; this.port.postMessage({ data: out }, [out.buffer]); }',
                '  process(inputs) { const input = inputs[0]; if (this.on && input.length > 0) { const l = input[0], r = input[1] || input[0];',
                '      const c = new Float32Array(l.length * 2); for (let i = 0; i < l.length; i++) { c[2*i] = l[i]; c[2*i+1] = r[i]; }',
                '      this.batch.push(c); this.size += c.length; if (this.size >= 8192) this.flush(); } return true; } }',
                'registerProcessor("recorder", Recorder);`;',
                'const recorderUrl = URL.createObjectURL(new Blob([recorderSource], { type: "application/javascript" }));',
                'const nativeConnect = AudioNode.prototype.connect;',
                'AudioNode.prototype.connect = function (destination, ...rest) {',
                '  if (destination instanceof AudioDestinationNode && !this.__isTap) {',
                '    const ctx = destination.context;',
                '    if (!ctx.__tap) {',
                '      const tap = ctx.createGain(); tap.__isTap = true; nativeConnect.call(tap, destination); ctx.__tap = tap;',
                '      const rec = { ctx, chunks: [] };',
                '      rec.ready = ctx.audioWorklet.addModule(recorderUrl).then(() => {',
                '        const node = new AudioWorkletNode(ctx, "recorder", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: "explicit" });',
                '        node.port.onmessage = (e) => { if (e.data.data) rec.chunks.push(e.data.data); if (e.data.done && rec.onDone) rec.onDone(); };',
                '        const mute = ctx.createGain(); mute.gain.value = 0; mute.__isTap = true;',
                '        nativeConnect.call(tap, node); nativeConnect.call(node, mute); nativeConnect.call(mute, destination);',
                '        rec.start = () => node.port.postMessage({ on: true });',
                '        rec.stop = () => new Promise((resolve) => { rec.onDone = resolve; node.port.postMessage({ on: false }); });',
                '      });',
                '      window.recorders.push(rec);',
                '    }',
                '    return nativeConnect.call(this, ctx.__tap, ...rest);',
                '  }',
                '  return nativeConnect.call(this, destination, ...rest);',
                '};',
            ].join('\n'),
        },
        tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
        plugins: [
            {
                name: 'stub-angular',
                setup(build) {
                    build.onResolve({ filter: /^@angular\/core$/ }, () => ({ path: 'angular-core', namespace: 'stub' }));
                    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const Injectable = () => (t) => t;', loader: 'js' }));
                },
            },
        ],
    });
    fs.writeFileSync(path.join(work, 'index.html'), '<!doctype html><html><body><script src="bundle.js"></script></body></html>');

    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
    const page = await browser.newPage();
    page.on('console', (m) => process.env.VERBOSE && console.log('  page:', m.text()));
    page.on('pageerror', (e) => console.log('  page error:', e.message));
    await page.goto('file://' + path.join(work, 'index.html'));

    // Each scenario plays from 2 s before a point of interest and returns the recording (base64 of float32 stereo).
    const run = (scenario) =>
        page.evaluate(async ({ flacPath, rate, scenario }) => {
            const h = window.harness;
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const player = h.createRouter();
            const equalizer = h.equalizers[h.equalizers.length - 1];
            const tracks = scenario.bounds.slice(0, -1).map((start, i) => h.createTrack(flacPath, i + 1, start / rate, scenario.bounds[i + 1] / rate));
            let index = scenario.track;
            player.playbackFinished$.subscribe(async () => {
                index++;
                if (index < tracks.length) await player.playAsync(tracks[index]);
                // Self-test: skip 50 ms at the boundary, which the analysis must report as a gap.
                if (scenario.fault && index < tracks.length) player.getAudio().currentTime += 0.05;
            });
            const extra = {};
            await player.startPausedAsync(tracks[index], (scenario.from - scenario.bounds[index]) / rate);
            await sleep(200);
            const rec = window.recorders.find((r) => r.ctx === equalizer.audioContext) ?? window.recorders[window.recorders.length - 1];
            await rec.ready;
            rec.start();
            await player.resumeAsync();
            if (scenario.kind === 'fade') {
                await sleep(1500);
                await player.fadeAsync(0, scenario.fadeMs);
                await sleep(scenario.holdMs);
                await player.fadeAsync(1, scenario.fadeMs);
                await sleep(1000);
            } else if (scenario.kind === 'eq') {
                await sleep(scenario.changeAfterMs);
                const gains = scenario.gains;
                equalizer.setGains(gains);
                // The response the filters should have, from Chromium's own biquads.
                const filters = equalizer.constructor.graphicFilters(gains);
                const off = new OfflineAudioContext(1, 128, rate);
                const freqs = new Float32Array(scenario.bandFrequencies);
                const total = new Float32Array(freqs.length).fill(0);
                for (const f of filters) {
                    const node = off.createBiquadFilter();
                    node.type = f.type;
                    node.frequency.value = f.frequency;
                    node.gain.value = f.gain;
                    node.Q.value = f.q;
                    const mag = new Float32Array(freqs.length);
                    node.getFrequencyResponse(freqs, mag, new Float32Array(freqs.length));
                    mag.forEach((m, i) => (total[i] += 20 * Math.log10(m)));
                }
                extra.expectedDb = Array.from(total);
                await sleep(scenario.afterMs);
            } else {
                await sleep(scenario.recordMs);
            }
            await rec.stop();
            player.stop();
            const all = new Float32Array(rec.chunks.reduce((n, c) => n + c.length, 0));
            let at = 0;
            for (const c of rec.chunks) {
                all.set(c, at);
                at += c.length;
            }
            rec.chunks = [];
            const bytes = new Uint8Array(all.buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return { recording: btoa(binary), extra };
        }, { flacPath: flac, rate, scenario });

    const toFloats = (b64) => {
        const buf = Buffer.from(b64, 'base64');
        return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    };

    const tests = [];
    const albumBounds = [...starts, totalFrames];

    // 1. Every track boundary of the album, as the sheet has them (between movements).
    for (let t = 0; t < starts.length - 1; t++) {
        const from = albumBounds[t + 1] - rate * 2;
        const { recording } = await run({ kind: 'transition', bounds: albumBounds, track: t, from, recordMs: 4000 });
        const r = analyzeTransition(toFloats(recording), reference, from, albumBounds[t + 1]);
        tests.push([`track ${t + 1} -> ${t + 2} at ${cueTime(albumBounds[t + 1])}: output equals the album (no gap or click)`, r.ok, r]);
    }

    // 2. A track boundary in the middle of loud music.
    {
        const cutBounds = [0, cut, ...albumBounds.slice(1)];
        const from = cut - rate * 2;
        const { recording } = await run({ kind: 'transition', bounds: cutBounds, track: 0, from, recordMs: 4000 });
        const r = analyzeTransition(toFloats(recording), reference, from, cut);
        tests.push([`boundary inside loud music at ${cueTime(cut)}: output equals the album (no gap or click)`, r.ok, r]);
    }

    // 2b. Self-test of the analysis: the same boundary with 50 ms skipped must be detected.
    {
        const cutBounds = [0, cut, ...albumBounds.slice(1)];
        const from = cut - rate * 2;
        const { recording } = await run({ kind: 'transition', bounds: cutBounds, track: 0, from, recordMs: 4000, fault: true });
        const r = analyzeTransition(toFloats(recording), reference, from, cut);
        const skipped = r.jumpsNearBoundary.reduce((n, j) => n + j.frames, 0);
        tests.push(['self-test: a 50 ms skip at a boundary is detected and measured', !r.ok && Math.abs(skipped - rate * 0.05) < 300, r]);
    }

    // 3. Fade out and in on music.
    {
        const fadeMs = 800;
        const holdMs = 400;
        const from = fadeAt - rate * 1.5;
        const { recording } = await run({ kind: 'fade', bounds: albumBounds, track: 1, from, fadeMs, holdMs });
        const f = analyzeFade(toFloats(recording), reference, from, fadeMs, holdMs);
        tests.push(['fade out: decreasing, by the same number of dB every 23 ms (no steps or clicks)', f.fadeOutFound && f.fadeOutMonotonic && f.fadeOut.ok && f.jumps === 0, f]);
        tests.push(['silent between the fades (gain below 0.001)', f.silentMaxGain < 0.001, { silentMaxGain: f.silentMaxGain }]);
        tests.push(['fade in: increasing evenly in dB, then exactly back to full level', f.fadeInMonotonic && f.fadeIn.ok && Math.abs(f.endGain - 1) < 0.001 && f.endGainSpread < 0.001, f]);
    }

    // 4. Graphic equalizer: +9 dB at 1 kHz, -6 dB at 125 Hz, +4 dB at 8 kHz.
    {
        const gains = [0, 0, -6, 0, 0, 9, 0, 0, 4, 0];
        const bandFrequencies = [125, 250, 500, 1000, 2000, 4000, 8000];
        const from = eqAt - rate * 1.5;
        const { recording, extra } = await run({ kind: 'eq', bounds: albumBounds, track: starts.length - 1, from, changeAfterMs: 1500, afterMs: 3500, gains, bandFrequencies });
        const e = analyzeEqualizer(toFloats(recording), reference, from, 1.5, bandFrequencies.map((frequency, i) => ({ frequency, expectedDb: extra.expectedDb[i] })));
        tests.push(['flat equalizer: output equals the album', e.flatMaxResidual < 1e-3, { flatMaxResidual: e.flatMaxResidual }]);
        const usable = e.measured.filter((m) => m.usable);
        tests.push([
            `equalizer: measured level change per band within 1 dB of the filters (${usable.length} bands)`,
            usable.length >= 5 && usable.every((m) => Math.abs(m.measuredDb - m.expectedDb) < 1),
            e.measured,
        ]);
    }

    await browser.close();

    let failed = 0;
    for (const [name, ok, detail] of tests) {
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
        if (!ok || process.env.VERBOSE) console.log('      ' + JSON.stringify(detail));
        if (!ok) failed++;
    }
    console.log(failed === 0 ? 'All real-music checks passed' : `${failed} real-music check(s) failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(2);
});
