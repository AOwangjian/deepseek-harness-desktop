import { describe, expect, it, vi } from 'vitest';

import {
  UpdateConfirmationError,
  UpdateService,
} from '../../src/main/updates/update-service';

describe('UpdateService', () => {
  it('produces separate desktop and Harness update prompts', async () => {
    const service = new UpdateService({
      currentDesktopVersion: '0.1.0',
      currentHarnessVersion: '1.0.0',
      checkDesktop: async () => ({
        currentVersion: '0.1.0',
        availableVersion: '0.2.0',
      }),
      checkHarness: async () => '1.1.0',
    });

    await expect(service.checkDesktop()).resolves.toEqual({
      target: 'desktop',
      currentVersion: '0.1.0',
      availableVersion: '0.2.0',
      source: 'GitHub Releases',
    });
    await expect(service.checkHarness()).resolves.toEqual({
      target: 'dsh',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      source: 'npmjs.org',
    });
  });

  it('never installs without a confirmation token bound to the displayed version', async () => {
    const installDesktop = vi.fn(async () => undefined);
    const installHarness = vi.fn(async () => undefined);
    const service = new UpdateService({
      currentDesktopVersion: '0.1.0',
      currentHarnessVersion: '1.0.0',
      checkDesktop: async () => ({
        currentVersion: '0.1.0',
        availableVersion: '0.2.0',
      }),
      checkHarness: async () => '1.1.0',
      installDesktop,
      installHarness,
    });
    const desktop = await service.checkDesktop();
    const harness = await service.checkHarness();
    if (desktop === null || harness === null) {
      throw new Error('expected update offers');
    }

    await expect(service.install(desktop, 'nope')).rejects.toBeInstanceOf(
      UpdateConfirmationError,
    );
    expect(installDesktop).not.toHaveBeenCalled();

    const token = service.issueConfirmation(desktop);
    await expect(
      service.install({ ...desktop, availableVersion: '9.9.9' }, token),
    ).rejects.toBeInstanceOf(UpdateConfirmationError);

    const valid = service.issueConfirmation(harness);
    await service.install(harness, valid);
    expect(installHarness).toHaveBeenCalledExactlyOnceWith('1.1.0');
    expect(installDesktop).not.toHaveBeenCalled();
  });
});
