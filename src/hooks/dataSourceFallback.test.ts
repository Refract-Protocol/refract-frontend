import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { ApiUnreachableError } from "@/lib/api/client";
import { FIXTURE_POOL_STATS } from "@/lib/fixtures/poolStats";
import * as poolApi from "@/lib/api/pool";
import * as policiesApi from "@/lib/api/policies";
import * as rpc from "@/lib/stellar/rpc";
import { usePoolStats } from "./usePoolStats";
import { useLockupStatus } from "./useLockupStatus";
import { useCoverageBounds } from "./useCoverageBounds";

vi.mock("@/lib/api/pool");
vi.mock("@/lib/api/policies");
vi.mock("@/lib/stellar/rpc");

const unreachable = () => new ApiUnreachableError("down");
const STATS = { ...FIXTURE_POOL_STATS, apyBps: 0 };

beforeEach(() => vi.resetAllMocks());

describe("usePoolStats tiers", () => {
  it("uses the API first and never touches the chain", async () => {
    vi.mocked(poolApi.fetchPoolStats).mockResolvedValue(FIXTURE_POOL_STATS);
    const { result } = renderHook(() => usePoolStats());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ dataSource: "api", isFixture: false });
    expect(rpc.readPoolStats).not.toHaveBeenCalled();
  });

  it("falls back to the chain when the API is unreachable", async () => {
    vi.mocked(poolApi.fetchPoolStats).mockRejectedValue(unreachable());
    vi.mocked(rpc.readPoolStats).mockResolvedValue(STATS);
    const { result } = renderHook(() => usePoolStats());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ dataSource: "chain", isFixture: false, data: STATS });
  });

  it("falls back to the fixture when both API and chain fail", async () => {
    vi.mocked(poolApi.fetchPoolStats).mockRejectedValue(unreachable());
    vi.mocked(rpc.readPoolStats).mockRejectedValue(new Error("rpc down"));
    const { result } = renderHook(() => usePoolStats());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ dataSource: "fixture", isFixture: true, data: FIXTURE_POOL_STATS });
  });

  it("surfaces non-connectivity API errors without hitting the chain", async () => {
    vi.mocked(poolApi.fetchPoolStats).mockRejectedValue(new Error("500"));
    const { result } = renderHook(() => usePoolStats());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ error: "500", data: null, dataSource: null });
    expect(rpc.readPoolStats).not.toHaveBeenCalled();
  });
});

describe("useLockupStatus tiers", () => {
  it("api -> chain -> unlocked (never fabricated)", async () => {
    vi.mocked(poolApi.fetchLockupStatus).mockResolvedValue({ lockupExpiresAt: "100" });
    const api = renderHook(() => useLockupStatus("GADDR"));
    await waitFor(() => expect(api.result.current.dataSource).toBe("api"));
    expect(api.result.current.lockupExpiresAt).toBe(100);

    vi.mocked(poolApi.fetchLockupStatus).mockRejectedValue(unreachable());
    vi.mocked(rpc.readLockupStatus).mockResolvedValue({ lockupExpiresAt: "200" });
    const chain = renderHook(() => useLockupStatus("GADDR"));
    await waitFor(() => expect(chain.result.current.dataSource).toBe("chain"));
    expect(chain.result.current.lockupExpiresAt).toBe(200);

    vi.mocked(rpc.readLockupStatus).mockRejectedValue(new Error("rpc down"));
    const none = renderHook(() => useLockupStatus("GADDR"));
    await waitFor(() => expect(none.result.current.loading).toBe(false));
    expect(none.result.current).toMatchObject({ lockupExpiresAt: null, dataSource: null });
  });
});

describe("useCoverageBounds tiers", () => {
  it("api -> chain -> unknown", async () => {
    vi.mocked(policiesApi.fetchCoverageBounds).mockResolvedValue({ minCoverage: "1000000000", maxCoverage: null });
    const api = renderHook(() => useCoverageBounds());
    await waitFor(() => expect(api.result.current.isLoading).toBe(false));
    expect(api.result.current).toMatchObject({ dataSource: "api", minCoverage: 100, maxCoverage: null });

    vi.mocked(policiesApi.fetchCoverageBounds).mockRejectedValue(unreachable());
    vi.mocked(rpc.readCoverageBounds).mockResolvedValue({ minCoverage: "2000000000", maxCoverage: "9000000000" });
    const chain = renderHook(() => useCoverageBounds());
    await waitFor(() => expect(chain.result.current.dataSource).toBe("chain"));
    expect(chain.result.current).toMatchObject({ minCoverage: 200, maxCoverage: 900, isError: false });

    vi.mocked(rpc.readCoverageBounds).mockRejectedValue(new Error("rpc down"));
    const none = renderHook(() => useCoverageBounds());
    await waitFor(() => expect(none.result.current.isError).toBe(true));
    expect(none.result.current).toMatchObject({ minCoverage: null, maxCoverage: null, dataSource: null });
  });
});
