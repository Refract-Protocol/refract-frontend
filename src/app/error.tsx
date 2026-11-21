"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { useAriaLive } from "@/components/ui/AriaLiveProvider";

const FALLBACK_MESSAGE = "Something went wrong. Please try again.";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { announce } = useAriaLive();
  const message = error.message || FALLBACK_MESSAGE;

  useEffect(() => {
    // Report to Sentry even when the error has no message.
    Sentry.captureException(error);
    announce(message);
  }, [error, message, announce]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p role="alert" className="text-muted-foreground">
        {message}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
      >
        Reload
      </button>
    </main>
  );
}
