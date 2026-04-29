/* global process */

import { spawn } from 'node:child_process';

const commands = [
  { name: 'server', command: 'tsx', args: ['claudeville/server.ts'] },
  { name: 'vite', command: 'vite', args: [] },
];

const children = new Set();
let shuttingDown = false;

function prefixLines(name, chunk, stream) {
  const lines = chunk.toString().split(/\r?\n/);
  for (const line of lines) {
    if (line.length > 0) {
      stream.write(`[${name}] ${line}\n`);
    }
  }
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    child.kill(signal);
  }
}

for (const { name, command, args } of commands) {
  const child = spawn(command, args, {
    env: process.env,
    shell: process.platform === 'win32',
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  children.add(child);
  child.stdout.on('data', (chunk) => prefixLines(name, chunk, process.stdout));
  child.stderr.on('data', (chunk) => prefixLines(name, chunk, process.stderr));
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      process.stderr.write(`[${name}] exited with ${signal ?? `code ${code}`}\n`);
      shutdown('SIGTERM');
      process.exitCode = code ?? 1;
    }
    if (children.size === 0) {
      process.exit(process.exitCode ?? 0);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
