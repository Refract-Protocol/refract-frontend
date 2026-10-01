import { z } from "zod";

export interface CoverageValidationBounds {
  effectiveMin: number;
  effectiveMax: number;
  isFlightDelay: boolean;
}

export interface BuyCoverageInput {
  coverageAmount: string | number;
  flightNumber?: string;
}

export interface CoverageValidationResult {
  isValid: boolean;
  errors: {
    coverageAmount?: string;
    flightNumber?: string;
  };
}

/**
 * Creates a dynamic Zod schema for validating buy-coverage form inputs against chain bounds.
 */
export function createBuyCoverageSchema(bounds: CoverageValidationBounds) {
  return z
    .object({
      coverageAmount: z
        .union([z.string(), z.number()])
        .transform((val) => (typeof val === "string" ? parseFloat(val) || 0 : val))
        .refine(
          (amount) => amount >= bounds.effectiveMin && amount <= bounds.effectiveMax,
          {
            message: `Enter an amount between $${bounds.effectiveMin.toLocaleString()} and $${bounds.effectiveMax.toLocaleString()}`,
          }
        ),
      flightNumber: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (bounds.isFlightDelay) {
        if (!data.flightNumber || data.flightNumber.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Enter the flight number this policy should monitor",
            path: ["flightNumber"],
          });
        }
      }
    });
}

/**
 * Validates buy-coverage inputs and returns structured field errors and validity flag.
 */
export function validateBuyCoverage(
  input: BuyCoverageInput,
  bounds: CoverageValidationBounds
): CoverageValidationResult {
  const schema = createBuyCoverageSchema(bounds);
  const result = schema.safeParse(input);

  if (result.success) {
    return { isValid: true, errors: {} };
  }

  const errors: CoverageValidationResult["errors"] = {};
  for (const issue of result.error.issues) {
    if (issue.path[0] === "coverageAmount") {
      errors.coverageAmount = issue.message;
    } else if (issue.path[0] === "flightNumber") {
      errors.flightNumber = issue.message;
    }
  }

  return { isValid: false, errors };
}
