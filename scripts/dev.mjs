import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

async function bundleCss() {
  const dir = join(root, 'web/styles');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.css')).sort();
  const parts = await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8')));
  await mkdir(join(root, 'web/dist'), { recursive: true });
  await writeFile(join(root, 'web/dist/app.css'), parts.join('\n'), 'utf8');
}

await build({
  entryPoints: [join(root, 'web/src/app.ts')],
  outfile: join(root, 'web/dist/app.js'),
  bundle: true,
  format: 'esm',
  target: ['safari17', 'chrome120'],
  sourcemap: 'inline',
  logLevel: 'warning',
});
await bundleCss();
console.log('web bundle ready');

const tsc = spawn(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json'), '--watch', '--preserveWatchOutput'], {
  stdio: 'inherit',
});

const server = spawn(process.execPath, [join(root, 'bin/antiSL.js'), '--no-open', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

const stop = () => {
  tsc.kill();
  server.kill('SIGTERM');
  process.exit(0);
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
