import { StrKey } from '@stellar/stellar-sdk';

/**
 * Returns true when `value` is a well-formed Stellar public key (StrKey).
 *
 * This performs a full StrKey decode: base32 decoding plus CRC16 checksum
 * verification, so a typo'd address with a valid-looking prefix is rejected.
 */
export function isValidStellarAddress(value: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }

  try {
    return StrKey.isValidEd25519PublicKey(trimmed);
  } catch {
    return false;
  }
}
