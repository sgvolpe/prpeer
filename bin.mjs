#!/usr/bin/env node
// Entry point of the `prpeer` command. Plain JavaScript with no dependencies, so it runs on any Node and can
// (1) explain an old Node instead of crashing on TypeScript syntax, (2) install dependencies and build the map
// on first run, and (3) route `prpeer doctor`. Then it hands over to prpeer.ts.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  const how = process.platform === 'win32' ? 'winget install OpenJS.NodeJS.LTS   (or https://nodejs.org)'
    : 'nvm install 24   (https://github.com/nvm-sh/nvm), or https://nodejs.org';
  console.error(`prpeer: Node ${process.versions.node} is too old; PR Peer needs Node 24 or later.\n  Install it with: ${how}\n  Then open a new terminal. Or run the PR Peer installer, which does it for you.`);
  process.exit(1);
}

if (process.argv[2] === 'doctor') {
  await import(pathToFileURL(join(here, 'doctor.ts')).href);
} else {
  if (!existsSync(join(here, 'node_modules')) || !existsSync(join(here, 'web', 'dist', 'map.js'))) {
    console.log('prpeer: first run, installing dependencies and building the map (one minute, once)...');
    // shell: npm is npm.cmd on Windows, which spawn cannot run directly
    const r = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: here, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) { console.error(`prpeer: the install failed. Run "prpeer doctor" to see what is missing, or "npm ci" in ${here}.`); process.exit(1); }
  }
  await import(pathToFileURL(join(here, 'prpeer.ts')).href);
}
