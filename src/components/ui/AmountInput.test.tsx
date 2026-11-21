import { describe, it, expect } from 'vitest';
import { truncateStellarAmount } from '../../lib/format';

describe('truncateStellarAmount', () => {
  it('truncates values beyond 7 decimal places', () => {
    expect(truncateStellarAmount('1.12345678')).toBe('1.1234567');
  });

  it('preserves the smallest representable stroop', () => {
    expect(truncateStellarAmount('0.00000001')).toBe('0.0000000');
  });

  it('preserves a trailing decimal point while typing', () => {
    expect(truncateStellarAmount('1.')).toBe('1.');
  });

  it('leaves integer values untouched', () => {
    expect(truncateStellarAmount('42')).toBe('42');
  });
});
