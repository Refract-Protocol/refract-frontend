"use client";

import { create } from "zustand";
import {
  fetchCoverageBounds,
  fetchCoverageTypes,
  ApiUnreachableError,
  type CoverageType,
} from "@/lib/api/policies";
import { fromStroops } from "@/lib/format";
import { COVERAGE_TYPES as FIXTURE_COVERAGE_TYPES } from "@/lib/coverage/metadata";

/**
 * Single owner of the coverage catalogue and the on-chain bounds that
 * constrain it. Both the landing page and /cover read from here so every
 * surface shows the same catalogue and the same limits, and one fetch
 * serves both routes within the TTL.
 */

/** How long a successful catalogue/bounds read is considered fresh. */
export const CATALOG_TTL_MS = 60_000;

export type CatalogStatus = "idle" | "loading" | "ready" | "error";

export interface CoverageBounds {
  /** Human USDC amounts, or null if unknown/unavailable — never fabricated. */
  minCoverage: number | null;
  maxCoverage: number | null;
}

/**
 * The reconciled bounds a caller should actually clamp against for a given
 * type. `boundsAvailable` is false when the on-chain read failed, so the UI
 * can say bounds are unknown instead of silently clamping to catalogue-only
 * limits.
 */
export interface EffectiveBounds {
  minCoverage: number;
  maxCoverage: number;
  boundsAvailable: boolean;
}

interface CatalogState {
  coverageTypes: CoverageType[];
  bounds: CoverageBounds;
  status: CatalogStatus;
  /** True when the catalogue came from the local fixture, not the backend. */
  usingFixture: boolean;
  /** True when the on-chain bounds read succeeded. */
  boundsAvailable: boolean;
  /** Selected coverage type id, shared across routes. */
  selectedTypeId: string | null;
  error: string | null;
  lastFetchedAt: number | null;
  load: (options?: { force?: boolean }) => Promise<void>;
  selectType: (typeId: string | null) => void;
  effectiveBoundsFor: (typeId: string) => EffectiveBounds | null;
}

const EMPTY_BOUNDS: CoverageBounds = { minCoverage: null, maxCoverage: null };

/**
 * Reconcile the catalogue's per-type limits with the single global on-chain
 * bound. The on-chain bound is authoritative when available; otherwise we
 * fall back to the catalogue's own limits and flag that bounds are unknown.
 */
export function reconcileBounds(
  type: CoverageType | undefined,
  bounds: CoverageBounds,
  boundsAvailable: boolean,
): EffectiveBounds | null {
  if (!type) return null;

  const chainMin = bounds.minCoverage;
  const chainMax = bounds.maxCoverage;

  if (!boundsAvailable || chainMin === null || chainMax === null) {
    return {
      minCoverage: type.minCoverage,
      maxCoverage: type.maxCoverage,
      boundsAvailable: false,
    };
  }

  return {
    minCoverage: Math.max(type.minCoverage, chainMin),
    maxCoverage: Math.min(type.maxCoverage, chainMax),
    boundsAvailable: true,
  };
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  coverageTypes: [],
  bounds: EMPTY_BOUNDS,
  status: "idle",
  usingFixture: false,
  boundsAvailable: false,
  selectedTypeId: null,
  error: null,
  lastFetchedAt: null,

  load: async ({ force = false } = {}) => {
    const { status, lastFetchedAt } = get();
    if (status === "loading") return;
    if (
      !force &&
      status === "ready" &&
      lastFetchedAt !== null &&
      Date.now() - lastFetchedAt < CATALOG_TTL_MS
    ) {
      return;
    }

    set({ status: "loading", error: null });

    // Catalogue: live data, fixture on ApiUnreachableError, real error otherwise.
    let coverageTypes: CoverageType[] = [];
    let usingFixture = false;
    try {
      coverageTypes = await fetchCoverageTypes();
    } catch (err) {
      if (err instanceof ApiUnreachableError) {
        coverageTypes = FIXTURE_COVERAGE_TYPES;
        usingFixture = true;
      } else {
        set({
          status: "error",
          error: err instanceof Error ? err.message : "Failed to load coverage catalogue",
        });
        return;
      }
    }

    // Bounds: no fixture — a failed read leaves bounds unknown.
    let bounds: CoverageBounds = EMPTY_BOUNDS;
    let boundsAvailable = false;
    try {
      const raw = await fetchCoverageBounds();
      bounds = {
        minCoverage: raw.minCoverage ? fromStroops(raw.minCoverage) : null,
        maxCoverage: raw.maxCoverage ? fromStroops(raw.maxCoverage) : null,
      };
      boundsAvailable = bounds.minCoverage !== null && bounds.maxCoverage !== null;
    } catch {
      bounds = EMPTY_BOUNDS;
      boundsAvailable = false;
    }

    set({
      coverageTypes,
      bounds,
      usingFixture,
      boundsAvailable,
      status: "ready",
      error: null,
      lastFetchedAt: Date.now(),
    });
  },

  selectType: (typeId) => set({ selectedTypeId: typeId }),

  effectiveBoundsFor: (typeId) => {
    const { coverageTypes, bounds, boundsAvailable } = get();
    const type = coverageTypes.find((ct) => ct.id === typeId);
    return reconcileBounds(type, bounds, boundsAvailable);
  },
}));
