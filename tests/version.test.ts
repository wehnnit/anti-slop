import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { VERSION } from '../src/store/index.js';

describe('VERSION', () => {
  it('matches the version in package.json', () => {
    // The dashboard footer and the CLI banner both print this. A hardcoded copy
    // once drifted a whole release behind the package, so pin them together.
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    expect(VERSION).toBe(manifest.version);
  });

  it('is a real semantic version, not a placeholder', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(VERSION).not.toBe('0.0.0');
  });
});
