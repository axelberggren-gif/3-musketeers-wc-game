import * as Sentry from "@sentry/nextjs";

type Tags = Record<string, string>;

export async function captureServerActionError(
  err: unknown,
  action: string,
  extraTags: Tags = {},
): Promise<string> {
  Sentry.captureException(err, {
    tags: { server_action: action, ...extraTags },
  });
  // Serverless runtimes (Vercel) can freeze the function before Sentry's
  // network send completes. Flush with a short timeout so handled errors
  // actually reach Sentry.
  await Sentry.flush(2000);
  return err instanceof Error ? err.message : String(err);
}
