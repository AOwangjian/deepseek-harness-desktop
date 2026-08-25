import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DESKTOP_USER_DATA_DIR_NAME,
  resolveDesktopUserDataPath,
} from '../../src/main/single-instance';

describe('single instance userData', () => {
  it('uses a stable per-user directory so portable and installed copies share one lock', () => {
    expect(
      resolveDesktopUserDataPath({
        appData: 'C:\\Users\\mark\\AppData\\Roaming',
      }),
    ).toBe(
      path.join('C:\\Users\\mark\\AppData\\Roaming', DESKTOP_USER_DATA_DIR_NAME),
    );
  });

  it('lets isolated tests override userData', () => {
    expect(
      resolveDesktopUserDataPath({
        appData: 'C:\\Users\\mark\\AppData\\Roaming',
        override: 'D:\\tmp\\e2e-user-data',
      }),
    ).toBe('D:\\tmp\\e2e-user-data');
  });
});
