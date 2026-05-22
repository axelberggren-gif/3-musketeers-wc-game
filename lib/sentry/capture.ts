import * as Sentry from "@sentry/nextjs";

type Tags = Record<string, string>;

export function captureServerActionError(
  err: unknown,
  action: string,
  extraTags: Tags = {},
): string {
  Sentry.captureException(err, {
    tags: { server_action: action, ...extraTags },
  });
  return err instanceof Error ? err.message : String(err);
}
