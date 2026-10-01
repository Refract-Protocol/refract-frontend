export interface CoverQueryParams {
  type?: number;
  amount?: string;
  duration?: number;
  flight?: string;
}

export interface ParseQueryParamsOptions {
  validTypeIds?: number[];
  minAmount?: number;
  maxAmount?: number;
  minDuration?: number;
  maxDuration?: number;
}

export function parseCoverQueryParams(
  searchParams: { get: (key: string) => string | null } | URLSearchParams,
  options: ParseQueryParamsOptions = {}
): CoverQueryParams {
  const {
    validTypeIds,
    minAmount = 100,
    maxAmount = 1_000_000,
    minDuration = 1,
    maxDuration = 365,
  } = options;

  const result: CoverQueryParams = {};

  const typeParam = searchParams.get("type");
  if (typeParam !== null && typeParam !== "") {
    const parsedType = parseInt(typeParam, 10);
    if (!isNaN(parsedType)) {
      if (!validTypeIds || validTypeIds.includes(parsedType)) {
        result.type = parsedType;
      }
    }
  }

  const amountParam = searchParams.get("amount");
  if (amountParam !== null && amountParam !== "") {
    const parsedAmount = parseFloat(amountParam);
    if (!isNaN(parsedAmount) && parsedAmount > 0) {
      const clamped = Math.max(minAmount, Math.min(parsedAmount, maxAmount));
      result.amount = String(clamped);
    }
  }

  const durationParam = searchParams.get("duration");
  if (durationParam !== null && durationParam !== "") {
    const parsedDuration = parseInt(durationParam, 10);
    if (!isNaN(parsedDuration)) {
      result.duration = Math.max(minDuration, Math.min(parsedDuration, maxDuration));
    }
  }

  const flightParam = searchParams.get("flight");
  if (flightParam !== null && flightParam.trim().length > 0) {
    result.flight = flightParam.trim().toUpperCase();
  }

  return result;
}

export function serializeCoverQueryParams(params: CoverQueryParams): string {
  const search = new URLSearchParams();
  if (params.type !== undefined) {
    search.set("type", String(params.type));
  }
  if (params.amount !== undefined && params.amount !== "") {
    search.set("amount", String(params.amount));
  }
  if (params.duration !== undefined) {
    search.set("duration", String(params.duration));
  }
  if (params.flight !== undefined && params.flight.trim() !== "") {
    search.set("flight", params.flight.trim());
  }
  return search.toString();
}
