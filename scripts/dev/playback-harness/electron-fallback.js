#!/usr/bin/env node
// Checks, in real Electron with the real dopamine-audio:// protocol, that the real LegacyAudioPlayer plays CUE tracks
// of FLAC files that the <audio> element cannot open through file:// (for example a cover without a MIME type), and
// that files which open normally keep using file://.
//
// Usage: node scripts/dev/playback-harness/electron-fallback.js <broken.flac> <good.flac>
//   Both files must be at least 2 minutes long. Needs xvfb-run.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');

async function launch() {
    // Launcher (Node): bundle the players, then run this file in Electron.
    const [broken, good] = process.argv.slice(2).map((p) => path.resolve(p));
    if (!broken || !good) {
        console.error('Usage: electron-fallback.js <broken.flac> <good.flac>');
        process.exit(2);
    }
    const work = fs.mkdtempSync('/tmp/electron-fallback-');
    await require('esbuild').build({
        entryPoints: [path.join(__dirname, 'entry.ts')],
        bundle: true,
        outfile: path.join(work, 'bundle.js'),
        format: 'iife',
        target: 'es2020',
        logLevel: 'error',
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
    try {
        execFileSync('xvfb-run', ['-a', path.join(root, 'node_modules/.bin/electron'), '--no-sandbox', __filename, work, broken, good], {
            stdio: ['ignore', 'inherit', 'ignore'],
        });
    } catch (e) {
        process.exit(e.status ?? 1);
    }
}

if (process.versions.electron === undefined) {
    launch();
} else {
    runInElectron();
}

// Electron main process.
function runInElectron() {
    const { app, BrowserWindow, protocol } = require('electron');
    const audioProtocol = require(path.join(root, 'main/audio-protocol'));
    protocol.registerSchemesAsPrivileged([audioProtocol.privilegedScheme]);

    const [work, broken, good] = process.argv.slice(-3);

    app.whenReady().then(async () => {
        audioProtocol.registerAudioProtocol(protocol, console);
        // The app's window settings for the player (nodeIntegration, no web security).
        const window = new BrowserWindow({
            show: false,
            webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
        });
        const warnings = [];
        window.webContents.on('console-message', (event, level, message) => {
            if (String(message).startsWith('[warn]')) warnings.push(String(message));
        });
        await window.loadFile(path.join(work, 'index.html'));

        const play = (file) =>
            window.webContents.executeJavaScript(`(async () => {
            const h = window.harness;
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const player = h.createRouter();
            let failed = '';
            player.playbackFailed$.subscribe((p) => (failed = p));
            // Track 2: 60 s to 120 s of the file.
            await player.playAsync(h.createTrack(${JSON.stringify(file)}, 2, 60, 120));
            await sleep(1500);
            const audio = player.getAudio();
            const r = { failed, src: audio.src.split(':')[0], playing: !audio.paused, fileTime: audio.currentTime, progress: player.progressSeconds };
            // Seek inside the track (needs HTTP ranges on the protocol): 30 s into track 2 = 90 s in the file.
            await player.skipToSecondsAsync(30);
            await sleep(1500);
            r.afterSeekFileTime = audio.currentTime;
            r.afterSeekPlaying = !audio.paused;
            r.error = audio.error ? audio.error.code + ' ' + audio.error.message : '';
            player.stop();
            return r;
        })()`);

        const b = await play(broken);
        const g = await play(good);
        const tests = [
            [
                'broken file: plays through the audio protocol',
                b.failed === '' && b.src === 'dopamine-audio' && b.playing && b.fileTime > 60.5 && b.fileTime < 62.5,
            ],
            ['broken file: progress is relative to the track start', b.progress > 0.5 && b.progress < 2.5],
            [
                'broken file: seeking works (ranges)',
                b.afterSeekPlaying && b.afterSeekFileTime > 90.5 && b.afterSeekFileTime < 92.5 && b.error === '',
            ],
            ['broken file: the fallback is logged once', warnings.filter((w) => w.includes('audio protocol')).length === 1],
            ['good file: still plays through file://', g.failed === '' && g.src === 'file' && g.playing && g.fileTime > 60.5],
            ['good file: seeking works', g.afterSeekPlaying && g.afterSeekFileTime > 90.5 && g.afterSeekFileTime < 92.5],
        ];
        let failedCount = 0;
        for (const [name, ok] of tests) {
            console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
            if (!ok) failedCount++;
        }
        if (failedCount > 0) console.log(JSON.stringify({ broken: b, good: g, warnings }));
        console.log(failedCount === 0 ? 'All fallback checks passed' : `${failedCount} fallback check(s) failed`);
        app.exit(failedCount === 0 ? 0 : 1);
    });
}
