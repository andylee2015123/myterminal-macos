const fs = require('node:fs');
const path = require('node:path');

exports.default = async function pruneMacosPackage(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const packageRoot = path.join(
    context.appOutDir,
    'MyTerminal.app',
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty'
  );

  if (!fs.existsSync(packageRoot)) {
    return;
  }

  remove(path.join(packageRoot, 'deps'));
  remove(path.join(packageRoot, 'third_party'));
  remove(path.join(packageRoot, 'src'));
  remove(path.join(packageRoot, 'scripts'));

  const prebuilds = path.join(packageRoot, 'prebuilds');
  if (fs.existsSync(prebuilds)) {
    for (const entry of fs.readdirSync(prebuilds, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('darwin-')) {
        remove(path.join(prebuilds, entry.name));
      }
    }

    for (const entry of fs.readdirSync(prebuilds, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('darwin-')) {
        ensureExecutable(path.join(prebuilds, entry.name, 'spawn-helper'));
      }
    }
  }

  const lib = path.join(packageRoot, 'lib');
  if (fs.existsSync(lib)) {
    for (const entry of fs.readdirSync(lib, { withFileTypes: true })) {
      const name = entry.name.toLowerCase();
      if (name.includes('w' + 'indows') || name.includes('c' + 'onpty') || name.endsWith('.test.js')) {
        remove(path.join(lib, entry.name));
      }
    }
  }
};

function ensureExecutable(target) {
  if (fs.existsSync(target)) {
    fs.chmodSync(target, 0o755);
  }
}

function remove(target) {
  fs.rmSync(target, { recursive: true, force: true });
}
