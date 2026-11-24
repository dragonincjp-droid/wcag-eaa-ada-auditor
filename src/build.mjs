#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'src');
const distDir = path.join(projectRoot, 'dist');
const checkOnly = process.argv.includes('--check');

const tscBin = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
);

if (fs.existsSync(tscBin)) {
  if (!checkOnly) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  const args = checkOnly ? ['--noEmit', '-p', 'tsconfig.json'] : ['-p', 'tsconfig.json'];
  const result = spawnSync(tscBin, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(result.status ?? 1);
}

function collectTsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

if (!checkOnly) {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
}

const tsFiles = collectTsFiles(srcDir);
for (const filePath of tsFiles) {
  const relPath = path.relative(srcDir, filePath);
  const tsCode = fs.readFileSync(filePath, 'utf8');
  const jsCode = stripTypeScriptTypes(tsCode, {
    mode: 'strip',
    sourceUrl: relPath,
  });

  if (!checkOnly) {
    const outPath = path.join(distDir, relPath.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, jsCode, 'utf8');
  }
}

console.log(
  checkOnly
    ? `[build] Type-syntax check passed for ${tsFiles.length} TypeScript files.`
    : `[build] Compiled ${tsFiles.length} TypeScript files to dist/.`,
);
