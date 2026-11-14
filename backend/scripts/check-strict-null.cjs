#!/usr/bin/env node
// Gradual strictNullChecks: type-check the whole project with strict null
// checks and fail on any error in a source file that is not on the to-do
// list. New files are therefore strict from the start, and fixed files must
// be removed from the list so they stay fixed.
const { spawnSync } = require('child_process');
const { readFileSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const todoFile = path.join(root, 'strict-null-checks-todo.txt');
const todo = new Set(
  readFileSync(todoFile, 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')),
);

const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json', '--strictNullChecks'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (tsc.error) throw tsc.error;
const output = `${tsc.stdout}${tsc.stderr}`;
const errors = output.split('\n').filter(line => /^src\/[^(]+\(\d+,\d+\): error TS/.test(line));
const failingFiles = new Set(errors.map(line => line.slice(0, line.indexOf('('))));

const regressions = errors.filter(line => !todo.has(line.slice(0, line.indexOf('('))));
const fixed = [...todo].filter(file => !failingFiles.has(file));

if (regressions.length) {
  console.error(`strictNullChecks: ${regressions.length} error(s) in files that must stay strict:\n`);
  console.error(regressions.join('\n'));
}
if (fixed.length) {
  console.error(`\nstrictNullChecks: these files are now clean; remove them from strict-null-checks-todo.txt:\n${fixed.join('\n')}`);
}
if (regressions.length || fixed.length) process.exit(1);
console.log(`strictNullChecks: OK (${todo.size} file(s) still on the to-do list).`);
