import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { defaultWorkspace, launcherPath, secretsPath, supportRoot } from './store/paths.js';
import { VERSION, ensureLayout, listRuns, rootPath } from './store/index.js';
import { createDashboardServer } from './server/index.js';
import { closeAllRuns, resumeOrphanedRuns } from './engine/index.js';

const paint = (code: string, text: string) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text);
const dim = (t: string) => paint('2', t);
const bold = (t: string) => paint('1', t);
const accent = (t: string) => paint('38;5;166', t);

function usage(): string {
  return `
${bold('antiSL')} ${dim(VERSION)}

  ${accent('antiSL')}                        open the dashboard
  antiSL --port 4400              run on a different port
  antiSL --no-open                do not open a browser
  antiSL doctor                   check the install
  antiSL where                    print the support folder
  antiSL runs                     list recent runs
  antiSL uninstall                remove every file this tool created
                                  (add --yes to confirm)
  antiSL --help                   this message

Support folder
  ${dim(rootPath())}
  If that folder is missing, Anti-Slop is not installed.
`;
}

interface Flags {
  port?: number;
  open: boolean;
  help: boolean;
  version: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { open: true, help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--version' || arg === '-v') flags.version = true;
    else if (arg === '--no-open') flags.open = false;
    else if (arg === '--port' || arg === '-p') {
      const next = argv[i + 1];
      const parsed = Number(next);
      if (!next || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error('--port needs a number between 1 and 65535.');
      }
      flags.port = parsed;
      i += 1;
    } else if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error('--port needs a number between 1 and 65535.');
      }
      flags.port = parsed;
    } else {
      throw new Error(`Unknown option "${arg}". Try antiSL --help.`);
    }
  }
  return flags;
}

function requireInstall(): void {
  if (!existsSync(supportRoot())) {
    console.error(`
${bold('Anti-Slop is not installed on this Mac.')}

The support folder is missing:

  ${dim(supportRoot())}

Run the installer again to set it up:

  ${accent('curl -fsSL https://raw.githubusercontent.com/wehnnit/anti-slop/main/install.sh | bash')}
`);
    process.exit(1);
  }
}

function openBrowser(url: string): void {
  try {
    execFileSync('open', [url], { stdio: 'ignore' });
  } catch {
    /* no browser, or not macOS; the URL is printed either way */
  }
}

async function serve(flags: Flags): Promise<void> {
  requireInstall();
  ensureLayout();
  resumeOrphanedRuns();

  const port = flags.port ?? 4321;
  let running;
  try {
    running = await createDashboardServer({ port });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('EADDRINUSE')) {
      console.error(`Port ${port} is already in use. Try \`antiSL --port ${port + 1}\`.`);
      process.exit(1);
    }
    throw err;
  }

  console.log(`
  ${bold('ANTI-SLOP')} ${dim(`v${VERSION}`)}
  ${dim('dashboard')}  ${accent(running.url)}
  ${dim('workspace')}  ${defaultWorkspace()}
  ${dim('support')}    ${rootPath()}

  ${dim('Ctrl+C to stop.')}
`);

  if (flags.open) openBrowser(running.url);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    console.log(dim('\n  stopping runs and shutting down...'));
    closeAllRuns();
    await running.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
}

function doctor(): void {
  const folder = supportRoot();
  const checks: [string, boolean, string][] = [
    ['support folder', existsSync(folder), folder],
    ['data directory', existsSync(`${folder}/data`), `${folder}/data`],
    ['secrets file', existsSync(secretsPath()), secretsPath()],
    ['launcher on PATH', launcherOnPath(), launcherPath()],
  ];

  console.log(`\n${bold('antiSL doctor')}\n`);
  for (const [label, ok, detail] of checks) {
    const mark = ok ? accent('ok  ') : dim('--  ');
    console.log(`  ${mark}${label.padEnd(20)} ${dim(detail)}`);
  }
  const version = process.version;
  console.log(`  ${dim('node')} ${version} ${Number(version.slice(1).split('.')[0]) >= 22 ? dim('(ok)') : accent('(22.4+ required)')}`);
  console.log();
}

function launcherOnPath(): boolean {
  const path = process.env.PATH ?? '';
  const dir = launcherPath().replace(/\/[^/]+$/, '');
  return path.split(':').includes(dir);
}

function listRunsCli(): void {
  requireInstall();
  const runs = listRuns(15);
  if (runs.length === 0) {
    console.log(dim('\n  No runs yet. Open the dashboard and send your first brief.\n'));
    return;
  }
  console.log();
  for (const run of runs) {
    const when = run.createdAt.replace('T', ' ').slice(0, 16);
    const counts = `${run.stats.done}/${run.stats.tasks}`;
    console.log(`  ${dim(when)}  ${run.status.padEnd(9)} ${counts.padStart(5)}  ${truncate(run.prompt, 70)}`);
  }
  console.log();
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function uninstall(confirmed: boolean): void {
  const folder = supportRoot();
  if (!existsSync(folder)) {
    console.log(dim('\n  Nothing to remove: the support folder is already gone.\n'));
    return;
  }
  if (!confirmed) {
    console.log('');
    console.log('  This deletes ' + bold(folder) + ' and everything in it:');
    console.log('  providers, models, runs, and any work in its scratch folder.');
    console.log('');
    console.log('  Run ' + bold('antiSL uninstall --yes') + ' if that is what you want.');
    console.log('');
    return;
  }
  execFileSync('rm', ['-rf', folder]);
  console.log(`
  ${bold('Removed.')} Anti-Slop and every file it stored are gone.

  If you added the launcher to your shell profile, take out the
  line that points at ${dim(launcherPath())}.
`);
}

async function main(): Promise<void> {
  const [first, ...rest] = process.argv.slice(2);

  if (first === 'doctor') return doctor();
  if (first === 'where') return console.log(rootPath());
  if (first === 'runs') return listRunsCli();
  if (first === 'uninstall') return uninstall(rest.includes('--yes'));

  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) return console.log(usage());
  if (flags.version) return console.log(VERSION);

  await serve(flags);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`antiSL: ${message}`);
  process.exit(1);
});
