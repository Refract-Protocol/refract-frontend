"use client";

import { useMemo, useState } from "react";
import { Card } from "./Card";

/**
 * A single column definition for {@link DataTable}.
 *
 * `render` receives the row so callers can derive custom cells (e.g. status
 * badges) without the table hardcoding any domain-specific column types.
 */
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  /** Value used for client-side sorting. Defaults to `row[key]`. */
  sortValue?: (row: T) => string | number;
  /** Optional className applied to the cell (both table and stacked views). */
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Stable identity for each row; falls back to the row index. */
  getRowKey?: (row: T, index: number) => string | number;
  loading?: boolean;
  error?: React.ReactNode;
  empty?: React.ReactNode;
  /** Rendered while `loading` is true. Defaults to a skeleton table. */
  loadingSlot?: React.ReactNode;
  /** Accessible caption for the table. */
  caption?: string;
  className?: string;
}

type SortDirection = "asc" | "desc";

interface SortState {
  key: string;
  direction: SortDirection;
}

function defaultSortValue<T>(row: T, column: Column<T>): string | number {
  if (column.sortValue) return column.sortValue(row);
  const value = (row as Record<string, unknown>)[column.key];
  if (typeof value === "number") return value;
  if (value == null) return "";
  return String(value);
}

/**
 * Stable client-side sort: rows with equal sort values keep their original
 * relative order (decorate-sort-undecorate with the original index as a
 * tie-breaker).
 */
function sortRows<T>(rows: T[], column: Column<T>, direction: SortDirection): T[] {
  const decorated = rows.map((row, index) => ({
    row,
    index,
    value: defaultSortValue(row, column),
  }));

  decorated.sort((a, b) => {
    let result: number;
    if (typeof a.value === "number" && typeof b.value === "number") {
      result = a.value - b.value;
    } else {
      result = String(a.value).localeCompare(String(b.value), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }
    if (result === 0) return a.index - b.index;
    return direction === "asc" ? result : -result;
  });

  return decorated.map((entry) => entry.row);
}

function DefaultLoading() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 w-full animate-pulse rounded-lg bg-slate-100"
        />
      ))}
    </div>
  );
}

/**
 * Generic, accessible, column-driven table.
 *
 * Renders a semantic `<table>` on desktop and a stacked card layout on mobile,
 * both driven by the same `columns`/`rows` configuration. Loading, error and
 * empty states are caller-controlled via dedicated slots.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading = false,
  error,
  empty,
  loadingSlot,
  caption,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;
    return sortRows(rows, column, sort.direction);
  }, [rows, columns, sort]);

  const toggleSort = (column: Column<T>) => {
    if (!column.sortable) return;
    setSort((current) => {
      if (!current || current.key !== column.key) {
        return { key: column.key, direction: "asc" };
      }
      return {
        key: column.key,
        direction: current.direction === "asc" ? "desc" : "asc",
      };
    });
  };

  const ariaSortFor = (column: Column<T>): "ascending" | "descending" | "none" => {
    if (!sort || sort.key !== column.key) return "none";
    return sort.direction === "asc" ? "ascending" : "descending";
  };

  const rowKey = (row: T, index: number) =>
    getRowKey ? getRowKey(row, index) : index;

  if (loading) {
    return (
      <div className={className} role="status" aria-busy="true">
        {loadingSlot ?? <DefaultLoading />}
      </div>
    );
  }

  if (error) {
    return (
      <div className={className} role="alert">
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className={className}>{empty}</div>;
  }

  return (
    <div className={className}>
      {/* Desktop: semantic table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-slate-200">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={column.sortable ? ariaSortFor(column) : undefined}
                  className="px-4 py-3 font-medium text-slate-500"
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className="inline-flex items-center gap-1 rounded font-medium text-slate-500 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                    >
                      {column.header}
                      <span aria-hidden="true">
                        {sort?.key === column.key
                          ? sort.direction === "asc"
                            ? "\u2191"
                            : "\u2193"
                          : "\u2195"}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className="border-b border-slate-100 last:border-0"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 align-middle ${column.className ?? ""}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <div className="space-y-3 md:hidden">
        {sortedRows.map((row, index) => (
          <Card key={rowKey(row, index)} className="p-4">
            <dl className="space-y-2">
              {columns.map((column) => (
                <div
                  key={column.key}
                  className="flex items-center justify-between gap-4"
                >
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {column.header}
                  </dt>
                  <dd className={`text-sm text-slate-900 ${column.className ?? ""}`}>
                    {column.render(row)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
    </div>
  );
}
