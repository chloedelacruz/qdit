-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/integration_webhooks_schedule.test.sql
--
-- Covers section 8 of 20261024130000_integration_webhooks.sql: the pg_cron
-- job that calls /api/cron/deliver-webhooks every minute through pg_net, with
-- the URL and the bearer read from Vault at run time.
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

select plan(5);


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
select ok(
  (select command like '%vault.decrypted_secrets%'
          and command like '%''qdit_deliver_webhooks_url''%'
          and command like '%''qdit_cron_secret''%'
          and command like '%''Bearer '' || s.secret%'
     from cron.job where jobname = 'qdit-deliver-webhooks'),
  'the job holds no secret; it reads them from Vault'
);


-- ----------------------------------------------------------------------------
-- 2. What it sends
-- ----------------------------------------------------------------------------

-- Whatever this environment already stores is set aside for the test.
delete from vault.secrets where name in ('qdit_deliver_webhooks_url', 'qdit_cron_secret');

select is(pg_temp.run_job(), 0::bigint, 'with no secrets stored the job sends nothing');

select vault.create_secret('https://qdit.test/api/cron/deliver-webhooks', 'qdit_deliver_webhooks_url');
select is(pg_temp.run_job(), 0::bigint, 'nor with the URL but no bearer');

select vault.create_secret('cron-secret-for-tests', 'qdit_cron_secret');
select pg_temp.run_job();
select results_eq(
  $$ select method, url, headers ->> 'Authorization', timeout_milliseconds
       from net.http_request_queue order by id desc limit 1 $$,
  $$ values ('GET'::text, 'https://qdit.test/api/cron/deliver-webhooks'::text,
             'Bearer cron-secret-for-tests'::text, 60000) $$,
  'with both, one GET to the route with the CRON_SECRET bearer and the route''s 60 s limit'
);


select * from finish();

rollback;
