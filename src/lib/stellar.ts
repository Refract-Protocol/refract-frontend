/**
 * Refract only runs on Stellar testnet right now (see refract-backend's
 * .env.example — STELLAR_NETWORK defaults to testnet, and mainnet keys are
 * explicitly disallowed there). Hardcoded to the testnet explorer until
 * there's a mainnet deploy and the network becomes configurable here too.
 *
 * Validation contract: Stellar transaction hashes are 64-character hex
 * strings. `isValidTxHash` accepts them case-insensitively (uppercase hex is
 * normalised rather than rejected) and rejects anything else, including the
 * placeholder hashes carried by fixture claim records. `stellarExpertTxUrl`
 * returns `null` for invalid hashes so callers never render a real-looking
 * explorer link that leads to a dead page.
 */
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/i;

export function isValidTxHash(hash: string | null | undefined): hash is string {
  return typeof hash === 'string' && TX_HASH_PATTERN.test(hash);
}

export function stellarExpertTxUrl(txHash: string): string | null {
  if (!isValidTxHash(txHash)) {
    return null;
  }

  return `https://stellar.expert/explorer/testnet/tx/${txHash.toLowerCase()}`;
}
