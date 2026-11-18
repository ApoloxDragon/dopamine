#!/usr/bin/env node
// Plays a CUE album in real headless Chromium through the real LegacyAudioPlayer and checks gapless transitions,
// relative progress/seek and the end of the album. Uses scripts/dev/fixtures.sh output (5 tones, boundaries at
// 2.0, 4.2, 6.6, 9.2 s, 12.0 s total).
// Usage: node scripts/dev/playback-harness/run.js [work-dir]
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const work = path.resolve(process.argv[2] ?? fs.mkdtempSync('/tmp/playback-harness-'));
fs.mkdirSync(work, { recursive: true });

async function main() {
    const music = path.join(work, 'music');
    fs.rmSync(music, { recursive: true, force: true });
    execFileSync(path.join(root, 'scripts/dev/fixtures.sh'), [music, '5'], { stdio: 'ignore' });
    const flac = path.join(music, 'Test Artist - Test Album.flac');

    await esbuild.build({
        entryPoints: [path.join(__dirname, 'entry.ts')],
        bundle: true,
        outfile: path.join(work, 'bundle.js'),
        format: 'iife',
        target: 'es2020',
        logLevel: 'error',
        // The Electron renderer has Node's Buffer; a plain page does not. The players never use it (only Constants does).
        banner: { js: 'window.Buffer = window.Buffer || { from: () => new Uint8Array(0) };' },
        tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
        plugins: [
            {
                name: 'stub-angular',
                setup(build) {
                    build.onResolve({ filter: /^@angular\/core$/ }, () => ({ path: 'angular-core', namespace: 'stub' }));
                    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                        contents: 'export const Injectable = () => (t) => t;',
                        loader: 'js',
                    }));
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

    const result = await page.evaluate(async (flacPath) => {
        const h = window.harness;
        const bounds = [0, 2.0, 4.2, 6.6, 9.2, 12.0];
        const tracks = [1, 2, 3, 4, 5].map((n) => h.createTrack(flacPath, n, bounds[n - 1], bounds[n]));
        const player = h.createRouter();
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = { transitions: [], checks: {} };

        // 1. Relative progress, total and seek on track 2
        await player.playAsync(tracks[1]);
        await sleep(300);
        out.checks.track2Total = player.totalSeconds;
        out.checks.track2ProgressAfter300ms = player.progressSeconds;
        out.checks.track2FileTime = player.getAudio().currentTime;
        await player.skipToSecondsAsync(1.0);
        await sleep(50);
        out.checks.track2FileTimeAfterSkip1s = player.getAudio().currentTime;
        player.stop();

        // 2. Play the album from track 1, chaining like PlaybackService (finished -> play next)
        let index = 0;
        let seeks = 0;
        let finishedAll = false;
        const samples = [];
        let audio;
        const done = new Promise((resolve) => {
            player.playbackFinished$.subscribe(async () => {
                const before = player.getAudio();
                const fileTime = before.currentTime;
                index++;
                if (index >= tracks.length) {
                    finishedAll = true;
                    player.stop();
                    resolve();
                    return;
                }
                const seeksBefore = seeks;
                await player.playAsync(tracks[index]);
                out.transitions.push({
                    to: index + 1,
                    boundary: bounds[index],
                    fileTimeAtFinish: +fileTime.toFixed(3),
                    sameElement: player.getAudio() === before,
                    seeks: seeks - seeksBefore,
                    progressRightAfter: +player.progressSeconds.toFixed(3),
                });
            });
        });

        await player.playAsync(tracks[0]);
        audio = player.getAudio();
        audio.addEventListener('seeking', () => seeks++);
        const sampler = setInterval(() => samples.push([performance.now(), player.getAudio().currentTime]), 10);
        await Promise.race([done, sleep(20000)]);
        clearInterval(sampler);

        // Continuity: playback time must advance with wall time, never stall or jump back
        let maxStallMs = 0;
        let backwardJumps = 0;
        for (let i = 1; i < samples.length; i++) {
            const dWall = samples[i][0] - samples[i - 1][0];
            const dMedia = (samples[i][1] - samples[i - 1][1]) * 1000;
            if (dMedia < -1) backwardJumps++;
            if (samples[i][1] > 0.1 && samples[i][1] < 11.9 && dMedia <= 0) maxStallMs = Math.max(maxStallMs, dWall);
        }
        // 3. Overrun guard: when nothing takes over after a track ends, the audio pauses (does not run into the next song)
        const solo = h.createRouter();
        await solo.playAsync(tracks[0]);
        await sleep(2000 + 1300);
        out.checks.overrunPaused = solo.getAudio().paused;
        out.checks.overrunFileTime = solo.getAudio().currentTime;
        solo.stop();

        // 4. Restore: start paused at 1.0 s into track 4 (6.6 s in the file)
        const restored = h.createRouter();
        await restored.startPausedAsync(tracks[3], 1.0);
        await sleep(300);
        out.checks.restoredPaused = restored.isPaused && restored.getAudio().paused;
        out.checks.restoredProgress = restored.progressSeconds;
        out.checks.restoredFileTime = restored.getAudio().currentTime;
        restored.stop();

        // 5. Router: normal track on the main player, then a CUE track on the CUE player, then back
        const split = h.createSplitRouter();
        const wav = flacPath.replace(/\.flac$/, '.wav');
        await split.playAsync(h.createNormalTrack(wav));
        await sleep(300);
        const mainAudio = split.getAudio();
        await split.playAsync(tracks[2]);
        await sleep(300);
        const cueAudio = split.getAudio();
        out.checks.splitMainSilenced = mainAudio.paused;
        out.checks.splitCuePlaying = !cueAudio.paused && cueAudio !== mainAudio;
        out.checks.splitCueProgress = split.progressSeconds;
        await split.playAsync(h.createNormalTrack(wav));
        await sleep(300);
        // LegacyAudioPlayer uses a new element per normal track, so check that the playing element is not the CUE one.
        out.checks.splitBackToMain = split.getAudio() !== cueAudio && !split.getAudio().paused && cueAudio.paused;
        split.stop();

        out.checks.finishedAll = finishedAll;
        out.checks.seeksDuringAlbum = seeks;
        out.checks.backwardJumps = backwardJumps;
        out.checks.maxStallMs = Math.round(maxStallMs);
        out.checks.samples = samples.length;
        return out;
    }, flac);

    await browser.close();

    const c = result.checks;
    const tests = [
        ['total of track 2 is its length (2.2 s)', Math.abs(c.track2Total - 2.2) < 0.01],
        ['progress is relative to the track start', c.track2ProgressAfter300ms > 0.1 && c.track2ProgressAfter300ms < 0.6],
        ['track 2 plays from 2.0 s in the file', c.track2FileTime > 2.1 && c.track2FileTime < 2.6],
        ['seek is relative to the track start (1 s -> 3 s in file)', Math.abs(c.track2FileTimeAfterSkip1s - 3.0) < 0.15],
        ['album played to the end', c.finishedAll],
        ['4 transitions between tracks', result.transitions.length === 4],
        ['every transition kept the same audio element', result.transitions.every((t) => t.sameElement)],
        ['no seek at any transition', result.transitions.every((t) => t.seeks === 0)],
        ['finish detected within 100 ms of each boundary', result.transitions.every((t) => t.fileTimeAtFinish - t.boundary < 0.1 && t.fileTimeAtFinish >= t.boundary)],
        ['no backward jumps in playback time', c.backwardJumps === 0],
        ['no stall over 60 ms while playing the album', c.maxStallMs <= 60],
        ['overrun guard pauses about 1 s after an unhandled track end', c.overrunPaused && c.overrunFileTime > 2.0 && c.overrunFileTime < 3.3],
        ['restore starts paused at 1 s into track 4 (7.6 s in file)', c.restoredPaused && Math.abs(c.restoredFileTime - 7.6) < 0.1 && Math.abs(c.restoredProgress - 1.0) < 0.1],
        ['router silences the main player when a CUE track starts', c.splitMainSilenced && c.splitCuePlaying],
        ['router reports CUE progress from the CUE player', c.splitCueProgress > 0.1 && c.splitCueProgress < 0.6],
        ['router switches back to the main player for a normal track', c.splitBackToMain],
    ];

    console.log(JSON.stringify(result.transitions));
    console.log(`maxStallMs=${c.maxStallMs} seeks=${c.seeksDuringAlbum} samples=${c.samples}`);
    let failed = 0;
    for (const [name, ok] of tests) {
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
        if (!ok) failed++;
    }
    console.log(failed === 0 ? 'All playback checks passed' : `${failed} playback check(s) failed`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(2);
});
