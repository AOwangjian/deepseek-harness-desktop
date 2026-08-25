import { describe, expect, it } from 'vitest';

import { APP_NAME } from '../../src/shared/contracts';

describe('application contracts', () => {
  it('defines the desktop application name', () => {
    expect(APP_NAME).toBe('DeepSeek Harness Desktop');
  });
});
