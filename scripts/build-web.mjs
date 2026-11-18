import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const outdir = join(root, 'web/dist');

await mkdir(outdir, { recursive: true });

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const options = {
  entryPoints: [join(root, 'web/src/app.ts')],
  outfile: join(outdir, 'app.js'),
  bundle: true,
  format: 'esm',
  target: ['safari17', 'chrome120'],
  sourcemap: production ? false : 'inline',
  minify: production,
  logLevel: 'warning',
};

async function bundleCss() {
  const dir = join(root, 'web/styles');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.css')).sort();
  const parts = [];
  for (const file of files) {
    parts.push(await readFile(join(dir, file), 'utf8'));
  }
  await writeFile(join(outdir, 'app.css'), parts.join('\n'), 'utf8');
  return files.length;
}

if (watch) {
  const { context } = await import('esbuild');
  const ctx = await context(options);
  await ctx.watch();
  await bundleCss();
  console.log('web bundle watching; css is rebuilt on server start');
} else {
  await build(options);
  const count = await bundleCss();
  console.log(`web bundle written (app.js, app.css from ${count} stylesheets)`);
}
