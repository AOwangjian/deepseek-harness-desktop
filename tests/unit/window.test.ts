import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHarnessViewOptions,
  createWindowOptions,
  harnessViewBounds,
  loadRenderer,
  resolveRendererTarget,
} from '../../src/main/window';

describe('window configuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('places the Harness view below the 36px desktop status bar', () => {
    expect(harnessViewBounds({ width: 1280, height: 820 })).toEqual({
      x: 0,
      y: 36,
      width: 1280,
      height: 784,
    });
    expect(createHarnessViewOptions().webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });

  it('uses the hardened BrowserWindow options and configured preload path', () => {
    const options = createWindowOptions('C:/app/out/preload/index.js');

    expect(options.width).toBe(1280);
    expect(options.height).toBe(820);
    expect(options.autoHideMenuBar).toBe(true);
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      preload: 'C:/app/out/preload/index.js',
      sandbox: true,
    });
  });

  it('allows only loopback development URLs when unpackaged', () => {
    const target = resolveRendererTarget({
      isPackaged: false,
      rendererUrl: 'http://localhost:5173',
      rendererPath: 'C:/app/out/renderer/index.html',
    });

    expect(target).toEqual({ kind: 'url', value: 'http://localhost:5173' });
  });

  it('falls back to the local renderer file for an untrusted development URL', () => {
    const target = resolveRendererTarget({
      isPackaged: false,
      rendererUrl: 'https://example.com/renderer',
      rendererPath: 'C:/app/out/renderer/index.html',
    });

    expect(target).toEqual({
      kind: 'file',
      value: 'C:/app/out/renderer/index.html',
    });
  });

  it('ignores the development URL when the app is packaged', () => {
    const target = resolveRendererTarget({
      isPackaged: true,
      rendererUrl: 'http://localhost:5173',
      rendererPath: 'C:/app/out/renderer/index.html',
    });

    expect(target).toEqual({
      kind: 'file',
      value: 'C:/app/out/renderer/index.html',
    });
  });

  it('captures renderer loading failures with target context', async () => {
    const loadURL = vi.fn().mockRejectedValue(new Error('renderer unavailable'));
    const loadFile = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await loadRenderer(
      { kind: 'url', value: 'http://localhost:5173' },
      { loadURL, loadFile },
    );

    expect(error).toHaveBeenCalledWith(
      'Failed to load renderer.',
      expect.objectContaining({
        target: { kind: 'url', value: 'http://localhost:5173' },
      }),
    );
  });
});
