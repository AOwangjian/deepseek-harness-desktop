import { describe, expect, it, vi } from 'vitest';

import {
  handleWindowClose,
  TrayController,
  type TrayMenu,
  type TrayMenuItem,
} from '../../src/main/tray-controller';

describe('TrayController', () => {
  it('exposes open, start, stop, restart, logs, settings, and quit commands', () => {
    const callbacks = {
      openWindow: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      showLogs: vi.fn(),
      openSettings: vi.fn(),
      quit: vi.fn(),
    };
    let menu: TrayMenu | undefined;
    const tray = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn((next: TrayMenu) => {
        menu = next;
      }),
    };
    const menuBuilder = {
      buildFromTemplate: (items: readonly TrayMenuItem[]) => ({ items }),
    };

    new TrayController(tray, menuBuilder, callbacks, 'DeepSeek Harness Desktop');

    expect(tray.setToolTip).toHaveBeenCalledExactlyOnceWith(
      'DeepSeek Harness Desktop',
    );
    const labels = (menu?.items ?? [])
      .map((item) => item.label)
      .filter((label): label is string => label !== undefined);
    expect(labels).toEqual([
      'Open',
      'Start',
      'Stop',
      'Restart',
      'Logs',
      'Settings',
      'Quit',
    ]);

    for (const item of menu?.items ?? []) {
      item.click?.();
    }
    expect(callbacks.openWindow).toHaveBeenCalledOnce();
    expect(callbacks.start).toHaveBeenCalledOnce();
    expect(callbacks.stop).toHaveBeenCalledOnce();
    expect(callbacks.restart).toHaveBeenCalledOnce();
    expect(callbacks.showLogs).toHaveBeenCalledOnce();
    expect(callbacks.openSettings).toHaveBeenCalledOnce();
    expect(callbacks.quit).toHaveBeenCalledOnce();
  });

  it('hides the window on close only when closeToTray is true', () => {
    const event = { preventDefault: vi.fn() };
    const window = { hide: vi.fn() };

    expect(handleWindowClose(event, window, true)).toBe('hidden');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();

    const ignored = { preventDefault: vi.fn() };
    expect(handleWindowClose(ignored, window, false)).toBe('closed');
    expect(ignored.preventDefault).not.toHaveBeenCalled();
  });
});
