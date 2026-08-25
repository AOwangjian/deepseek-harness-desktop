import { describe, expect, it } from 'vitest';

import {
  APP_NAME,
  installRequestSchema,
  settingsSchema,
} from '../../src/shared/contracts';

describe('IPC contracts', () => {
  it('rejects arbitrary install packages', () => {
    expect(
      installRequestSchema.safeParse({
        dependency: 'evil-package',
        mode: 'automatic',
      }).success,
    ).toBe(false);
  });

  it('accepts explicit user settings', () => {
    expect(
      settingsSchema.parse({
        closeToTray: true,
        autoStart: false,
        updatePolicy: 'notify',
      }),
    ).toEqual({
      closeToTray: true,
      autoStart: false,
      updatePolicy: 'notify',
    });
  });

  it('accepts supported install requests', () => {
    expect(
      installRequestSchema.parse({ dependency: 'node', mode: 'manual' }),
    ).toEqual({ dependency: 'node', mode: 'manual' });
  });

  it('rejects unknown install request fields', () => {
    expect(
      installRequestSchema.safeParse({
        dependency: 'dsh',
        mode: 'later',
        package: '@deepseek-ai/dsh',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid settings values and fields', () => {
    expect(
      settingsSchema.safeParse({
        closeToTray: true,
        autoStart: false,
        updatePolicy: 'automatic',
      }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({
        closeToTray: true,
        autoStart: false,
        updatePolicy: 'manual',
        theme: 'dark',
      }).success,
    ).toBe(false);
  });

  it('preserves the application name contract', () => {
    expect(APP_NAME).toBe('DeepSeek Harness Desktop');
  });
});
