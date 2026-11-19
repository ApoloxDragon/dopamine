const { spawnSync, spawn } = require('child_process');

// correct encoding for the Windows terminal
if (process.platform === 'win32') {
    spawnSync('chcp', ['65001'], {
        shell: true,
        stdio: 'inherit',
    });
}

process.env.ELECTRON_RUN_AS_NODE = 'true';

const jestArgs = process.argv.slice(2);
const child = spawn('electron', ['./node_modules/jest/bin/jest.js', '--colors', ...jestArgs], {
    shell: true,
    stdio: 'inherit',
    env: process.env,
});

// Pass on Jest's result: without this, failing tests still ended with exit code 0 (and CI stayed green).
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on('error', () => process.exit(1));
