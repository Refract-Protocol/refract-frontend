import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ApiUnreachableError,
  ServerError,
  TimeoutError,
  ValidationError,
  apiRequest,
  describeApiError,
  isTransientError,
  retryOnTransient,
} from "./client";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("apiRequest status mapping", () => {
  it("returns the JSON payload on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, { ok: 1 }));
    await expect(apiRequest("/x")).resolves.toEqual({ ok: 1 });
  });

  it("maps 4xx to ValidationError and never retries", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(400, { error: "bad", field: "amount" }));
    const err = (await apiRequest("/x").catch((e) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.field).toBe("amount");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps 5xx to ServerError and retries GETs with backoff", async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(503, { error: "down" }));
    const p = apiRequest("/x").catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await p).toBeInstanceOf(ServerError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry POSTs", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(500, {}));
    await expect(apiRequest("/x", { method: "POST", body: {} })).rejects.toBeInstanceOf(ServerError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to statusText for non-JSON errors and keeps plain ApiError for other statuses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 302, statusText: "Found" }));
    const err = (await apiRequest("/x", { method: "POST" }).catch((e) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(ValidationError);
    expect(err.message).toBe("Found");
  });

  it("maps network failures to ApiUnreachableError without retrying", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiRequest("/x")).rejects.toBeInstanceOf(ApiUnreachableError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("apiRequest timeout", () => {
  function hangingFetch() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          const abort = () => reject(new DOMException("aborted", "AbortError"));
          if (init!.signal!.aborted) abort();
          init!.signal!.addEventListener("abort", abort);
        })
    );
  }

  it("throws TimeoutError when the request exceeds the timeout", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const p = apiRequest("/x", { method: "POST", timeoutMs: 1000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = (await p) as TimeoutError;
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err.timeoutMs).toBe(1000);
  });

  it("treats a caller abort as unreachable, not a timeout", async () => {
    hangingFetch();
    const controller = new AbortController();
    const p = apiRequest("/x", { signal: controller.signal }).catch((e) => e);
    controller.abort();
    expect(await p).toBeInstanceOf(ApiUnreachableError);
  });

  it("honours an already-aborted caller signal", async () => {
    hangingFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(apiRequest("/x", { signal: controller.signal })).rejects.toBeInstanceOf(ApiUnreachableError);
  });
});

describe("retryOnTransient", () => {
  it("retries timeouts then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new TimeoutError(10)).mockResolvedValue("ok");
    await expect(retryOnTransient(fn, { baseDelayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stops retrying once the caller aborts", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new ServerError("x", 500);
    });
    await expect(retryOnTransient(fn, { signal: controller.signal })).rejects.toBeInstanceOf(ServerError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops if aborted during the backoff delay", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new ServerError("x", 500));
    const p = retryOnTransient(fn, { baseDelayMs: 5, signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(ServerError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("error helpers", () => {
  it("extracts the field from nested details shapes", () => {
    expect(new ValidationError("x", 400, { details: { field: "durationDays" } }).field).toBe("durationDays");
    expect(new ValidationError("x", 400, { details: [{ path: ["coverageAmount"] }] }).field).toBe("coverageAmount");
    expect(new ValidationError("x", 400, null).field).toBeUndefined();
  });

  it("classifies transient errors", () => {
    expect(isTransientError(new ServerError("x", 500))).toBe(true);
    expect(isTransientError(new TimeoutError(1))).toBe(true);
    expect(isTransientError(new ApiUnreachableError(null))).toBe(true);
    expect(isTransientError(new ValidationError("x", 400))).toBe(false);
  });

  it("describes each error class distinctly", () => {
    expect(describeApiError(new ValidationError("too big", 400, { field: "amount" }), "f")).toBe('Check "amount": too big');
    expect(describeApiError(new ValidationError("too big", 400), "f")).toBe("Check your input: too big");
    expect(describeApiError(new ServerError("x", 500), "f")).toMatch(/try again in a moment/);
    expect(describeApiError(new TimeoutError(1000), "f")).toMatch(/took too long/);
    expect(describeApiError(new Error("boom"), "f")).toBe("boom");
    expect(describeApiError("weird", "f")).toBe("f");
  });
});
