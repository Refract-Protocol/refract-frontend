import { describe, expect, it } from "vitest";
import { readSnapshot, writeSnapshot } from "./snapshotCache";

describe("realtime snapshot cache", () => {
  it("keeps wallet and network snapshots isolated and marks cached values stale", async () => {
    writeSnapshot("oracle_update", "testnet", { value: 1 }, "GONE");
    writeSnapshot("oracle_update", "testnet", { value: 2 }, "GTWO");
    writeSnapshot("oracle_update", "mainnet", { value: 3 }, "GONE");
    expect(await readSnapshot("oracle_update", "testnet", "GONE")).toMatchObject({ value: { value: 1 }, stale: true });
    expect(await readSnapshot("oracle_update", "testnet", "GTWO")).toMatchObject({ value: { value: 2 } });
    expect(await readSnapshot("oracle_update", "mainnet", "GONE")).toMatchObject({ value: { value: 3 } });
  });

  it("discards a value written with an older topic schema", async () => {
    writeSnapshot("versioned_topic", "testnet", { old: true }, "GVERSION", 1);
    expect(await readSnapshot("versioned_topic", "testnet", "GVERSION", 2)).toBeNull();
  });
});
