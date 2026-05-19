#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const helperCandidates = [
  path.join(projectRoot, 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper'),
  path.join(projectRoot, 'node_modules', 'node-pty', 'prebuilds', 'darwin-x64', 'spawn-helper'),
  path.join(projectRoot, 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper')
];

let fixedCount = 0;

for (const helperPath of helperCandidates) {
  if (!fs.existsSync(helperPath)) {
    continue;
  }

  fs.chmodSync(helperPath, 0o755);
  fixedCount += 1;
}

if (fixedCount > 0) {
  console.log(`Updated node-pty helper permissions (${fixedCount}).`);
}
