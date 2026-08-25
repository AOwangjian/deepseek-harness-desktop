import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';

import {
  createCommandProbe,
  detectDependencies,
  type CommandProbe,
} from '../../src/main/harness/dependency-detector';

vi.mock('execa', () => ({ execa: vi.fn() }));

describe('dependency detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a non-shell version probe with the required execa options', async () => {
    const probe = createCommandProbe(async () => true);
    vi.mocked(execa).mockResolvedValue({
      stdout: '1.2.3',
      exitCode: 0,
    } as never);

    await expect(probe('node')).resolves.toEqual({
      stdout: '1.2.3',
      exitCode: 0,
    });
    expect(execa).toHaveBeenCalledWith('node', ['--version'], {
      shell: false,
      reject: false,
      windowsHide: true,
      timeout: 5_000,
    });
  });

  it('uses the injected resolver for Windows missing-command shapes without reading localized text', async () => {
    const probe = createCommandProbe(async () => false);
    vi.mocked(execa).mockResolvedValue({
      stdout: '',
      stderr: "'missing' 不是内部或外部命令",
      shortMessage: '乱码',
      exitCode: 1,
    } as never);

    await expect(probe('missing')).resolves.toEqual({
      notFound: true,
      error: 'command not found',
    });
    expect(execa).not.toHaveBeenCalled();
  });

  it('keeps a normal non-zero command exit as present', async () => {
    const probe = createCommandProbe(async () => true);
    vi.mocked(execa).mockResolvedValue({
      stdout: '',
      stderr: '乱码',
      shortMessage: '乱码',
      exitCode: 1,
    } as never);

    await expect(probe('dsh')).resolves.toMatchObject({
      exitCode: 1,
      error: 'command exited with code 1',
    });
  });

  it('classifies a failed command with no exit code as an execution error', async () => {
    const probe = createCommandProbe(async () => true);
    vi.mocked(execa).mockResolvedValue({
      failed: true,
      stdout: '',
      shortMessage: 'spawn failure',
      exitCode: null,
    } as never);

    await expect(probe('dsh')).resolves.toMatchObject({
      error: 'command execution error',
      shortMessage: 'spawn failure',
    });
  });

  it('classifies a timed-out command without throwing or returning code null', async () => {
    const probe = createCommandProbe(async () => true);
    vi.mocked(execa).mockResolvedValue({
      stdout: '',
      shortMessage: 'timed out',
      timedOut: true,
      exitCode: null,
    } as never);

    await expect(probe('node')).resolves.toMatchObject({
      timedOut: true,
      error: 'command timed out',
    });
    const result = await probe('node');
    expect(result).not.toHaveProperty('exitCode', null);
  });

  it('recognizes structured ENOENT even when the resolver says the command is available', async () => {
    const probe = createCommandProbe(async () => true);
    const enoent = Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
    vi.mocked(execa).mockRejectedValue({
      cause: enoent,
      originalError: enoent,
    });

    await expect(probe('node')).resolves.toEqual({
      notFound: true,
      error: 'command not found',
    });
  });

  it('reports all runtime dependencies and preserves dsh prerelease versions', async () => {
    const probe: CommandProbe = vi.fn(async (command: string) => {
      const versions: Record<string, string> = {
        node: 'v24.13.0',
        npm: '11.6.2',
        dsh: '0.1.1-rc.2',
      };
      return versions[command] ?? null;
    });

    const snapshot = await detectDependencies(probe);

    expect(snapshot).toEqual({
      node: { name: 'node', present: true, version: '24.13.0' },
      npm: { name: 'npm', present: true, version: '11.6.2' },
      dsh: { name: 'dsh', present: true, version: '0.1.1-rc.2' },
      ready: true,
    });
    expect(probe).toHaveBeenCalledWith('node');
    expect(probe).toHaveBeenCalledWith('npm');
    expect(probe).toHaveBeenCalledWith('dsh');
  });

  it('marks a missing executable as not present without throwing', async () => {
    const probe: CommandProbe = vi.fn(async (command: string) =>
      command === 'npm' ? null : '1.2.3',
    );

    const snapshot = await detectDependencies(probe);

    expect(snapshot.npm).toMatchObject({
      name: 'npm',
      present: false,
      error: 'command not found',
    });
    expect(snapshot.npm.version).toBeUndefined();
    expect(snapshot.ready).toBe(false);
  });

  it('distinguishes a command execution error from a missing executable', async () => {
    const probe: CommandProbe = vi.fn(async (command: string) =>
      command === 'dsh'
        ? { error: 'permission denied' }
        : '1.2.3',
    );

    const snapshot = await detectDependencies(probe);

    expect(snapshot.dsh).toMatchObject({
      name: 'dsh',
      present: false,
      error: 'permission denied',
    });
    expect(snapshot.dsh.error).not.toBe(snapshot.npm.error);
    expect(snapshot.ready).toBe(false);
  });

  it('does not throw when an injected probe rejects', async () => {
    const probe: CommandProbe = vi.fn(async (command: string) => {
      if (command === 'dsh') {
        throw new Error('probe unavailable');
      }
      return '1.2.3';
    });

    const snapshot = await detectDependencies(probe);

    expect(snapshot.dsh).toEqual({
      name: 'dsh',
      present: false,
      error: 'probe unavailable',
    });
    expect(snapshot.ready).toBe(false);
  });

  it('distinguishes a non-zero exit code from a missing executable', async () => {
    const probe: CommandProbe = vi.fn(async (command: string) =>
      command === 'npm'
        ? { stdout: '', exitCode: 1, error: 'command exited with code 1' }
        : '1.2.3',
    );

    const snapshot = await detectDependencies(probe);

    expect(snapshot.npm).toMatchObject({
      name: 'npm',
      present: true,
      error: 'command exited with code 1',
    });
    expect(snapshot.npm.error).not.toBe(snapshot.dsh.error);
    expect(snapshot.ready).toBe(false);
  });

  it.each(['', '   ', 'version 1.2.3', '1.2.3 trailing', '1.2'])
    ('rejects invalid version output %j', async (output) => {
      const probe: CommandProbe = vi.fn(async (command: string) =>
        command === 'dsh' ? output : '1.2.3',
      );

      const snapshot = await detectDependencies(probe);

      expect(snapshot.dsh).toMatchObject({
        name: 'dsh',
        present: true,
        error: 'invalid version output',
      });
      expect(snapshot.dsh.version).toBeUndefined();
      expect(snapshot.ready).toBe(false);
    });
});
