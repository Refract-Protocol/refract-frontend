import { describe, expect, it, vi, afterEach } from "vitest";
import { request, type ApiError } from "./client";

describe("api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws an ApiError with status, code, and message from a 422 envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: "invalid_amount", message: "Amount is invalid" }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(request("/api/transfer")).rejects.toMatchObject({
      status: 422,
      code: "invalid_amount",
      message: "Amount is invalid",
    });
  });

  it("falls back to the status text when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not json", { status: 500, statusText: "Internal Server Error" }),
      ),
    );

    await expect(request("/api/transfer")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });

  it("returns the parsed body on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await request<{ ok: boolean }>("/api/transfer");
    expect(result).toEqual({ ok: true });
  });
});
