import { describe, expect, it, vi } from 'vitest';

import {
  applyHarnessNavigationPolicy,
  decideEmbeddedNavigation,
  decideWindowOpen,
  isExactHarnessOrigin,
  isSafeExternalHttps,
} from '../../src/main/security/navigation-policy';

const port = 18_765;
const harnessOrigin = `http://127.0.0.1:${port}/`;

describe('navigation policy', () => {
  it('accepts only the exact active loopback Harness origin', () => {
    expect(isExactHarnessOrigin(harnessOrigin, port)).toBe(true);
    expect(isExactHarnessOrigin(`http://127.0.0.1:${port}/sessions`, port)).toBe(true);
    expect(decideEmbeddedNavigation(harnessOrigin, port)).toEqual({ action: 'allow' });
  });

  it('rejects alternate hosts, credentials, file URLs, javascript URLs, and other ports', () => {
    const rejected = [
      'http://localhost:18765/',
      'http://127.0.0.1:18766/',
      'http://user:pass@127.0.0.1:18765/',
      'https://127.0.0.1:18765/',
      'file:///C:/tmp/index.html',
      'javascript:alert(1)',
      'http://[::1]:18765/',
      'http://0.0.0.0:18765/',
    ];

    for (const url of rejected) {
      expect(isExactHarnessOrigin(url, port), url).toBe(false);
      expect(decideEmbeddedNavigation(url, port), url).toEqual({ action: 'deny' });
    }
  });

  it('opens explicit https external links and denies everything else for window open', () => {
    expect(isSafeExternalHttps('https://nodejs.org/download')).toBe(true);
    expect(decideWindowOpen('https://nodejs.org/download', port)).toEqual({
      action: 'open-external',
      url: 'https://nodejs.org/download',
    });
    expect(decideWindowOpen('http://example.com', port)).toEqual({ action: 'deny' });
    expect(decideWindowOpen('file:///C:/secret', port)).toEqual({ action: 'deny' });
    expect(decideWindowOpen(harnessOrigin, port)).toEqual({ action: 'deny' });
  });

  it('denies embedded navigation until a Harness port is active', () => {
    expect(decideEmbeddedNavigation(harnessOrigin, null)).toEqual({ action: 'deny' });
  });

  it('blocks window.open, unknown navigation, and permission requests on a webContents', () => {
    const openExternal = vi.fn(async () => undefined);
    const preventDefault = vi.fn();
    let windowOpenHandler: ((details: { url: string }) => { action: string }) | undefined;
    let navigateHandler:
      | ((event: { preventDefault: () => void }, url: string) => void)
      | undefined;
    let permissionHandler:
      | ((
          webContents: unknown,
          permission: string,
          callback: (permissionGranted: boolean) => void,
        ) => void)
      | undefined;

    applyHarnessNavigationPolicy(
      {
        setWindowOpenHandler: (handler) => {
          windowOpenHandler = handler;
        },
        on: (_event, listener) => {
          navigateHandler = listener;
        },
        session: {
          setPermissionRequestHandler: (handler) => {
            permissionHandler = handler;
          },
        },
      },
      () => port,
      openExternal,
    );

    expect(windowOpenHandler?.({ url: 'https://github.com' })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://github.com');
    expect(windowOpenHandler?.({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });

    navigateHandler?.({ preventDefault }, 'http://evil.example/');
    expect(preventDefault).toHaveBeenCalledOnce();

    const grant = vi.fn();
    permissionHandler?.(undefined, 'clipboard-read', grant);
    expect(grant).toHaveBeenCalledExactlyOnceWith(false);
  });
});
