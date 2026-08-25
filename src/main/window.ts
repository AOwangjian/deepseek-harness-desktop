import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  WebContentsViewConstructorOptions,
} from 'electron';

import { DESKTOP_STATUS_BAR_HEIGHT } from '../shared/contracts';

export type RendererTarget =
  | { kind: 'url'; value: string }
  | { kind: 'file'; value: string };

export type RendererWindow = Pick<BrowserWindow, 'loadFile' | 'loadURL'>;

export interface RendererTargetOptions {
  isPackaged: boolean;
  rendererPath: string;
  rendererUrl: string | undefined;
}

export function createWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 820,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
    },
  };
}

export function createHarnessViewOptions(): WebContentsViewConstructorOptions {
  return {
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

export function harnessViewBounds(contentBounds: {
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } {
  return {
    x: 0,
    y: DESKTOP_STATUS_BAR_HEIGHT,
    width: Math.max(0, contentBounds.width),
    height: Math.max(0, contentBounds.height - DESKTOP_STATUS_BAR_HEIGHT),
  };
}

export function resolveRendererTarget(
  options: RendererTargetOptions,
): RendererTarget {
  if (!options.isPackaged && options.rendererUrl && isLoopbackDevUrl(options.rendererUrl)) {
    return { kind: 'url', value: options.rendererUrl };
  }

  return { kind: 'file', value: options.rendererPath };
}

export async function loadRenderer(
  target: RendererTarget,
  window: RendererWindow,
): Promise<void> {
  try {
    if (target.kind === 'url') {
      await window.loadURL(target.value);
    } else {
      await window.loadFile(target.value);
    }
  } catch (cause) {
    console.error('Failed to load renderer.', { target, cause });
  }
}

function isLoopbackDevUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

    return (
      url.protocol === 'http:' &&
      loopbackHosts.has(url.hostname) &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}
