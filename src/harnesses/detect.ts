import { execFile } from 'node:child_process';
import type { DetectionEntry, HarnessKind } from '../types.js';

interface Candidate {
  kind: HarnessKind;
  label: string;
  command: string;
  versionArgs: string[];
  suggestedModels: string[];
}

const candidates: Candidate[] = [
  { kind: 'codex', label: 'Codex CLI', command: 'codex', versionArgs: ['--version'], suggestedModels: ['gpt-5.1-codex', 'gpt-5.1-codex-mini'] },
  { kind: 'claude', label: 'Claude Code', command: 'claude', versionArgs: ['--version'], suggestedModels: ['claude-sonnet-4-5', 'claude-opus-4-1'] },
  { kind: 'opencode', label: 'OpenCode', command: 'opencode', versionArgs: ['--version'], suggestedModels: [] },
  { kind: 'hermes', label: 'Hermes Agent', command: 'hermes', versionArgs: ['--version'], suggestedModels: [] },
  { kind: 'cursor', label: 'Cursor Agent', command: 'cursor-agent', versionArgs: ['--version'], suggestedModels: [] },
];

function run(command: string, args: string[], timeout = 4000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ?? ''}`.trim();
      resolve({ ok: !err, out });
    });
  });
}

function which(command: string): Promise<boolean> {
  const finder = process.platform === 'darwin' ? 'which' : 'which';
  return run(finder, [command], 2500).then((r) => r.ok && r.out.length > 0);
}

function versionOf(text: string): string | undefined {
  const match = text.match(/\d+\.\d+(?:\.\d+)?/);
  return match ? match[0] : undefined;
}

export async function detectHarnesses(): Promise<DetectionEntry[]> {
  const results = await Promise.all(
    candidates.map(async (candidate): Promise<DetectionEntry> => {
      const found = await which(candidate.command);
      if (!found) {
        return {
          kind: candidate.kind,
          label: candidate.label,
          installed: false,
          command: candidate.command,
          suggestedModels: candidate.suggestedModels,
        };
      }
      const probe = await run(candidate.command, candidate.versionArgs);
      return {
        kind: candidate.kind,
        label: candidate.label,
        installed: true,
        command: candidate.command,
        version: versionOf(probe.out),
        suggestedModels: candidate.suggestedModels,
      };
    }),
  );
  return results;
}
