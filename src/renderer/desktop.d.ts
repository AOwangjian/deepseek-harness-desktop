import type { DesktopPreloadApi } from '../preload/index';

declare global {
  interface Window {
    desktop: DesktopPreloadApi;
  }
}

export {};
