import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cacheDelete, cacheGet, cacheSet, resetCacheConnection, walletCacheKey } from "./indexedDb";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheConnection();
});

describe("indexedDb cache", () => {
  it("round-trips a value with its timestamp", async () => {
    await cacheSet("k", { a: 1 }, 1_000);
    expect(await cacheGet("k")).toEqual({ key: "k", data: { a: 1 }, timestamp: 1_000 });
  });

  it("returns null for a missing key", async () => {
    expect(await cacheGet("missing")).toBeNull();
  });

  it("expires and deletes entries older than maxAgeMs", async () => {
    await cacheSet("k", "v", 0);
    expect(await cacheGet("k", 100, 50)).not.toBeNull();
    expect(await cacheGet("k", 100, 101)).toBeNull();
    expect(await cacheGet("k")).toBeNull();
  });

  it("deletes entries", async () => {
    await cacheSet("k", "v");
    await cacheDelete("k");
    expect(await cacheGet("k")).toBeNull();
  });

  it("scopes keys per wallet address", async () => {
    await cacheSet(walletCacheKey("GA", "policies"), ["a"]);
    expect(await cacheGet(walletCacheKey("GB", "policies"))).toBeNull();
    expect((await cacheGet(walletCacheKey("GA", "policies")))?.data).toEqual(["a"]);
  });

  it("degrades to no-ops when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    resetCacheConnection();
    await expect(cacheSet("k", "v")).resolves.toBeUndefined();
    expect(await cacheGet("k")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("degrades to no-ops when opening the database throws", async () => {
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("SecurityError"); } });
    resetCacheConnection();
    expect(await cacheGet("k")).toBeNull();
    vi.unstubAllGlobals();
  });
});
