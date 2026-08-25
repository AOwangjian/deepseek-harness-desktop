/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DependencyWizard } from '../../../src/renderer/components/DependencyWizard';
import { mockDesktop, setupSnapshot } from './test-desktop';

afterEach(() => {
  cleanup();
});

describe('DependencyWizard', () => {
  it('shows automatic, manual, and later choices when dependencies are missing', () => {
    mockDesktop(setupSnapshot());
    render(<DependencyWizard snapshot={setupSnapshot()} />);

    expect(screen.getByRole('button', { name: 'Automatic install' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manual install' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Later' })).toBeTruthy();
  });

  it('displays source, version, and command summary before confirmation', async () => {
    const snapshot = setupSnapshot({
      installPlan: {
        executable: 'npm',
        args: ['install', '--global', '@deepseek-ai/dsh@1.2.3'],
        source: 'npmjs.org',
        version: '1.2.3',
      },
      confirmationToken: 'token-1',
    });
    const api = mockDesktop(snapshot);
    render(<DependencyWizard snapshot={snapshot} />);

    expect(screen.getByText('Source: npmjs.org')).toBeTruthy();
    expect(screen.getByText('Version: 1.2.3')).toBeTruthy();
    expect(
      screen.getByText('npm install --global @deepseek-ai/dsh@1.2.3'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm install' }));
    expect(api.confirmInstall).toHaveBeenCalledExactlyOnceWith('token-1');
  });

  it('shows official links and a recheck button for manual setup', async () => {
    const snapshot = setupSnapshot();
    const api = mockDesktop(snapshot);
    render(<DependencyWizard snapshot={snapshot} />);

    expect(screen.getByRole('link', { name: 'Node.js download' }).getAttribute('href')).toBe(
      'https://nodejs.org/en/download',
    );
    expect(screen.getByRole('link', { name: '@deepseek-ai/dsh on npm' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recheck' }));
    expect(api.getState).toHaveBeenCalled();
  });
});
