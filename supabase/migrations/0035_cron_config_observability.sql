-- World Cup 2026 Bet Game — make a mis-configured cron VISIBLE.
--
-- Context: `call_cron_endpoint()` (0003, timeout added in 0034) short-circuits
-- with `raise warning` + `return` when the `app.cron_app_url` / `app.cron_secret`
-- Postgres GUCs are missing. That warning only lands in the Postgres logs, so
-- the failure is invisible in the app: the pg_cron job still reports `succeeded`
-- (it dispatched nothing and returned cleanly), and no row is written anywhere
-- the team looks. This exact hole bit us — after an infra event wiped the GUCs,
-- the */10 sync silently did nothing for weeks while `cron.job_run_details`
-- showed green, and the only symptom was stale data + manual syncing.
--
-- Fix: on the missing-GUC branch, also INSERT an `external_sync_log` row so the
-- admin dashboard's "Recent sync log" surfaces the mis-config in red-flag terms
-- instead of the cron looking healthy. The `raise warning` is kept as well.
-- Everything else is verbatim from the 0034 body (30 s pg_net timeout retained),
-- plus `set search_path = public` on the security-definer clause — the repo
-- convention for definer functions (see migrations/CLAUDE.md), which 0003/0034
-- omitted. Safe here: `net.http_post` is schema-qualified and `external_sync_log`
-- lives in public, so both resolve regardless.
--
-- Append-only: 0003/0034 untouched; `create or replace` keeps it idempotent and
-- the scheduled `select call_cron_endpoint(...)` command picks up the new body
-- automatically (no re-schedule). No schema change (`external_sync_log` already
-- exists, from 0001) → no `npm run db:types`; no point values touched.
--
-- Note: this only makes the GUC-missing case visible in the admin UI. A pg_net
-- call that IS dispatched but fails (timeout / non-200) is still recorded only
-- in `net._http_response` — surfacing that in the admin UI would need a separate
-- reader job and is out of scope here.

create or replace function call_cron_endpoint(path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  app_url text := current_setting('app.cron_app_url', true);
  cron_secret text := current_setting('app.cron_secret', true);
begin
  if app_url is null or cron_secret is null then
    insert into external_sync_log (source, endpoint, status_code, message)
    values (
      'pg_cron',
      path,
      null,
      'Cron call skipped: app.cron_app_url and/or app.cron_secret Postgres GUCs are not set, '
      || 'so no HTTP request was sent (the job reports success but does nothing). '
      || 'Set both in Supabase → Settings → Database → Custom Postgres config '
      || '(app.cron_secret must equal the CRON_SECRET env var; app.cron_app_url is the '
      || 'production URL with no trailing slash), then restart the database.'
    );
    raise warning 'app.cron_app_url or app.cron_secret not set; skipping cron call.';
    return;
  end if;
  perform net.http_post(
    url := app_url || path,
    headers := jsonb_build_object('x-cron-secret', cron_secret, 'content-type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
