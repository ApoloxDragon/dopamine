#!/usr/bin/env node
// Plays two files in the real app (npm run build:prod) and shows what the Linux desktop gets over MPRIS (lock screen,
// media widgets): the title and the cover published as mpris:artUrl (its centre colour and size), before and after "Next".
// Run inside a private D-Bus session on a virtual display:
//   dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" node scripts/dev/mpris-cover-check.js <file1> <file2>
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { _electron: electron } = require('playwright');
const root = '/home/user/dopamine';

function mpris(method, ...args) {
    const names = execSync('gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.ListNames').toString();
    const name = (names.match(/org\.mpris\.MediaPlayer2[^']*/) || [])[0];
    if (!name) return '';
    return execSync(`gdbus call --session --dest ${name} --object-path /org/mpris/MediaPlayer2 --method ${method} ${args.join(' ')}`).toString();
}

function state() {
    const meta = mpris('org.freedesktop.DBus.Properties.Get', 'org.mpris.MediaPlayer2.Player', 'Metadata');
    const title = (meta.match(/xesam:title': <'([^']*)'/) || [])[1] ?? '<none>';
    const art = (meta.match(/mpris:artUrl': <'([^']*)'/) || [])[1];
    if (!art) return `${title}: <no cover>`;
    const file = art.replace('file://', '');
    const rgb = execSync(`ffmpeg -loglevel error -i "${file}" -vf crop=1:1:in_w/2:in_h/2 -f rawvideo -pix_fmt rgb24 -`);
    const [r, g, b] = rgb;
    const size = execSync(`ffprobe -v error -show_entries stream=width,height -of csv=p=0 "${file}"`).toString().trim();
    fs.copyFileSync(file, path.join(path.dirname(process.argv[2]), `published-${title.replace(/\W+/g, '-')}.png`));
    const named = r > 150 && g < 110 && b < 110 ? 'RED (the big embedded cover)' : `rgb(${r},${g},${b})`;
    return `${title}: cover ${named}, ${size} px`;
}

(async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dop-'));
    fs.mkdirSync(path.join(home, '.config', 'Dopamine'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'Dopamine', 'config.json'), JSON.stringify({ showWelcome: false }));
    const app = await electron.launch({
        executablePath: path.join(root, 'node_modules/.bin/electron'),
        args: [root, '--no-sandbox', '--disable-gpu', process.argv[2], process.argv[3]],
        env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), NODE_OPTIONS: '' },
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(12000);
    console.log('playing first song ->', state());
    mpris('org.mpris.MediaPlayer2.Player.Next');
    await page.waitForTimeout(6000);
    console.log('after Next (lock screen button) ->', state());
    await page.screenshot({ path: path.join(path.dirname(process.argv[2]), 'app-after-next.png') });
    await app.close();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
