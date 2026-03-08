#!/usr/bin/env node
/**
 * Copy better-sqlite3 and its runtime dependencies into a distribution directory.
 *
 * Uses Node.js fs.cpSync (recursive, dereferences symlinks/junctions) instead of
 * shell `cp -r`, because Git Bash on Windows can't always follow NTFS junctions
 * that pnpm creates in node_modules/.pnpm/.
 *
 * Runtime dependency chain:
 *   better-sqlite3 → bindings → file-uri-to-path
 *
 * Usage: node scripts/copy-native-deps.mjs <dist-dir>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const distDir = process.argv[2];
if (!distDir) {
  console.error('Usage: node scripts/copy-native-deps.mjs <dist-dir>');
  process.exit(1);
}

const nodeModulesDir = path.join(distDir, 'node_modules');
fs.mkdirSync(nodeModulesDir, { recursive: true });

/**
 * Resolve a package directory using Node's module resolution,
 * starting from a given root directory.
 */
function resolvePackageDir(pkg, fromDir) {
  const req = createRequire(path.join(fromDir, 'index.js'));
  const pkgJson = req.resolve(`${pkg}/package.json`);
  return path.dirname(pkgJson);
}

// In pnpm workspaces, better-sqlite3 is only accessible from packages that
// depend on it directly. packages/core depends on better-sqlite3.
const coreDir = path.resolve('packages/core');

// Step 1: Resolve better-sqlite3 from packages/core
const sqlite3Dir = resolvePackageDir('better-sqlite3', coreDir);
console.log(`Resolved better-sqlite3: ${sqlite3Dir}`);

// Step 2: Resolve bindings from better-sqlite3 (it's a dep of better-sqlite3)
const bindingsDir = resolvePackageDir('bindings', sqlite3Dir);
console.log(`Resolved bindings: ${bindingsDir}`);

// Step 3: Resolve file-uri-to-path from bindings (it's a dep of bindings)
const futpDir = resolvePackageDir('file-uri-to-path', bindingsDir);
console.log(`Resolved file-uri-to-path: ${futpDir}`);

// Copy each package to the flat node_modules layout in the distribution
const copies = [
  { name: 'better-sqlite3', src: sqlite3Dir },
  { name: 'bindings', src: bindingsDir },
  { name: 'file-uri-to-path', src: futpDir },
];

for (const { name, src } of copies) {
  const dest = path.join(nodeModulesDir, name);
  console.log(`Copying ${name} → ${dest}`);
  // fs.cpSync with dereference follows symlinks and NTFS junctions correctly
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

// Verify the native addon exists
const nativeAddon = findFile(path.join(nodeModulesDir, 'better-sqlite3'), '.node');
if (!nativeAddon) {
  console.error('ERROR: Native addon (.node file) not found in better-sqlite3!');
  console.error('Files found:');
  listFiles(path.join(nodeModulesDir, 'better-sqlite3'), 0);
  process.exit(1);
}
console.log(`\n✅ Native deps copied to ${nodeModulesDir}`);
console.log(`   Native addon: ${nativeAddon}`);

function findFile(dir, ext) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFile(full, ext);
        if (found) return found;
      } else if (entry.name.endsWith(ext)) {
        return full;
      }
    }
  } catch {}
  return null;
}

function listFiles(dir, depth) {
  if (depth > 3) return;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      console.error('  '.repeat(depth + 1) + entry.name + (entry.isDirectory() ? '/' : ''));
      if (entry.isDirectory()) listFiles(full, depth + 1);
    }
  } catch {}
}
