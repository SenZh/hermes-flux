import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../../');

function scanSourceFiles(dir, ext = '.ts') {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanSourceFiles(fullPath, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext) && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

test('Architecture & Monorepo Layering Guardrails (Gate 0 & Gate 1)', async (t) => {
  await t.test('packages/core must be 100% platform-agnostic and UI-free (no imports from ui or desktop)', () => {
    const coreFiles = scanSourceFiles(path.join(REPO_ROOT, 'packages/core/src'));
    assert.ok(coreFiles.length > 0, 'Must find core source files');

    const violations = [];
    const forbiddenPattern = /(from\s+['"][^'"]*(ui|desktop)|import\s+['"][^'"]*(ui|desktop))/i;

    for (const filePath of coreFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (forbiddenPattern.test(line)) {
          violations.push(`${path.relative(REPO_ROOT, filePath)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    assert.equal(
      violations.length,
      0,
      `packages/core must not import UI or Desktop layers. Violations:\n${violations.join('\n')}`
    );
  });

  await t.test('packages/ui must only depend on core, never on desktop or Electron internals', () => {
    const uiFiles = scanSourceFiles(path.join(REPO_ROOT, 'packages/ui/src'));
    assert.ok(uiFiles.length > 0, 'Must find UI source files');

    const violations = [];
    const forbiddenPattern = /(from\s+['"][^'"]*(desktop|electron)|import\s+['"][^'"]*(desktop|electron))/i;

    for (const filePath of uiFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (forbiddenPattern.test(line)) {
          violations.push(`${path.relative(REPO_ROOT, filePath)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    assert.equal(
      violations.length,
      0,
      `packages/ui must not import Desktop layer or electron. Violations:\n${violations.join('\n')}`
    );
  });

  await t.test('Zero "as any" escape hatches in core and UI production source trees', () => {
    const allFiles = [
      ...scanSourceFiles(path.join(REPO_ROOT, 'packages/core/src')),
      ...scanSourceFiles(path.join(REPO_ROOT, 'packages/ui/src')),
    ];

    const violations = [];
    const anyPattern = /\bas\s+any\b|<any>/;

    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        // Exclude comments
        const cleanLine = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        if (anyPattern.test(cleanLine)) {
          violations.push(`${path.relative(REPO_ROOT, filePath)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    assert.equal(
      violations.length,
      0,
      `Strict typing violated: "as any" escape hatches detected:\n${violations.join('\n')}`
    );
  });
});
