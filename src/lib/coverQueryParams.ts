import type { ReadonlyURLSearchParams } from "next/navigation";

export const COVER_QUERY_KEYS = [
  "page",
  "type",
  "sort",
  "q",
] as const;

export type CoverQueryKey = (typeof COVER_QUERY_KEYS)[number];

export interface CoverQueryParams {
  page?: number;
  type?: string;
  sort?: string;
  q?: string;
}

export interface ParseQueryParamsOptions {
  defaults?: CoverQueryParams;
}

export function parseCoverQueryParams(
  searchParams: ReadonlyURLSearchParams,
  options: ParseQueryParamsOptions = {}
): CoverQueryParams {
  const params: CoverQueryParams = { ...options.defaults };

  const page = searchParams.get("page");
  if (page !== null) {
    const parsed = Number.parseInt(page, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      params.page = parsed;
    }
  }

  const type = searchParams.get("type");
  if (type !== null) {
    params.type = type;
  }

  const sort = searchParams.get("sort");
  if (sort !== null) {
    params.sort = sort;
  }

  const q = searchParams.get("q");
  if (q !== null) {
    params.q = q;
  }

  return params;
}

export function serializeCoverQueryParams(params: CoverQueryParams): string {
  const search = new URLSearchParams();

  if (params.page !== undefined) {
    search.set("page", String(params.page));
  }
  if (params.type !== undefined) {
    search.set("type", params.type);
  }
  if (params.sort !== undefined) {
    search.set("sort", params.sort);
  }
  if (params.q !== undefined) {
    search.set("q", params.q);
  }

  return search.toString();
}
