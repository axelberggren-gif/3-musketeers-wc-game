"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center p-6 bg-paper text-ink">
        <div className="max-w-md w-full sticker p-6 flex flex-col gap-3">
          <h1 className="font-display text-2xl">Something broke.</h1>
          <p className="text-sm text-ink/80">
            We&apos;ve been notified and someone will take a look. You can try again or head home.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="badge badge-pitch font-display"
              style={{ boxShadow: "3px 3px 0 var(--ink)" }}
            >
              Try again
            </button>
            <Link
              href="/"
              className="badge font-display"
              style={{ boxShadow: "3px 3px 0 var(--ink)" }}
            >
              Home
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
