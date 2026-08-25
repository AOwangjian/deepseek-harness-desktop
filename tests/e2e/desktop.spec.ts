import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, _electron as electron } from '@playwright/test';

const fixturePath = path.join(
  process.cwd(),
  'tests/integration/fixtures/fake-harness.mjs',
);

test('dependency-ready path reaches the thin desktop shell', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'dsh-desktop-e2e-'));
  const app = await electron.launch({
    cwd: process.cwd(),
    args: [process.cwd()],
    env: {
      ...process.env,
      DSH_DESKTOP_USER_DATA: userData,
      DSH_DESKTOP_FAKE_HARNESS: fixturePath,
    },
  });

  try {
    const window = await app.firstWindow();
    await expect(window.getByText(/Harness running on port/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(window.locator('.desktop-status-bar')).toBeVisible();
    await expect(window.getByRole('button', { name: 'Restart' })).toBeVisible();

    await window.close();
    const visibleWindows = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((browserWindow) => browserWindow.isVisible()),
    );
    expect(visibleWindows).toBe(false);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
