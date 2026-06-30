-- World Cup 2026 Bet Game — give the cron HTTP call enough time to finish.
--
-- Symptom: the */10 `sync_fixtures` job never updated data; the team had to
-- run the admin "Sync fixtures" button manually every time. The admin button
-- calls `syncFixtures()` in-process (no HTTP), which is why it always worked.
--
-- Diagnosis (from `net._http_response`): every cron run failed with
--   "Timeout of 5000 ms reached ... HTTP Request/Response time: ~4977 ms"
-- DNS (~5 ms) and the TCP/SSL handshake (~18 ms) succeeded, so the URL, host
-- and secret were fine — the endpoint simply didn't respond within pg_net's
-- 5000 ms default. `syncFixtures()` (football-data list call + up to 5
-- sequential per-match detail fetches under a 10-req/min rate limit + ~104
-- match upserts + scoring RPCs) routinely takes longer than 5 s, so pg_net
-- aborted the connection on every run.
--
-- Fix: recreate `call_cron_endpoint()` to pass `timeout_milliseconds` to
-- `net.http_post` (30 s), comfortably above a normal sync. Paired with
-- `export const maxDuration = 60` on the cron route handlers so Vercel doesn't
-- kill the function before it finishes (raising the pg_net timeout alone is
-- useless if the platform caps the function first). Append-only: 0003 is left
-- untouched; the scheduled job command (`select call_cron_endpoint(...)`) is
-- unchanged and picks up the new function body automatically — no re-schedule.

create or replace function call_cron_endpoint(path text)
returns void
language plpgsql
security definer
as $$
declare
  app_url text := current_setting('app.cron_app_url', true);
  cron_secret text := current_setting('app.cron_secret', true);
begin
  if app_url is null or cron_secret is null then
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
