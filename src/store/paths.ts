import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const SUPPORT_FOLDER = 'Anti-Slop-WEHNIT_STUDIOS';

export function supportRoot(): string {
  const home = homedir();
  if (platform() === 'darwin') {
    return join(home, 'Library', 'Application Support', SUPPORT_FOLDER);
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  return join(xdg, SUPPORT_FOLDER);
}

export function dataDir(): string {
  return join(supportRoot(), 'data');
}

export function secretsPath(): string {
  return join(supportRoot(), 'secrets.json');
}

export function runsDir(): string {
  return join(supportRoot(), 'runs');
}

export function defaultWorkspace(): string {
  return join(supportRoot(), 'workspace');
}

export function launcherPath(): string {
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', SUPPORT_FOLDER, 'bin', 'antiSL');
  }
  return join(homedir(), '.local', 'bin', 'antiSL');
}
