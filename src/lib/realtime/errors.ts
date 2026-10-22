/**
 * Realtime error taxonomy. Every failure the realtime layer can surface is a
 * `RealtimeError` with a `kind`, so reporting, deduplication and recovery can
 * branch on the class of failure instead of on message text.
 *
 * `retryable` says whether retrying the same thing can help:
 * - parse / validation: one bad frame; the connection itself is fine, so the
 *   frame is dropped and the stream continues.
 * - unsupported_version: the server speaks a payload version this bundle
 *   can't read. Retrying won't change that, so the topic degrades to REST.
 * - connection: a single connect attempt failed; the client backs off and retries.
 * - retries_exhausted: reconnects keep failing; realtime is reported as
 *   unavailable and REST polling takes over at full cadence.
 */
export type RealtimeErrorKind =
  "parse" | "validation" | "unsupported_version" | "connection" | "retries_exhausted";

interface RealtimeErrorOptions {
  topic?: string;
  cause?: unknown;
}

export class RealtimeError extends Error {
  readonly kind: RealtimeErrorKind;
  readonly retryable: boolean;
  readonly topic?: string;

  constructor(
    kind: RealtimeErrorKind,
    message: string,
    retryable: boolean,
    opts: RealtimeErrorOptions = {}
  ) {
    super(message);
    this.name = "RealtimeError";
    this.kind = kind;
    this.retryable = retryable;
    this.topic = opts.topic;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/** A frame that isn't valid JSON or isn't shaped like an envelope. */
export class RealtimeParseError extends RealtimeError {
  constructor(message: string, opts: RealtimeErrorOptions = {}) {
    super("parse", message, true, opts);
    this.name = "RealtimeParseError";
  }
}

/** A well-formed envelope whose payload fails the topic's schema. */
export class RealtimeValidationError extends RealtimeError {
  constructor(message: string, opts: RealtimeErrorOptions = {}) {
    super("validation", message, true, opts);
    this.name = "RealtimeValidationError";
  }
}

/** The server sent (or requires) a payload version this bundle can't decode. Never retried. */
export class UnsupportedVersionError extends RealtimeError {
  readonly version: number | null;

  constructor(
    topic: string,
    version: number | null,
    opts: Omit<RealtimeErrorOptions, "topic"> = {}
  ) {
    super(
      "unsupported_version",
      version === null
        ? `Server rejected every supported version for topic "${topic}"`
        : `Unsupported version ${version} for topic "${topic}"`,
      false,
      { ...opts, topic }
    );
    this.name = "UnsupportedVersionError";
    this.version = version;
  }
}

/** A connect attempt failed or the socket dropped. */
export class RealtimeConnectionError extends RealtimeError {
  constructor(
    message: string,
    kind: "connection" | "retries_exhausted" = "connection",
    opts: RealtimeErrorOptions = {}
  ) {
    super(kind, message, kind === "connection", opts);
    this.name = "RealtimeConnectionError";
  }
}
