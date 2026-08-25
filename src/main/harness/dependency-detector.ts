import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { execa } from 'execa';

import type {
  DependencyCheckResult,
  DependencySnapshot,
  RuntimeDependencyName,
} from '../../shared/contracts';

const require = createRequire(import.meta.url);
const semver = require('semver') as {
  valid(version: string): string | null;
};

const COMMAND_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_LIMIT = 2_048;

/** A probe result keeps process failures distinct from invalid version output. */
export interface CommandProbeResult {
  readonly stdout?: string | null;
  readonly exitCode?: number | null;
  readonly error?: string;
  readonly notFound?: boolean;
  readonly timedOut?: boolean;
  readonly executablePath?: string;
  readonly stderr?: string;
  readonly shortMessage?: string;
}

/** Resolves a command through PATH/PATHEXT without starting a process. */
export type CommandResolver = (command: string) => Promise<boolean>;

/**
 * Runs one version command. The injected resolver makes command discovery
 * deterministic in tests and avoids relying on localized command errors.
 */
export type CommandProbe = (
  command: string,
) => Promise<string | null | CommandProbeResult>;

function diagnostic(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value.length <= DIAGNOSTIC_LIMIT
    ? value
    : `${value.slice(0, DIAGNOSTIC_LIMIT)}…`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return 'command execution error';
}

function hasCode(value: unknown, code: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    (value as { code?: unknown }).code === code
  );
}

function nestedFailure(
  value: unknown,
  predicate: (candidate: unknown) => boolean,
  seen = new Set<object>(),
): boolean {
  if (predicate(value)) {
    return true;
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return false;
  }
  seen.add(value);
  for (const key of ['cause', 'originalError', 'error']) {
    if (nestedFailure((value as Record<string, unknown>)[key], predicate, seen)) {
      return true;
    }
  }
  return false;
}

function isEnoent(value: unknown): boolean {
  return nestedFailure(value, (candidate) => hasCode(candidate, 'ENOENT'));
}

function isTimedOut(value: unknown): boolean {
  return nestedFailure(
    value,
    (candidate) =>
      (typeof candidate === 'object' &&
        candidate !== null &&
        'timedOut' in candidate &&
        (candidate as { timedOut?: unknown }).timedOut === true) ||
      hasCode(candidate, 'ETIMEDOUT'),
  );
}

function commandCandidates(command: string): string[] {
  const isWindows = process.platform === 'win32';
  const hasPath = /[\\/]/.test(command);
  const directories = hasPath
    ? ['']
    : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const hasExtension = path.extname(command) !== '';
  const extensions =
    isWindows && !hasExtension
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
      : [''];

  return directories.flatMap((directory) =>
    extensions.map((extension) =>
      directory === ''
        ? `${command}${extension}`
        : path.join(directory, `${command}${extension}`),
    ),
  );
}

export const defaultCommandResolver: CommandResolver = async (command) => {
  for (const candidate of commandCandidates(command)) {
    try {
      await access(candidate, constants.F_OK);
      return true;
    } catch {
      // Try the next PATH/PATHEXT candidate.
    }
  }
  return false;
};

function resultDiagnostics(result: {
  readonly stderr?: unknown;
  readonly shortMessage?: unknown;
} | null | undefined): Pick<CommandProbeResult, 'stderr' | 'shortMessage'> {
  const stderr = diagnostic(result?.stderr);
  const shortMessage = diagnostic(result?.shortMessage);
  return {
    ...(stderr === undefined ? {} : { stderr }),
    ...(shortMessage === undefined ? {} : { shortMessage }),
  };
}

