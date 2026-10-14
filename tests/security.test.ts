/**
 * TDD — Module 05: Security & Pentest Gates Tests
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SecurityScanner } from '../src/security/security-scanner.js';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync, existsSync } from 'node:fs';

const testDir = 'tests/tmp-sec';

test('SecurityScanner: clean directory passes scan', () => {
  const scanner = new SecurityScanner();
  const report = scanner.scanSecrets('src');

  assert.equal(report.passed, true);
  assert.equal(report.secretsFound.length, 0);
  assert.equal(report.blockReason, undefined);
});

test('SecurityScanner: detects hardcoded Anthropic secret and blocks quality gate', () => {
  if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
  const leakFile = `${testDir}/leaked.ts`;
  
  // Create simulated secret leak
  writeFileSync(leakFile, 'const key = "sk-ant-api03-abcdef1234567890abcdef1234567890";\n');

  const scanner = new SecurityScanner();
  const report = scanner.scanSecrets(testDir);

  assert.equal(report.passed, false);
  assert.equal(report.secretsFound.length, 1);
  assert.equal(report.secretsFound[0].secretType, 'Anthropic API Key');
  assert.ok(report.secretsFound[0].matchedPreview.includes('REDACTED'));
  assert.ok(report.blockReason?.includes('Security Gate Failed'));

  // Clean up
  unlinkSync(leakFile);
  rmdirSync(testDir);
});

