-- World Cup 2026 Bet Game — pg_cron + pg_net to poll football-data.org.
--
-- Required Supabase extensions: pg_cron, pg_net (both available on hosted
-- Supabase out of the box, enable them in Database → Extensions).
--
-- Before applying, set these Postgres GUCs in the Supabase dashboard
-- (Settings → Database → Custom Postgres config):
--   app.cron_app_url   = 'https://your-app.vercel.app'
--   app.cron_secret    = 'same-value-as-CRON_SECRET-env-var'

create extension if not exists "pg_cron";
create extension if not exists "pg_net";

-- ---------------------------------------------------------------------------
-- Helper: HTTP POST to a Next.js cron endpoint with the shared secret header
-- ---------------------------------------------------------------------------

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
    body := '{}'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Schedule: sync fixtures every 10 minutes; sync scorers daily at 06:00 UTC.
-- ---------------------------------------------------------------------------

-- Unschedule any previous versions
do $$
declare
  jid bigint;
begin
  for jid in select jobid from cron.job where jobname in ('sync_fixtures', 'sync_scorers') loop
    perform cron.unschedule(jid);
  end loop;
end $$;

select cron.schedule('sync_fixtures', '*/10 * * * *', $$ select call_cron_endpoint('/api/cron/sync-fixtures'); $$);
select cron.schedule('sync_scorers',  '0 6 * * *',    $$ select call_cron_endpoint('/api/cron/sync-scorers'); $$);
