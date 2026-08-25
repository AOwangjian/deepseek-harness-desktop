import { describe, expect, it, vi } from 'vitest';

import {
  ConfirmationTokenIssuer,
  InstallExecutionError,
  createInstallPlan,
  executeInstallPlan,
  type InstallExecutor,
} from '../../src/main/harness/dependency-installer';

describe('dependency installer', () => {
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
