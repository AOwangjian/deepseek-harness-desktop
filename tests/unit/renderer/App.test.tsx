/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../../src/renderer/App';
import { mockDesktop, readyDependencies, setupSnapshot } from './test-desktop';

afterEach(() => {
  cleanup();
});

describe('App shell', () => {
  it('routes missing dependencies to the setup wizard', async () => {
    mockDesktop(setupSnapshot());
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Automatic install' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manual install' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Later' })).toBeTruthy();
  });

  it('renders only the 36-pixel status bar while Harness is running', async () => {
    mockDesktop(
      setupSnapshot({
        surface: 'running',
        runtime: {
          status: 'running',
          pid: 4321,
          port: 18765,
          url: 'http://127.0.0.1:18765',
        },
        dependencies: readyDependencies,
      }),
    );
    render(<App />);

    const status = await screen.findByText('Harness running on port 18765');
    expect(status.closest('.desktop-status-bar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Automatic install' })).toBeNull();
    expect(screen.queryByText('Set up DeepSeek Harness')).toBeNull();
    expect(document.querySelector('.desktop-status-bar')).toHaveProperty(
      'className',
      expect.stringContaining('desktop-status-bar'),
    );
  });

  it('shows sanitized logs with retry and copy actions when startup fails', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mockDesktop(
      setupSnapshot({
        surface: 'diagnostics',
        runtime: { status: 'failed', error: 'Harness startup timed out.' },
        logs: ['READY', 'token=should-already-be-redacted'],
        error: 'Harness startup timed out.',
      }),
    );
    render(<App />);

    expect(await screen.findByText('Harness startup timed out.')).toBeTruthy();
    expect(screen.getByText(/token=should-already-be-redacted/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    expect(writeText).toHaveBeenCalled();
  });

  it('opens logs and settings from the running status bar', async () => {
    const running = setupSnapshot({
      surface: 'running',
      runtime: {
        status: 'running',
        pid: 4321,
        port: 18765,
        url: 'http://127.0.0.1:18765',
      },
      dependencies: readyDependencies,
    });
    const api = mockDesktop(running);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Logs' }));
    expect(api.setPanel).toHaveBeenCalledWith('logs');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(api.setPanel).toHaveBeenCalledWith('settings');
  });

  it('shows the logs panel over the running shell', async () => {
    mockDesktop(
      setupSnapshot({
        surface: 'running',
        panel: 'logs',
        runtime: {
          status: 'running',
          pid: 4321,
          port: 18765,
          url: 'http://127.0.0.1:18765',
        },
        dependencies: readyDependencies,
        logs: ['READY'],
      }),
    );
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Logs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('announces status changes politely', async () => {
    mockDesktop(
      setupSnapshot({
        surface: 'starting',
        runtime: { status: 'starting', port: 18765 },
      }),
    );
    render(<App />);
    expect((await screen.findByText('Starting Harness…')).getAttribute('aria-live')).toBe(
      'polite',
    );
  });
});
