> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# lib/sentry/ — error tracking helpers

## Purpose
Thin wrappers around `@sentry/nextjs` for the patterns we repeat across the codebase
(server actions, cron handlers). Sentry itself is initialised from
`/instrumentation-client.ts`, `/instrumentation.ts`, `/sentry.server.config.ts`,
and `/sentry.edge.config.ts` at the repo root.

## Key files
- `capture.ts` — `captureServerActionError(err, action, extraTags?)` — call this from
  every server-action `catch` block. Sends the exception to Sentry with a
  `server_action` tag and returns the human-readable error string. No-op when
  `NEXT_PUBLIC_SENTRY_DSN` is unset (Sentry's `init` simply isn't called).

## Conventions
- **Never `Sentry.setUser` with `email`**. The Supabase user object exposes email;
  always pass `{ id, username }` only. See `app/(app)/layout.tsx` for the call site.
- For manual capture outside the server-action pattern, use
  `Sentry.captureException(err, { tags: { area: "<area>" } })` directly. Always tag
  the area so issues are filterable.
- PII surface is masked at the **session replay** layer in
  `/instrumentation-client.ts` via `maskAllInputs: true` (covers the login email
  input). If you render PII in the DOM, gate it with
  `className="sentry-block"` or `data-sentry-mask`.

## Invariants (do not break)
- Sentry integration must **no-op without env vars**. The init blocks in
  `instrumentation-client.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts`
  are gated on `NEXT_PUBLIC_SENTRY_DSN` — preserve that guard so CI and local dev
  without a DSN don't break.
- Source-map upload is gated in `next.config.ts` on `SENTRY_AUTH_TOKEN`. Don't
  remove the guard; CI builds without secrets must still pass.
- Tracing is **off** (`tracesSampleRate: 0`). Don't enable it without raising the
  quota first — the free tier is 5k events/month total.

## Known gotchas
- Session replay is **errors-only** (`replaysSessionSampleRate: 0`,
  `replaysOnErrorSampleRate: 1.0`) to stay under the free-tier 50 replays/month cap.
- The `withSentryConfig` wrap in `next.config.ts` runs `silent: true` so build logs
  stay clean. Set `silent: false` locally if you're debugging source-map upload.
