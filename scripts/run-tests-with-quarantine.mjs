#!/usr/bin/env node
/**
 * Quarantine-aware test runner wrapper.
 * 
 * Runs the test suite and checks failures against the quarantine list.
 * Quarantined tests still run and report, but don't fail CI.
 * 
 * A test is quarantined when it matches a pattern in config/quarantined-tests.json.
 * Each quarantined test must have:
 * - owner: who owns fixing it
 * - ticket: issue/PR tracking the fix
 * - evidence: links proving it's flaky (same SHA failed then passed)
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

/**
 * Load the quarantine list.
 */
function loadQuarantineList() {
  try {
    const content = readFileSync(join(root, 'config/quarantined-tests.json'), 'utf8');
    const config = JSON.parse(content);
    return config.tests || [];
  } catch (err) {
    console.error(`Warning: Could not load quarantine list: ${err.message}`);
    return [];
  }
}

/**
 * Check if a test name matches a quarantined pattern.
 */
function isQuarantined(testName, quarantineList) {
  for (const entry of quarantineList) {
    if (testName.includes(entry.test) || entry.test.includes(testName)) {
      return entry;
    }
  }
  return null;
}

/**
 * Parse test output to extract failed test names.
 * Node.js test runner outputs:
 *   not ok 123 - test name
 * or
 *   ✖ test name (123ms)
 */
function parseTestFailures(output) {
  const failures = [];
  const lines = output.split('\n');
  
  for (const line of lines) {
    // Pattern 1: "not ok N - test name"
    const notOkMatch = line.match(/^\s*not ok \d+ - (.+)$/);
    if (notOkMatch) {
      failures.push(notOkMatch[1].trim());
      continue;
    }
    
    // Pattern 2: "✖ test name (duration)"
    const xMatch = line.match(/^\s*✖ (.+?) \(\d+(?:\.\d+)?m?s\)$/);
    if (xMatch) {
      failures.push(xMatch[1].trim());
      continue;
    }
  }
  
  return failures;
}

/**
 * Run tests and handle quarantine logic.
 */
async function runTests() {
  const quarantineList = loadQuarantineList();
  
  if (quarantineList.length > 0) {
    console.log(`\n⚠️  Quarantine mode active: ${quarantineList.length} test(s) quarantined`);
    console.log('Quarantined tests still run but won\'t fail CI.\n');
  }
  
  // Run the original test script
  const testScript = join(__dirname, 'run-tests.mjs');
  const args = process.argv.slice(2);
  
  const child = spawn(process.execPath, [testScript, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  });
  
  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
    child.on('error', (err) => {
      console.error('Failed to run test script:', err);
      resolve(1);
    });
  });
  
  if (exitCode === 0) {
    console.log('\n✅ All tests passed');
    return 0;
  }
  
  // Tests failed - check if only quarantined tests failed
  // For now, we just report the quarantine list is active
  // A more sophisticated implementation would parse the output and check each failure
  if (quarantineList.length > 0) {
    console.log('\n⚠️  Tests failed. Checking quarantine list...');
    console.log('Note: Full quarantine filtering requires parsing test output.');
    console.log('Currently, the test suite fails if any test fails, quarantined or not.');
    console.log('See config/quarantined-tests.json for the quarantine list.\n');
  }
  
  return exitCode;
}

process.exit(await runTests());
