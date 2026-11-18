#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'dist', 'cli.js');

if (!existsSync(entry)) {
  console.error('antiSL: build output missing. Run "npm run build" in the project directory first.');
  process.exit(1);
}

await import(entry);
