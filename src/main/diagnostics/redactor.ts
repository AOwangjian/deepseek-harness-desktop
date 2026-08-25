const REDACTED = '[REDACTED]';

const PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-or-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-proj-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._\-+/=]+\b/gi,
  /\bAuthorization\s*[:=]\s*[^\s,;]+/gi,
  /("(?:access_token|refresh_token|id_token|api_key|apiKey|token|secret|password)"\s*:\s*")[^"]*(")/gi,
  /\b(?:API_KEY|OPENAI_API_KEY|DEEPSEEK_API_KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)\s*=\s*\S+/gi,
];

export function redactSecrets(value: string): string {
  let redacted = value;
  for (const pattern of PATTERNS) {
    redacted = redacted.replace(pattern, (match, prefix?: string, suffix?: string) => {
      if (typeof prefix === 'string' && typeof suffix === 'string') {
        return `${prefix}${REDACTED}${suffix}`;
      }
      if (/^(Authorization\s*[:=]\s*)/i.test(match)) {
        return match.replace(/:\s*.*$/i, `: ${REDACTED}`).replace(/=\s*.*$/i, `= ${REDACTED}`);
      }
      if (/=\s*\S+$/.test(match)) {
        return match.replace(/=\s*\S+$/, `= ${REDACTED}`);
      }
      if (/^Bearer\s+/i.test(match)) {
        return `Bearer ${REDACTED}`;
      }
      return REDACTED;
    });
  }
  return redacted;
}

export function containsConversationBody(value: string): boolean {
  return (
    /"messages"\s*:/i.test(value) ||
    /"conversationId"\s*:/i.test(value) ||
    /chat completions payload/i.test(value)
  );
}

export function looksLikeEnvironmentDump(value: string): boolean {
  return (
    /"USERPROFILE"\s*:/i.test(value) ||
    /"APPDATA"\s*:/i.test(value) ||
    /"PATH"\s*:\s*"/i.test(value) ||
    (/(?:^|\n)PATH=/i.test(value) && (value.match(/=/g)?.length ?? 0) > 8)
  );
}
