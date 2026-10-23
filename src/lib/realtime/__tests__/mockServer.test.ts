// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import {
  framesFor,
  resolveScenario,
  startMockRealtimeServer,
} from "../../../../scripts/mock-realtime-server.mjs";
import { RealtimeClient } from "../client";

type Server = Awaited<ReturnType<typeof startMockRealtimeServer>>;
const servers: Server[] = [];
const clients: RealtimeClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function setup(scenario = {}, flags = { "realtime-enabled": true, "realtime-oracle": true }) {
  const server: Server = await startMockRealtimeServer({ scenario });
  servers.push(server);
  const client = new RealtimeClient({
    url: server.url,
    flags,
    baseBackoffMs: 20,
    maxBackoffMs: 40,
    logger: { warn: () => {} },
  });
  clients.push(client);
  return { server, client };
}
const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe("mock realtime server", () => {
  it("is deterministic for a seed", () => {
    const sc = resolveScenario({ seed: 3 });
    expect(framesFor("oracle", sc)).toEqual(framesFor("oracle", sc));
    expect(framesFor("oracle", sc)).not.toEqual(framesFor("oracle", resolveScenario({ seed: 4 })));
  });

  it("documents scenario frames", () => {
    const base = resolveScenario({ count: 4 });
    expect(framesFor("pool", base).map((f: { seq: number }) => f.seq)).toEqual([1, 2, 3, 4]);
    expect(
      framesFor("pool", resolveScenario({ count: 4, reorder: true })).map(
        (f: { seq: number }) => f.seq
      )
    ).toEqual([2, 1, 4, 3]);
    expect(
      framesFor("pool", resolveScenario({ count: 2, duplicate: true })).map(
        (f: { seq: number }) => f.seq
      )
    ).toEqual([1, 1, 2, 2]);
    expect(
      framesFor("pool", resolveScenario({ count: 3, unknown: true })).map(
        (f: { topic: string }) => f.topic
      )
    ).toEqual(["pool", "mystery", "pool", "pool", "pool"]);
    expect(framesFor("pool", base, 2).map((f: { seq: number }) => f.seq)).toEqual([3, 4]);
  });

  it("streams frames to a real client end to end", async () => {
    const { client } = await setup({ count: 3 });
    const seqs: number[] = [];
    client.subscribe("oracle", (m) => seqs.push(m.seq));
    await waitFor(() => seqs.length === 3);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it("drops the connection and the client resumes from its cursor", async () => {
    const { client, server } = await setup({ count: 4, dropAfter: 2 });
    const seqs: number[] = [];
    client.subscribe("oracle", (m) => seqs.push(m.seq));
    await waitFor(() => seqs.length >= 4 && server.connections() >= 2);
    expect(seqs.slice(0, 4)).toEqual([1, 2, 3, 4]);
  });

  it("rejects auth and the client stops", async () => {
    const { client } = await setup({ authFail: true });
    client.subscribe("oracle", () => {});
    await waitFor(() => client.getState() === "closed");
  });

  it("opens no connection when the topic flag is off", async () => {
    const { client, server } = await setup(
      {},
      { "realtime-enabled": true, "realtime-oracle": false }
    );
    client.subscribe("oracle", () => {});
    await new Promise((r) => setTimeout(r, 100));
    expect(server.connections()).toBe(0);
  });
});
