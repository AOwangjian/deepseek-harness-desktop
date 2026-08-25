import { PassThrough } from 'node:stream';

import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConfirmationTokenIssuer,
  InstallExecutionError,
  createInstallPlan,
  defaultInstallExecutor,
  executeInstallPlan,
  type InstallExecutor,
} from '../../src/main/harness/dependency-installer';

vi.mock('execa', () => ({ execa: vi.fn() }));

describe('dependency installer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the exact winget plan for Node', () => {
    const plan = createInstallPlan(
      { dependency: 'node', mode: 'automatic' },
      '22.12.0',
    );

    expect(plan).toEqual({
      executable: 'winget',
      args: ['install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--source', 'winget'],
      source: 'Windows Package Manager',
      version: '22.12.0',
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan?.args)).toBe(true);
  });

  it('creates the exact npm plan for dsh', () => {
    expect(
      createInstallPlan({ dependency: 'dsh', mode: 'automatic' }, '0.1.1-rc.2'),
    ).toEqual({
      executable: 'npm',
      args: ['install', '--global', '@deepseek-ai/dsh@0.1.1-rc.2'],
      source: 'npmjs.org',
      version: '0.1.1-rc.2',
    });
  });

  it.each(['manual', 'later'] as const)(
    'does not execute for %s requests',
    (mode) => {
      expect(createInstallPlan({ dependency: 'node', mode }, '22.12.0')).toBeNull();
    },
  );

  it('rejects invalid versions and npm as an installation target', () => {
    expect(() =>
      createInstallPlan({ dependency: 'node', mode: 'automatic' }, '22'),
    ).toThrow(/version/i);
    expect(() =>
      createInstallPlan({ dependency: 'npm', mode: 'automatic' }, '11.0.0'),
    ).toThrow(/request|dependency/i);
  });

  it('requires a matching, unexpired, one-use confirmation token', async () => {
    let now = 1_000;
    const issuer = new ConfirmationTokenIssuer({ ttlMs: 100, now: () => now });
    const plan = createInstallPlan({ dependency: 'node', mode: 'automatic' }, '22.12.0');
    if (plan === null) throw new Error('expected an install plan');
    const executor: InstallExecutor = vi.fn(async () => ({ exitCode: 0 }));
    const token = issuer.issue(plan);

    await expect(executeInstallPlan(plan, token, issuer, executor)).resolves.toMatchObject({
      exitCode: 0,
    });
    await expect(executeInstallPlan(plan, token, issuer, executor)).rejects.toMatchObject({
      code: 'CONFIRMATION_INVALID',
    });

    const secondToken = issuer.issue(plan);
    now = 1_101;
    await expect(executeInstallPlan(plan, secondToken, issuer, executor)).rejects.toMatchObject({
      code: 'CONFIRMATION_EXPIRED',
    });
  });

  it('cleans expired tokens when issuing a new confirmation', () => {
    let now = 1_000;
    const issuer = new ConfirmationTokenIssuer({
      ttlMs: 100,
      maxTokens: 10,
      now: () => now,
    });
    const expiredPlan = createInstallPlan(
      { dependency: 'node', mode: 'automatic' },
      '22.12.0',
    );
    const currentPlan = createInstallPlan(
      { dependency: 'node', mode: 'automatic' },
      '22.13.0',
    );
    if (expiredPlan === null || currentPlan === null) {
      throw new Error('expected install plans');
    }
    const expiredToken = issuer.issue(expiredPlan);
    now = 1_101;

    issuer.issue(currentPlan);

    try {
      issuer.consume(expiredToken, expiredPlan);
      throw new Error('expected the expired token to be removed');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'CONFIRMATION_INVALID' });
    }
  });

  it('caps outstanding confirmation tokens by evicting the oldest token', () => {
    const issuer = new ConfirmationTokenIssuer({ maxTokens: 2 });
    const firstPlan = createInstallPlan(
      { dependency: 'node', mode: 'automatic' },
      '22.12.0',
    );
    const secondPlan = createInstallPlan(
      { dependency: 'node', mode: 'automatic' },
      '22.13.0',
    );
    const thirdPlan = createInstallPlan(
      { dependency: 'node', mode: 'automatic' },
      '22.14.0',
    );
    if (firstPlan === null || secondPlan === null || thirdPlan === null) {
      throw new Error('expected install plans');
    }
    const firstToken = issuer.issue(firstPlan);
    const secondToken = issuer.issue(secondPlan);
    const thirdToken = issuer.issue(thirdPlan);

    try {
      issuer.consume(firstToken, firstPlan);
      throw new Error('expected the oldest token to be evicted');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'CONFIRMATION_INVALID' });
    }
    expect(() => issuer.consume(secondToken, secondPlan)).not.toThrow();
    expect(() => issuer.consume(thirdToken, thirdPlan)).not.toThrow();
  });

  it('refuses a token issued for a different valid allow-listed plan', async () => {
    const issuer = new ConfirmationTokenIssuer();
    const displayedPlan = createInstallPlan(
      { dependency: 'node', mode: 'automatic' },
      '22.12.0',
    );
    const replacementPlan = createInstallPlan(
      { dependency: 'node', mode: 'automatic' },
      '22.13.0',
    );
    if (displayedPlan === null || replacementPlan === null) {
      throw new Error('expected install plans');
    }
    const executor: InstallExecutor = vi.fn(async () => ({ exitCode: 0 }));
    const token = issuer.issue(displayedPlan);

    await expect(
      executeInstallPlan(replacementPlan, token, issuer, executor),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_INVALID' });
    expect(executor).not.toHaveBeenCalled();
  });

  it('rejects plan tampering even when the token is valid for the shown plan', async () => {
    const issuer = new ConfirmationTokenIssuer();
    const plan = createInstallPlan({ dependency: 'dsh', mode: 'automatic' }, '0.1.1');
    if (plan === null) throw new Error('expected an install plan');
    const token = issuer.issue(plan);
    const forgedPlan = Object.freeze({
      ...plan,
      args: Object.freeze(['install', '--global', 'evil-package']),
    });

    await expect(
      executeInstallPlan(forgedPlan, token, issuer, vi.fn()),
    ).rejects.toMatchObject({ code: 'PLAN_INVALID' });
  });

  it('runs the default executor with exact argv, shell disabled, and no environment', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let finish: (() => void) | undefined;
    const child = Object.assign(
      new Promise<{ exitCode: number }>((resolve) => {
        finish = () => resolve({ exitCode: 0 });
      }),
      { stdout, stderr },
    );
    vi.mocked(execa).mockReturnValue(child as never);
    const controller = new AbortController();

    const execution = defaultInstallExecutor(
      'npm',
      ['install', '--global', '@deepseek-ai/dsh@0.1.1'],
      {
        shell: false,
        windowsHide: true,
        reject: false,
        timeoutMs: 500,
        signal: controller.signal,
        onProgress: () => {
          throw new Error('observer failed');
        },
      },
    );
    stdout.end('installed');
    stderr.end('');
    finish?.();

    await expect(execution).resolves.toEqual({ exitCode: 0 });
    expect(execa).toHaveBeenCalledWith(
      'npm',
      ['install', '--global', '@deepseek-ai/dsh@0.1.1'],
      {
        shell: false,
        windowsHide: true,
        reject: false,
        buffer: false,
        timeout: 500,
        cancelSignal: controller.signal,
      },
    );
  });

  it('decodes UTF-8 progress split across stream chunks without garbling Chinese text', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let finish: (() => void) | undefined;
    const child = Object.assign(
      new Promise<{ exitCode: number }>((resolve) => {
        finish = () => resolve({ exitCode: 0 });
      }),
      { stdout, stderr },
    );
    vi.mocked(execa).mockReturnValue(child as never);
    const progress: Array<{ stream: string; text: string }> = [];

    const execution = defaultInstallExecutor('winget', ['install'], {
      shell: false,
      windowsHide: true,
      reject: false,
      onProgress: (event) => progress.push(event),
    });
    const output = Buffer.from('安装完成', 'utf8');
    stdout.write(output.subarray(0, 1));
    stdout.write(output.subarray(1, 4));
    stdout.end(output.subarray(4));
    stderr.end();
    finish?.();

    await expect(execution).resolves.toEqual({ exitCode: 0 });
    expect(progress.map((event) => event.text).join('')).toBe('安装完成');
    expect(progress.map((event) => event.text).join('')).not.toContain('�');
  });

  it('replaces an oversized progress chunk with one bounded truncation event', async () => {
    const issuer = new ConfirmationTokenIssuer();
    const plan = createInstallPlan({ dependency: 'node', mode: 'automatic' }, '22.12.0');
    if (plan === null) throw new Error('expected an install plan');
    const progress = vi.fn();
    const executor: InstallExecutor = vi.fn(async (_executable, _args, options) => {
      options.onProgress?.({
        stream: 'stdout',
        text: 'output-that-must-not-be-retained-'.repeat(100_000),
      });
      return { exitCode: 0 };
    });

    const result = await executeInstallPlan(plan, issuer.issue(plan), issuer, executor, {
      onProgress: progress,
    });

    const truncationEvent = {
      stream: 'stdout',
      text: 'Installation output truncated.',
    };
    expect(result.progressEvents).toEqual([truncationEvent]);
    expect(progress).toHaveBeenCalledExactlyOnceWith(truncationEvent);
  });

  it('bounds cumulative UTF-8 progress bytes and emits one truncation event', async () => {
    const issuer = new ConfirmationTokenIssuer();
    const plan = createInstallPlan({ dependency: 'node', mode: 'automatic' }, '22.12.0');
    if (plan === null) throw new Error('expected an install plan');
    const executor: InstallExecutor = vi.fn(async (_executable, _args, options) => {
      for (let index = 0; index < 100; index += 1) {
        options.onProgress?.({ stream: 'stderr', text: '安装'.repeat(1_000) });
      }
      return { exitCode: 0 };
    });

    const result = await executeInstallPlan(plan, issuer.issue(plan), issuer, executor);

    expect(
      result.progressEvents.reduce(
        (total, event) => total + Buffer.byteLength(event.text, 'utf8'),
        0,
      ),
    ).toBeLessThanOrEqual(64 * 1_024);
    expect(result.progressEvents.at(-1)).toEqual({
      stream: 'stderr',
      text: 'Installation output truncated.',
    });
    expect(
      result.progressEvents.filter(
        (event) => event.text === 'Installation output truncated.',
      ),
    ).toHaveLength(1);
  });

  it('isolates progress observer failures from successful installation', async () => {
    const issuer = new ConfirmationTokenIssuer();
    const plan = createInstallPlan({ dependency: 'node', mode: 'automatic' }, '22.12.0');
    if (plan === null) throw new Error('expected an install plan');
    const executor: InstallExecutor = vi.fn(async (_executable, _args, options) => {
      options.onProgress?.({ stream: 'stdout', text: 'installing' });
      return { exitCode: 0 };
    });

    await expect(
      executeInstallPlan(plan, issuer.issue(plan), issuer, executor, {
        onProgress: () => {
          throw new Error('observer failed');
        },
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      progressEvents: [{ stream: 'stdout', text: 'installing' }],
    });
  });

  it('uses a bounded timeout and maps timeout and cancellation without exposing output', async () => {
    const issuer = new ConfirmationTokenIssuer();
    const plan = createInstallPlan({ dependency: 'node', mode: 'automatic' }, '22.12.0');
    if (plan === null) throw new Error('expected an install plan');
    const controller = new AbortController();
    const timeoutExecutor: InstallExecutor = vi.fn(async (_executable, _args, options) => {
      expect(options.timeoutMs).toBeGreaterThan(0);
      expect(options.signal).toBe(controller.signal);
      return { exitCode: undefined, timedOut: true };
    });

    await expect(
      executeInstallPlan(plan, issuer.issue(plan), issuer, timeoutExecutor, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'INSTALL_TIMED_OUT' });

    const cancelledExecutor: InstallExecutor = vi.fn(async () => ({
      exitCode: undefined,
      cancelled: true,
    }));
    await expect(
      executeInstallPlan(plan, issuer.issue(plan), issuer, cancelledExecutor),
    ).rejects.toMatchObject({ code: 'INSTALL_CANCELLED' });
  });

  it.each([
    ['ENOENT', 'INSTALL_NOT_FOUND'],
    ['EACCES', 'INSTALL_PERMISSION_DENIED'],
  ] as const)('maps %s spawn failures to a safe %s error', async (spawnCode, code) => {
    const issuer = new ConfirmationTokenIssuer();
    const plan = createInstallPlan({ dependency: 'node', mode: 'automatic' }, '22.12.0');
    if (plan === null) throw new Error('expected an install plan');
    const secret = 'TOP_SECRET_OUTPUT=do-not-leak';
    const executor: InstallExecutor = vi.fn(async () => {
      throw { code: spawnCode, stdout: secret, stderr: secret, env: { SECRET: secret } };
    });

    const error = await executeInstallPlan(plan, issuer.issue(plan), issuer, executor)
      .then(() => undefined)
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error).not.toHaveProperty('stdout');
    expect(error).not.toHaveProperty('stderr');
    expect(error).not.toHaveProperty('env');
  });

  it('passes a shell-disabled bounded streaming executor and rejects non-zero exits safely', async () => {
    const issuer = new ConfirmationTokenIssuer();
    const plan = createInstallPlan({ dependency: 'node', mode: 'automatic' }, '22.12.0');
    if (plan === null) throw new Error('expected an install plan');
    const token = issuer.issue(plan);
    const progress = vi.fn();
    const executor: InstallExecutor = vi.fn(async (_executable, _args, options) => {
      expect(options).toMatchObject({ shell: false, windowsHide: true, reject: false });
      expect(options).not.toHaveProperty('env');
      for (let index = 0; index < 150; index += 1) {
        options.onProgress?.({ stream: 'stdout', text: `chunk-${index}` });
      }
      return { exitCode: 7 };
    });

    await expect(
      executeInstallPlan(plan, token, issuer, executor, { onProgress: progress }),
    ).rejects.toBeInstanceOf(InstallExecutionError);
    await expect(
      executeInstallPlan(plan, token, issuer, executor, { onProgress: progress }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_INVALID' });
    expect(executor).toHaveBeenCalledWith('winget', plan.args, expect.any(Object));
    expect(progress).toHaveBeenCalledTimes(100);
  });
});
