-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/integration_webhooks_schedule.test.sql
--
-- Covers section 8 of 20261024130000_integration_webhooks.sql: the pg_cron
-- job that calls /api/cron/deliver-webhooks every minute through pg_net, with
-- the URL and the bearer read from Vault at run time; and section 2 of
-- 20261025090000_integration_hardening.sql (D-57): the job runs
-- request_webhook_delivery(), which warns while a secret is missing, and
-- webhook_scheduler_health() reports it.
--
-- pgTAP cannot see a WARNING. The PGlite harness prints them with --notices:
-- the migration's, and request_webhook_delivery()'s on the two runs below
-- that have a secret missing.
--
-- Needs pg_cron, pg_net and Vault: `supabase test db` against a local stack
-- has them; the PGlite harness stands them in with --stub-scheduler. Where
-- they are missing the migration skips the job and this file cannot run.
-- Everything happens inside one transaction that is rolled back,
-- so the secrets stored here never outlive it, and pg_net sends nothing (it
-- only starts requests after a commit).
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);


-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- Runs the job's command as pg_cron would and returns how many requests it
-- queued.
create function pg_temp.run_job() returns bigint
language plpgsql as $$
declare
  v_before bigint;
  v_command text;
begin
  select count(*) into v_before from net.http_request_queue;
  select j.command into v_command from cron.job j where j.jobname = 'qdit-deliver-webhooks';
  execute v_command;
  return (select count(*) from net.http_request_queue) - v_before;
end;
$$;


-- ----------------------------------------------------------------------------
-- 1. The job
-- ----------------------------------------------------------------------------

select results_eq(
  $$ select schedule from cron.job where jobname = 'qdit-deliver-webhooks' $$,
  $$ values ('* * * * *'::text) $$,
  'one job, every minute'
);
select is(
  (select command from cron.job where jobname = 'qdit-deliver-webhooks'),
  'select public.request_webhook_delivery()',
  'the job holds no secret; it runs request_webhook_delivery(), which reads them from Vault'
);


-- ----------------------------------------------------------------------------
-- 2. What it sends, and the health signal (D-57)
-- ----------------------------------------------------------------------------

-- Whatever this environment already stores is set aside for the test.
delete from vault.secrets where name in ('qdit_deliver_webhooks_url', 'qdit_cron_secret');

select is(pg_temp.run_job(), 0::bigint, 'with no secrets stored the job sends nothing');
select is(
  public.webhook_scheduler_health(),
  '{"status": "missing", "job": true, "missing_secrets": ["qdit_deliver_webhooks_url", "qdit_cron_secret"]}'::jsonb,
  'health: missing, naming both secrets'
);

select vault.create_secret('https://qdit.test/api/cron/deliver-webhooks', 'qdit_deliver_webhooks_url');
select is(pg_temp.run_job(), 0::bigint, 'nor with the URL but no bearer');
select is(
  public.webhook_scheduler_health(),
  '{"status": "missing", "job": true, "missing_secrets": ["qdit_cron_secret"]}'::jsonb,
  'health: missing, naming the bearer only'
);

select vault.create_secret('cron-secret-for-tests', 'qdit_cron_secret');
select pg_temp.run_job();
select results_eq(
  $$ select method, url, headers ->> 'Authorization', timeout_milliseconds
       from net.http_request_queue order by id desc limit 1 $$,
  $$ values ('GET'::text, 'https://qdit.test/api/cron/deliver-webhooks'::text,
             'Bearer cron-secret-for-tests'::text, 60000) $$,
  'with both, one GET to the route with the CRON_SECRET bearer and the route''s 60 s limit'
);
select is(
  public.webhook_scheduler_health(),
  '{"status": "configured", "job": true, "missing_secrets": []}'::jsonb,
  'health: configured'
);
select ok(
  public.webhook_scheduler_health()::text not like '%cron-secret-for-tests%'
  and public.webhook_scheduler_health()::text not like '%qdit.test%',
  'health names secrets, never their values'
);

update cron.job set active = false where jobname = 'qdit-deliver-webhooks';
select is(
  public.webhook_scheduler_health(),
  '{"status": "missing", "job": false, "missing_secrets": []}'::jsonb,
  'health: missing when the job is not active, even with both secrets'
);
update cron.job set active = true where jobname = 'qdit-deliver-webhooks';


-- ----------------------------------------------------------------------------
-- 3. Who may call what
-- ----------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.webhook_scheduler_health()', 'execute')
  and not has_function_privilege('anon', 'public.webhook_scheduler_health()', 'execute'),
  'health: not callable by a client'
);
select ok(
  has_function_privilege('service_role', 'public.webhook_scheduler_health()', 'execute'),
  'health: callable by service_role, for the cron route'
);
select ok(
  not has_function_privilege('authenticated', 'public.request_webhook_delivery()', 'execute')
  and not has_function_privilege('anon', 'public.request_webhook_delivery()', 'execute')
  and not has_function_privilege('service_role', 'public.request_webhook_delivery()', 'execute')
  and not has_function_privilege('authenticated', 'public.webhook_scheduler_missing_secrets()', 'execute')
  and not has_function_privilege('anon', 'public.webhook_scheduler_missing_secrets()', 'execute')
  and not has_function_privilege('service_role', 'public.webhook_scheduler_missing_secrets()', 'execute'),
  'the job function and the Vault helper are callable by no API role'
);
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('webhook_scheduler_health', 'request_webhook_delivery',
                        'webhook_scheduler_missing_secrets')),
  'the three functions are SECURITY DEFINER with search_path pinned'
);


select * from finish();

rollback;
