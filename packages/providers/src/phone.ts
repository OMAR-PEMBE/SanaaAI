export function toSnippePhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  if (digits.startsWith('255') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return null;
}

const PHONE_KEYS = new Set(['phone', 'phone_number', 'phonenumber', 'msisdn']);

export function sanitizeProviderPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeProviderPayload(item));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (lowered.includes('signature') || lowered.includes('secret') || lowered.includes('password')) {
      continue;
    }
    if (PHONE_KEYS.has(lowered) && typeof child === 'string') {
      output[key] = child.length <= 2 ? '••' : `••${child.slice(-2)}`;
      continue;
    }
    output[key] = sanitizeProviderPayload(child);
  }
  return output;
}
