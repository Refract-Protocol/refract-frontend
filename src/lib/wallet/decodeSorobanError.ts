/**
 * Turns raw Soroban/RPC failure strings into user-facing explanations.
 *
 * Source of truth: the `PoolError` enum in
 * refract-contracts/pool/src/lib.rs (every buy/provide/withdraw transaction
 * invokes the pool contract, so `Error(Contract, #N)` codes are pool codes).
 * When a variant is added or renumbered there, update POOL_ERRORS below to
 * match — the numeric keys must equal the enum's `#[repr(u32)]` values.
 */

export interface DecodedSorobanError {
  title: string;
  explanation: string;
}

const POOL_ERRORS: Record<number, DecodedSorobanError> = {
  1: { title: "Pool already initialized", explanation: "The pool contract rejected a duplicate setup call. Contact support if this keeps happening." },
  2: { title: "Pool not initialized", explanation: "The pool contract isn't set up on this network yet. Try again later or check you're on the right network." },
  3: { title: "Not authorized", explanation: "The connected wallet isn't allowed to perform this action. Make sure you're signing with the right account." },
  4: { title: "Pool capacity exceeded", explanation: "The coverage amount exceeds the pool's current maximum. Lower the amount or try again after more capital is provided." },
  5: { title: "Policy not found", explanation: "The pool has no record of this policy. It may have been created on a different network." },
  6: { title: "Policy expired", explanation: "This policy has already expired, so the action is no longer available." },
  7: { title: "Policy not triggered", explanation: "This policy's trigger condition hasn't fired, so there's nothing to claim yet." },
  8: { title: "Not the policyholder", explanation: "Only the wallet that bought this policy can perform this action." },
  9: { title: "Already claimed", explanation: "This policy's payout has already been claimed." },
  10: { title: "Premium too low", explanation: "The premium doesn't meet the pool's minimum, or your wallet doesn't hold enough USDC to pay it. Top up USDC or increase the coverage amount." },
  11: { title: "Amount is zero", explanation: "Enter an amount greater than zero." },
  12: { title: "Not enough pool shares", explanation: "You're trying to withdraw more than your position holds. Lower the withdrawal amount." },
  13: { title: "Capital locked", explanation: "Withdrawals are paused while a claim event is being settled. Try again once it resolves." },
  14: { title: "Policy still active", explanation: "This action is only available after the policy expires." },
  15: { title: "Deposit still locked", explanation: "Your deposit is within its lockup period. Withdrawals unlock once the lockup has passed." },
};

const TEXT_PATTERNS: Array<{ pattern: RegExp; decoded: DecodedSorobanError }> = [
  {
    pattern: /declined|rejected by user|user rejected/i,
    decoded: { title: "Signature declined", explanation: "The transaction was cancelled in your wallet. Nothing was submitted." },
  },
  {
    pattern: /insufficient balance|underfunded|balance is not sufficient/i,
    decoded: { title: "Insufficient balance", explanation: "Your wallet doesn't hold enough funds (USDC or XLM for fees) to complete this transaction." },
  },
  {
    pattern: /txBadSeq|bad seq/i,
    decoded: { title: "Out-of-date transaction", explanation: "Your account's sequence number changed before this was submitted. Try again." },
  },
  {
    pattern: /txTooLate|expired|timed? ?out|did not confirm/i,
    decoded: { title: "Transaction not confirmed", explanation: "The network didn't confirm the transaction in time. Check your wallet history before retrying." },
  },
];

const FALLBACK: DecodedSorobanError = {
  title: "Transaction failed",
  explanation: "We couldn't complete this transaction. See the technical details below, and contact support if it persists.",
};

export function decodeSorobanError(rawError: string): DecodedSorobanError {
  const contractCode = rawError.match(/Error\(\s*Contract\s*,\s*#(\d+)\s*\)/i);
  if (contractCode) {
    return POOL_ERRORS[Number(contractCode[1])] ?? FALLBACK;
  }
  return TEXT_PATTERNS.find(({ pattern }) => pattern.test(rawError))?.decoded ?? FALLBACK;
}
