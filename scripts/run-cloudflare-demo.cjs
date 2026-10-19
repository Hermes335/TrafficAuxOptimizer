const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const executable = require('./python-path.cjs')(root);
if (!process.argv.includes('--stop')) require('./check-backend-runtime.cjs').checkBackendRuntime(root, executable);
const child = spawn(executable, [path.join(__dirname, 'cloudflare-demo.py'), ...process.argv.slice(2)], {
  cwd: root, env: process.env, stdio: 'inherit', windowsHide: true,
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  const state = path.join(root, '.cloudflare-demo');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'stop-requested'), '');
});
