import { execa } from 'execa';
import { createRequire } from 'node:module';

import type {
  DependencyCheckResult,
  DependencySnapshot,
  RuntimeDependencyName,
} from '../../shared/contracts';

const require = createRequire(import.meta.url);
const semver = require('semver') as {
  valid(version: string): string | null;
};

/** The small result surface needed by the detector's command adapter. */
export interface CommandProbeResult {
  readonly stdout?: string | null;
  readonly exitCode?: number | null;
  readonly error?: string;
  readonly notFound?: boolean;
  readonly executablePath?: string;
}

/**
 * Runs one version command. Strings are accepted for simple injected probes;
 * the default probe returns a structured result so failures remain distinct.
 */
export type CommandProbe = (
  command: string,
) => Promise<string | null | CommandProbeResult>;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return 'command execution error';
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function isNotFoundResult(result: {
  readonly exitCode?: number | null;
  readonly stderr?: string;
  readonly shortMessage?: string;
  readonly code?: string;
}): boolean {
  if (result.code === 'ENOENT') {
    return true;
  }

  const message = `${result.stderr ?? ''}\n${result.shortMessage ?? ''}`;
  return (
    result.exitCode === 1 &&
    /(?:not recognized|not found|no such file or directory|不是内部或外部命令)/i.test(
      message,
    )
  );
}

/** The production command adapter. It never uses a shell and never throws. */
export const defaultCommandProbe: CommandProbe = async (command) => {
  try {
    const result = await execa(command, ['--version'], {
      shell: false,
      reject: false,
      windowsHide: true,
    });

    if (isNotFoundResult(result)) {
      return { notFound: true, error: 'command not found' };
    }

    if (result.exitCode !== undefined && result.exitCode !== 0) {
      return {
        stdout: result.stdout,
        exitCode: result.exitCode,
        error: `command exited with code ${result.exitCode}`,
      };
    }

    return { stdout: result.stdout, exitCode: result.exitCode };
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return { notFound: true, error: 'command not found' };
    }
    return { error: errorMessage(error) };
  }
};

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

  if (probeResult.exitCode !== undefined && probeResult.exitCode !== 0) {
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
      error: isNotFoundError(error) ? 'command not found' : errorMessage(error),
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
