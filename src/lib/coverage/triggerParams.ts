/**
 * Typed trigger parameters for parameterised coverage types.
 *
 * The flight-delay coverage type (id 4) is the only parameterised type today:
 * its trigger is documented as "Flight delayed > 120 minutes per AviationStack
 * data", which requires a resolvable carrier + flight number and the departure
 * date the flight number is unique for.
 */

/** Coverage type id for the flight-delay policy. */
export const FLIGHT_DELAY_COVERAGE_TYPE_ID = 4;

/**
 * IATA/ICAO flight designator: a 2-3 character carrier code (which may contain
 * digits, e.g. `U2`, `3K`) followed by a 1-4 digit flight number and an
 * optional operational suffix (e.g. `BA249A`).
 */
export const FLIGHT_NUMBER_PATTERN = /^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$/;

/** Maximum accepted length of a normalised flight designator. */
export const FLIGHT_NUMBER_MAX_LENGTH = 8;

/**
 * Result-shape convention shared with the amount validator: a discriminated
 * union carrying either the normalised value or a specific error message.
 */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Normalise a raw flight-number input: strip whitespace and separators,
 * uppercase, and reformat for display. Returns the canonical designator.
 */
export function normaliseFlightNumber(raw: string): string {
  return raw.replace(/[\s\-_.]/g, '').toUpperCase();
}

/**
 * Validate a raw flight-number input against the IATA/ICAO designator
 * pattern, returning a specific error message per failure mode.
 */
export function validateFlightNumber(
  raw: string,
): ValidationResult<string> {
  const value = normaliseFlightNumber(raw);

  if (value.length === 0) {
    return { ok: false, error: 'Enter a flight number, e.g. BA249.' };
  }

  if (value.length > FLIGHT_NUMBER_MAX_LENGTH) {
    return {
      ok: false,
      error: 'Flight number is too long. Use a carrier code plus up to 4 digits, e.g. BA249.',
    };
  }

  if (!/^[A-Z0-9]+$/.test(value)) {
    return {
      ok: false,
      error: 'Flight number can only contain letters and digits, e.g. BA249.',
    };
  }

  if (!FLIGHT_NUMBER_PATTERN.test(value)) {
    return {
      ok: false,
      error: 'Use a 2-3 character carrier code followed by 1-4 digits, e.g. BA249 or U21234.',
    };
  }

  return { ok: true, value };
}

/**
 * Validate a departure date against the policy coverage window, which starts
 * today and runs for `durationDays`.
 */
export function validateDepartureDate(
  raw: string,
  durationDays: number,
  now: Date = new Date(),
): ValidationResult<string> {
  if (raw.trim().length === 0) {
    return { ok: false, error: 'Select the flight departure date.' };
  }

  const departure = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(departure.getTime())) {
    return { ok: false, error: 'Enter a valid departure date.' };
  }

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(0, durationDays));

  if (departure < start) {
    return {
      ok: false,
      error: 'Departure date cannot be before the policy start date.',
    };
  }

  if (departure > end) {
    return {
      ok: false,
      error: `Departure date must fall within the ${durationDays}-day coverage window.`,
    };
  }

  return { ok: true, value: raw };
}

/** Trigger parameters for the flight-delay coverage type. */
export interface FlightDelayTriggerParams {
  flightNumber: string;
  departureDate: string;
}

/**
 * Discriminated union of trigger parameters keyed by coverage type id, so
 * adding a future parameterised coverage type stays type-safe.
 */
export type TriggerParams =
  | { coverageTypeId: typeof FLIGHT_DELAY_COVERAGE_TYPE_ID; params: FlightDelayTriggerParams }
  | { coverageTypeId: number; params: Record<string, never> };

/**
 * Build the typed trigger parameters for a coverage type. Returns `null` when
 * the coverage type is parameterised but the supplied values are invalid.
 */
export function buildTriggerParams(
  coverageTypeId: number,
  values: { flightNumber?: string; departureDate?: string },
): TriggerParams | null {
  if (coverageTypeId === FLIGHT_DELAY_COVERAGE_TYPE_ID) {
    const flight = validateFlightNumber(values.flightNumber ?? '');
    if (!flight.ok) return null;

    const date = values.departureDate ?? '';
    if (date.trim().length === 0) return null;

    return {
      coverageTypeId: FLIGHT_DELAY_COVERAGE_TYPE_ID,
      params: { flightNumber: flight.value, departureDate: date },
    };
  }

  return { coverageTypeId, params: {} };
}
