export function validateEndpoint(
  raw: string,
  pageOrigin: string,
  allowed: readonly string[] = []
): URL {
  const url = new URL(raw);
  const page = new URL(pageOrigin);
  const local =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(page.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== "wss:" && !(local && url.protocol === "ws:"))
  )
    throw new Error("Invalid realtime endpoint");
  const expected = `${page.protocol === "https:" ? "wss:" : "ws:"}//${page.host}`;
  if (url.origin !== expected && !allowed.includes(url.origin) && !local)
    throw new Error("Realtime endpoint origin is not allowed");
  return url;
}

/** TLS authenticates the endpoint; fresh challenge binds all events to this connection. */
export class SessionIngress {
  private sequence = -1;
  constructor(
    readonly session: string,
    private now = Date.now
  ) {}
  accept(value: Record<string, unknown>): boolean {
    if (
      value.session !== this.session ||
      !Number.isSafeInteger(value.sequence) ||
      (value.sequence as number) <= this.sequence ||
      typeof value.timestamp !== "number" ||
      !Number.isFinite(value.timestamp) ||
      Math.abs(this.now() - value.timestamp) > 60_000
    )
      return false;
    this.sequence = value.sequence as number;
    return true;
  }
}
