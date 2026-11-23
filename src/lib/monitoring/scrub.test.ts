import { describe, it, expect } from 'vitest';
import { scrubEvent } from './scrub';

describe('scrubEvent', () => {
  it('returns the event when an expected field is missing', () => {
    const event = {
      message: 'something happened',
      // request is intentionally absent
    } as unknown as Parameters<typeof scrubEvent>[0];

    const result = scrubEvent(event);

    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    expect(result?.message).toBe('something happened');
  });

  it('does not throw when nested fields are missing', () => {
    const event = {
      request: {},
      user: {},
      extra: {},
    } as unknown as Parameters<typeof scrubEvent>[0];

    expect(() => scrubEvent(event)).not.toThrow();
  });

  it('scrubs sensitive values when present', () => {
    const event = {
      request: {
        headers: { authorization: 'Bearer secret-token' },
      },
      user: { email: 'person@example.com' },
    } as unknown as Parameters<typeof scrubEvent>[0];

    const result = scrubEvent(event);

    expect(result).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(JSON.stringify(result)).not.toContain('person@example.com');
  });
});