/** Creates a time-bounded adapter using shell:false and a separate argument array. */
export function createCommandProbe(
  resolver: CommandResolver = defaultCommandResolver,
): CommandProbe {
  return async (command) => {
    let resolvable: boolean;
    try {
      resolvable = await resolver(command);
    } catch (error: unknown) {
      return { error: errorMessage(error) };
    }
    if (!resolvable) {
      return { notFound: true, error: 'command not found' };
    }

    try {
      const result = await execa(command, ['--version'], {
        shell: false,
        reject: false,
        windowsHide: true,
        timeout: COMMAND_TIMEOUT_MS,
      });
      const diagnostics = resultDiagnostics(result);

      if (isEnoent(result)) {
        return { notFound: true, error: 'command not found', ...diagnostics };
      }
      if (isTimedOut(result)) {
        return { timedOut: true, error: 'command timed out', ...diagnostics };
      }

      const exitCode =
        typeof result.exitCode === 'number' ? result.exitCode : undefined;
      if (result.failed === true && exitCode === undefined) {
        return { error: 'command execution error', ...diagnostics };
      }
      if (exitCode !== undefined && exitCode !== 0) {
        return {
          stdout: result.stdout,
          exitCode,
          error: `command exited with code ${exitCode}`,
          ...diagnostics,
        };
      }

      return {
        stdout: result.stdout,
        ...(exitCode === undefined ? {} : { exitCode }),
        ...diagnostics,
      };
    } catch (error: unknown) {
      const diagnostics = resultDiagnostics(
        error as { stderr?: unknown; shortMessage?: unknown },
      );
      if (isEnoent(error)) {
        return { notFound: true, error: 'command not found', ...diagnostics };
      }
      if (isTimedOut(error)) {
        return { timedOut: true, error: 'command timed out', ...diagnostics };
      }
      return { error: errorMessage(error), ...diagnostics };
    }
  };
}

export const defaultCommandProbe: CommandProbe = createCommandProbe();

function invalidVersionResult<Name extends RuntimeDependencyName>(
  name: Name,
  executablePath?: string,
): DependencyCheckResult<Name> {
  return {
    name,
    present: true,
    ...(executablePath === undefined ? {} : { executablePath }),
    error: 'invalid version output',
  };
}

function parseVersion<Name extends RuntimeDependencyName>(
  name: Name,
  stdout: string | null | undefined,
  executablePath?: string,
): DependencyCheckResult<Name> {
  if (typeof stdout !== 'string') {
    return invalidVersionResult(name, executablePath);
  }

  let candidate = stdout.trim();
  if (name === 'node' && candidate.startsWith('v')) {
    candidate = candidate.slice(1);
  }

  const version = semver.valid(candidate);
  if (version === null || version !== candidate) {
    return invalidVersionResult(name, executablePath);
  }

  return {
    name,
    present: true,
    version,
    ...(executablePath === undefined ? {} : { executablePath }),
  };
}

function checkVersion<Name extends RuntimeDependencyName>(
  name: Name,
  probeResult: string | null | CommandProbeResult,
): DependencyCheckResult<Name> {
  if (probeResult === null) {
    return { name, present: false, error: 'command not found' };
  }
  if (typeof probeResult === 'string') {
    return parseVersion(name, probeResult);
  }

  const executablePath = probeResult.executablePath;
  if (probeResult.notFound === true) {
    return {
      name,
      present: false,
      ...(executablePath === undefined ? {} : { executablePath }),
      error: probeResult.error?.trim() || 'command not found',
    };
  }
  if (probeResult.timedOut === true) {
    return {
      name,
      present: false,
      ...(executablePath === undefined ? {} : { executablePath }),
      error: probeResult.error?.trim() || 'command timed out',
    };
  }
  if (typeof probeResult.exitCode === 'number' && probeResult.exitCode !== 0) {
    return {
      name,
      present: true,
      ...(executablePath === undefined ? {} : { executablePath }),
      error:
        probeResult.error?.trim() ||
        `command exited with code ${probeResult.exitCode}`,
    };
  }
  if (probeResult.error !== undefined) {
    return {
      name,
      present: false,
      ...(executablePath === undefined ? {} : { executablePath }),
      error: probeResult.error.trim() || 'command execution error',
    };
  }
  return parseVersion(name, probeResult.stdout, executablePath);
}

async function checkDependency<Name extends RuntimeDependencyName>(
  name: Name,
  probe: CommandProbe,
): Promise<DependencyCheckResult<Name>> {
  try {
    return checkVersion(name, await probe(name));
  } catch (error: unknown) {
    return {
      name,
      present: false,
      error: isEnoent(error) ? 'command not found' : errorMessage(error),
    };
  }
}

export async function detectDependencies(
  probe: CommandProbe = defaultCommandProbe,
): Promise<DependencySnapshot> {
  const [node, npm, dsh] = await Promise.all([
    checkDependency('node', probe),
    checkDependency('npm', probe),
    checkDependency('dsh', probe),
  ]);

  return {
    node,
    npm,
    dsh,
    ready: [node, npm, dsh].every(
      (dependency) => dependency.present && dependency.version !== undefined,
    ),
  };
}
