/**
 * Refract only runs on Stellar testnet right now (see refract-backend's
 * .env.example — STELLAR_NETWORK defaults to testnet, and mainnet keys are
 * explicitly disallowed there). Hardcoded to the testnet explorer until
 * there's a mainnet deploy and the network becomes configurable here too.
 */
export function stellarExpertTxUrl(txHash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}
