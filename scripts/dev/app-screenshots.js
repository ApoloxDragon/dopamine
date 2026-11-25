#!/usr/bin/env node
// Launches the real app (Electron, built with `npm run build:prod`) with a fresh profile and takes screenshots of
// the equalizer dialog (parametric and graphic), the Statistics page and the settings search.
// Usage: xvfb-run -a -s "-screen 0 1400x900x24" node scripts/dev/app-screenshots.js <output-dir>
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'dopamine-shots-')));
fs.mkdirSync(out, { recursive: true });

async function main() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dopamine-home-'));
    const userData = path.join(home, '.config', 'Dopamine');
    fs.mkdirSync(userData, { recursive: true });
    // SEED_STATISTICS=1: a database with made-up listening history and detailed statistics turned on.
    const seedStatistics = process.env.SEED_STATISTICS === '1';
    if (seedStatistics) {
        require('child_process').execFileSync(
            path.join(__dirname, '../../node_modules/.bin/electron'),
            [path.join(__dirname, 'seed-statistics.js'), path.join(userData, 'Dopamine.db')],
            { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
        );
    }
    fs.writeFileSync(
        path.join(userData, 'config.json'),
        JSON.stringify({
            showWelcome: false,
            detailedListeningStatistics: process.env.SEED_STATISTICS === '1',
            useLightBackgroundTheme: process.env.LIGHT === '1',
            audioEqualizerEnabled: true,
            audioEqualizerMode: 'parametric',
            audioEqualizerParametricProfile: JSON.stringify({
                preamp: -6.2,
                bands: [
                    { enabled: true, type: 'lowshelf', frequency: 105, gain: 5.5, q: 0.7 },
                    { enabled: true, type: 'peaking', frequency: 21, gain: 7.4, q: 0.47 },
                    { enabled: true, type: 'peaking', frequency: 3456, gain: -4.2, q: 2.13 },
                    { enabled: false, type: 'peaking', frequency: 6200, gain: 3, q: 4 },
                    { enabled: true, type: 'highshelf', frequency: 10000, gain: -2.1, q: 0.7 },
                    { enabled: true, type: 'highpass', frequency: 25, gain: 0, q: 0.71 },
                ],
            }),
            audioEqualizerGains: '6;5;3;1;0;-1;0;2;4;5',
        }),
    );

    const app = await electron.launch({
        executablePath: path.join(root, 'node_modules/.bin/electron'),
        args: [root, '--no-sandbox', '--disable-gpu'],
        env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), NODE_OPTIONS: '' },
        timeout: 60000,
    });

    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    await page.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
    await page.waitForSelector('.la-sliders-h', { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, '1-collection.png') });

    // Equalizer, parametric
    await page.click('.la-sliders-h');
    await page.waitForSelector('app-parametric-equalizer-panel', { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, '2-equalizer-parametric.png') });

    // Drag band 3 handle up a bit, to check the interaction
    const marker = page.locator('.peq__marker', { hasText: '3' });
    const box = await marker.boundingBox();
    if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 40, box.y - 30, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(300);
    }
    await page.screenshot({ path: path.join(out, '3-equalizer-parametric-dragged.png') });

    // Equalizer, graphic
    await page.click('.equalizer__mode >> nth=0');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, '4-equalizer-graphic.png') });
    // Import the AutoEQ GraphicEQ test file. The native file dialog is replaced in the main process (the renderer
    // reaches it through @electron/remote), everything after that is the real import.
    const graphicEqFile = path.join(root, 'src/app/services/equalizer/test-data/QCY H3 Pro GraphicEQ.txt');
    await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, graphicEqFile);
    await page
        .locator('app-icon-text-button', { hasText: /import/i })
        .first()
        .click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, '4b-equalizer-graphiceq-imported.png') });
    const importMessage = await page
        .locator('.equalizer__message')
        .textContent()
        .catch(() => '');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Statistics page
    const stats = page.locator('app-sub-menu-item', { hasText: /statistics/i });
    if ((await stats.count()) > 0) {
        await stats.first().click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(out, '5-statistics.png') });

        // The page scrolls: also take the lower parts.
        for (let i = 1; i <= 3; i++) {
            const scrolled = await page.evaluate((n) => {
                const el = document.querySelector('.statistics');
                if (!el) return false;
                const before = el.scrollTop;
                el.scrollTop = n * el.clientHeight * 0.9;
                return el.scrollTop !== before;
            }, i);
            if (!scrolled) break;
            await page.waitForTimeout(300);
            await page.screenshot({ path: path.join(out, `5-statistics-${i}.png`) });
        }
    }

    // Settings search: type, see the list, press Enter and land on the setting.
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => (window.location.hash = '#/settings'));
    const settingsSearch = page.locator('app-settings-search input');
    if ((await page.waitForSelector('app-settings-search input', { timeout: 10000 }).catch(() => null)) !== null) {
        await settingsSearch.fill('fade');
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(out, '6-settings-search.png') });
        await settingsSearch.press('Enter');
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(out, '7-settings-search-found.png') });
        await settingsSearch.fill('samba');
        await settingsSearch.press('Enter');
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(out, '8-settings-search-manage-collection.png') });
    }

    const config = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
    await app.close();

    console.log(`Screenshots in ${out}`);
    console.log('Band 3 after drag:', JSON.parse(config.audioEqualizerParametricProfile).bands[2]);
    console.log('GraphicEQ import message:', (importMessage ?? '').trim());
    console.log('Graphic gains after import:', config.audioEqualizerGains, 'mode:', config.audioEqualizerMode);
    console.log(errors.length === 0 ? 'No page errors' : `Page errors:\n  ${errors.slice(0, 10).join('\n  ')}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
