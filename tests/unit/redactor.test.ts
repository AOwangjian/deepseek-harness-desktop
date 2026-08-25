import { describe, expect, it } from 'vitest';

import { DiagnosticService } from '../../src/main/diagnostics/diagnostic-service';
import { redactSecrets } from '../../src/main/diagnostics/redactor';

describe('redactor', () => {
  it('redacts DeepSeek/OpenAI-style keys, bearer tokens, headers, JSON fields, and env assignments', () => {
    const sample = [
      'OPENAI_API_KEY=sk-abc123456789',
      'DEEPSEEK_API_KEY=sk-or-1234567890abcdef',
      'Authorization: Bearer tok_live_secret',
      '{"api_key":"super-secret","token":"abc"}',
      'TOKEN=env-secret-value',
    ].join('\n');

    const redacted = redactSecrets(sample);
    expect(redacted).not.toContain('sk-abc123456789');
    expect(redacted).not.toContain('sk-or-1234567890abcdef');
    expect(redacted).not.toContain('tok_live_secret');
    expect(redacted).not.toContain('super-secret');
    expect(redacted).not.toContain('env-secret-value');
    expect(redacted).toContain('[REDACTED]');
  });

  it('excludes conversation bodies and environment dumps from diagnostic reports', () => {
    const service = new DiagnosticService();
    service.append('READY');
    service.append('{"messages":[{"role":"user","content":"secret chat"}]}');
    service.append('OPENAI_API_KEY=sk-abc123456789');
    service.append(JSON.stringify(process.env));

    const report = service.report({
      appVersion: '0.1.0',
      osVersion: 'win32',
      generatedAt: '2026-08-25T01:02:03.000Z',
      dependencies: {
        node: { name: 'node', present: true, version: '22.0.0' },
        npm: { name: 'npm', present: true, version: '11.0.0' },
        dsh: { name: 'dsh', present: true, version: '1.0.0' },
        ready: true,
      },
      runtime: { status: 'failed', error: 'Harness startup timed out.' },
    });

    expect(report.appVersion).toBe('0.1.0');
    expect(report.recentLogs.some((line) => line.includes('READY'))).toBe(true);
    expect(JSON.stringify(report)).not.toContain('secret chat');
    expect(JSON.stringify(report)).not.toContain('sk-abc123456789');
    expect(JSON.stringify(report)).not.toMatch(/process\.env|USERPROFILE|APPDATA/i);
  });
});
