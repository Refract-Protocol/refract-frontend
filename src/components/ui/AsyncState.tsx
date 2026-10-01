import React from "react";
import { Card } from "./Card";

export interface AsyncStateProps<T = unknown> {
  loading: boolean;
  error?: string | Error | null;
  isEmpty?: boolean;
  isFixture?: boolean;
  data?: T | null;
  loadingRender?: React.ReactNode | (() => React.ReactNode);
  errorRender?: ((error: string) => React.ReactNode) | React.ReactNode;
  emptyRender?: React.ReactNode | (() => React.ReactNode);
  children: React.ReactNode | ((data: T) => React.ReactNode);
}

/**
 * Shared wrapper encoding the standard loading/error/empty/success state machine
 * with proper accessibility attributes (role="status", role="alert").
 */
export function AsyncState<T>({
  loading,
  error,
  isEmpty = false,
  isFixture = false,
  data,
  loadingRender,
  errorRender,
  emptyRender,
  children,
}: AsyncStateProps<T>) {
  if (loading) {
    if (typeof loadingRender === "function") {
      return <>{loadingRender()}</>;
    }
    return loadingRender ? (
      <>{loadingRender}</>
    ) : (
      <div role="status" aria-label="Loading" className="py-8 text-center text-sm text-pm-text/50">
        Loading…
      </div>
    );
  }

  if (error) {
    const errorMsg = typeof error === "string" ? error : error.message || "An error occurred";
    if (typeof errorRender === "function") {
      return <>{errorRender(errorMsg)}</>;
    }
    return errorRender ? (
      <>{errorRender}</>
    ) : (
      <Card className="border-pm-red/30 !bg-pm-red/[0.04]" role="alert">
        <p className="text-sm text-pm-red">{errorMsg}</p>
      </Card>
    );
  }

  if (isEmpty && !isFixture) {
    if (typeof emptyRender === "function") {
      return <>{emptyRender()}</>;
    }
    return emptyRender ? (
      <>{emptyRender}</>
    ) : (
      <div className="py-8 text-center text-sm text-pm-text/40">No data found.</div>
    );
  }

  if (typeof children === "function" && data !== undefined && data !== null) {
    return <>{children(data)}</>;
  }

  return <>{children as React.ReactNode}</>;
}
