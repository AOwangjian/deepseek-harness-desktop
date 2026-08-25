import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  APP_NAME,
  installRequestSchema,
  settingsSchema,
} from '../../src/shared/contracts';
import type {
  DependencyName,
  DependencySnapshot,
  DiagnosticSummary,
  HarnessRuntime,
  RuntimeDependencyName,
  ServiceStatus,
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
    expect(
      installRequestSchema.safeParse({ dependency: 'npm', mode: 'automatic' })
        .success,
    ).toBe(false);
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

  it('keeps install and runtime status names exact', () => {
    expectTypeOf<DependencyName>().toEqualTypeOf<'node' | 'dsh'>();
    expectTypeOf<ServiceStatus>().toEqualTypeOf<HarnessRuntime['status']>();
  });

  it('models an aggregate dependency snapshot with typed runtime dependencies', () => {
    const snapshot = {
      node: { name: 'node', present: true, version: '22.0.0' },
      npm: { name: 'npm', present: true, version: '11.0.0' },
      dsh: { name: 'dsh', present: false, error: 'not installed' },
      ready: false,
    } satisfies DependencySnapshot;

    expectTypeOf<RuntimeDependencyName>().toEqualTypeOf<'node' | 'npm' | 'dsh'>();
    expectTypeOf(snapshot.node.name).toEqualTypeOf<'node'>();
    expectTypeOf(snapshot.npm.name).toEqualTypeOf<'npm'>();
    expectTypeOf(snapshot.dsh.name).toEqualTypeOf<'dsh'>();
    expect(snapshot.ready).toBe(false);
  });

  it('requires all connection fields for a running harness', () => {
    const running = {
      status: 'running',
      pid: 42,
      port: 4310,
      url: 'http://127.0.0.1:4310',
    } satisfies HarnessRuntime;

    expectTypeOf(running).toMatchTypeOf<HarnessRuntime>();

    // @ts-expect-error A running harness must identify its process, port, and loopback URL.
    const incompleteRunning: HarnessRuntime = {
      status: 'running',
      port: 4310,
    };
    expect(incompleteRunning).toBeDefined();
  });

  it('keeps runtime fields and aggregate snapshots readonly', () => {
    const running: HarnessRuntime = {
      status: 'running',
      pid: 42,
      port: 4310,
      url: 'http://127.0.0.1:4310',
    };
    const snapshot: DependencySnapshot = {
      node: { name: 'node', present: true },
      npm: { name: 'npm', present: true },
      dsh: { name: 'dsh', present: true, version: '1.0.0' },
      ready: true,
    };
    const summary = {
      generatedAt: '2026-08-25T00:00:00.000Z',
      dependencies: snapshot,
      runtime: running,
      recentLogs: [],
    } satisfies DiagnosticSummary;

    if (false) {
      // @ts-expect-error Runtime process identity is readonly.
      running.pid = 99;
      // @ts-expect-error Snapshot readiness is readonly.
      snapshot.ready = false;
    }
    expect(running.status).toBe('running');
    expect(snapshot.ready).toBe(true);
    expectTypeOf(summary.dependencies).toEqualTypeOf<DependencySnapshot>();
  });

  it('rejects non-loopback running URLs at compile time', () => {
    const remoteRunning: HarnessRuntime = {
      status: 'running',
      pid: 42,
      port: 4310,
      // @ts-expect-error Harness URLs must use the local loopback address.
      url: 'https://example.com',
    };
    expect(remoteRunning).toBeDefined();
  });
});
