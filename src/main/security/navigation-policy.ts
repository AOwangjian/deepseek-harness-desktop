export const HARNESS_LOOPBACK_HOST = '127.0.0.1';

export type NavigationDecision =
  | { readonly action: 'allow' }
  | { readonly action: 'deny' }
  | { readonly action: 'open-external'; readonly url: string };

export interface PolicyWebContents {
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'allow' } | { action: 'deny' },
  ): void;
  on(event: 'will-navigate', listener: (event: { preventDefault: () => void }, url: string) => void): unknown;
  session: {
    setPermissionRequestHandler(
      handler: (
        webContents: unknown,
        permission: string,
        callback: (permissionGranted: boolean) => void,
      ) => void,
    ): void;
  };
}

export function isExactHarnessOrigin(url: string, port: number): boolean {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'http:' &&
      parsed.hostname === HARNESS_LOOPBACK_HOST &&
      parsed.port === String(port) &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}

export function isSafeExternalHttps(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname !== '' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hostname !== HARNESS_LOOPBACK_HOST &&
      parsed.hostname !== 'localhost'
    );
  } catch {
    return false;
  }
}

export function decideEmbeddedNavigation(url: string, port: number | null): NavigationDecision {
  if (port === null) return { action: 'deny' };
  return isExactHarnessOrigin(url, port) ? { action: 'allow' } : { action: 'deny' };
}

export function decideWindowOpen(url: string, port: number | null): NavigationDecision {
  if (port !== null && isExactHarnessOrigin(url, port)) return { action: 'deny' };
  if (isSafeExternalHttps(url)) return { action: 'open-external', url };
  return { action: 'deny' };
}

export function applyHarnessNavigationPolicy(
  webContents: PolicyWebContents,
  getPort: () => number | null,
  openExternal: (url: string) => Promise<void>,
): void {
  webContents.setWindowOpenHandler((details) => {
    const decision = decideWindowOpen(details.url, getPort());
    if (decision.action === 'open-external') {
      void openExternal(decision.url);
    }
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (decideEmbeddedNavigation(url, getPort()).action !== 'allow') {
      event.preventDefault();
    }
  });

  webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
}
