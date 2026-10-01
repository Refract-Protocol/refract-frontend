import { z } from "zod";
import { formatUsd } from "../format";

export interface PoolValidationBounds {
  tab: "deposit" | "withdraw";
  availableToWithdraw: number;
  isLocked: boolean;
  isConnected: boolean;
}

export interface PoolValidationResult {
  isValid: boolean;
  amountError?: string;
  isLockedError?: boolean;
}

/**
 * Creates dynamic Zod schema for deposit/withdraw amount validation.
 */
export function createPoolActionSchema(bounds: PoolValidationBounds) {
  return z
    .object({
      amount: z
        .union([z.string(), z.number()])
        .transform((val) => (typeof val === "string" ? parseFloat(val) || 0 : val))
        .refine((val) => val > 0, {
          message: "Enter an amount greater than 0",
        }),
    })
    .superRefine((data, ctx) => {
      if (bounds.tab === "withdraw" && bounds.isConnected) {
        if (bounds.isLocked) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Withdrawals are currently locked",
            path: ["amount"],
          });
        } else if (data.amount > bounds.availableToWithdraw) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `You only have ${formatUsd(bounds.availableToWithdraw)} available to withdraw`,
            path: ["amount"],
          });
        }
      }
    });
}

/**
 * Validates deposit/withdraw amount against pool limits and returns formatted error.
 */
export function validatePoolAction(
  amount: string | number,
  bounds: PoolValidationBounds
): PoolValidationResult {
  const schema = createPoolActionSchema(bounds);
  const result = schema.safeParse({ amount });

  if (result.success) {
    return { isValid: true };
  }

  const issue = result.error.issues[0];
  return {
    isValid: false,
    amountError: issue ? issue.message : "Invalid amount",
    isLockedError: bounds.isLocked && bounds.tab === "withdraw",
  };
}
