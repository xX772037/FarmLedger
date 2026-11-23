// Smoke test: proves the test runner and CI work. Replace and add to it as FarmLedger gets real code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the project is set up: package.json names FarmLedger and npm test runs this suite', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, 'farmledger');
  assert.match(pkg.scripts.test, /node --test/);
});

test('the README introduces FarmLedger', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /^# FarmLedger/m);
});
