-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261025090000_integration_hardening.sql
--
-- Hardening of the doqtri integration (WP-2.9), on top of
-- 20261024120000_integration_links.sql.
--
-- ---------------------------------------------------------------------------
-- 1. DOC LINKS ARE WRITTEN ONLY BY link_project_doc() (D-48)
-- ---------------------------------------------------------------------------
-- Until now a project admin could INSERT or UPDATE project_doc_links directly
-- through PostgREST, with their own qdit session, past the API and its D-45
-- origin check. Nothing in qdit's UI does that (linking happens in doqtri,
-- D-10), so the door only served hand-made requests.
--
-- It is closed twice:
--
--   * INSERT and UPDATE are revoked from authenticated and anon. A direct
--     write is `permission denied` before any policy is looked at.
--   * The permissive INSERT and UPDATE policies are dropped, and the OAuth
--     guards for those two commands are replaced by restrictive policies that
--     are `false` for everyone. Should a later grant reopen the table, RLS
--     still refuses the write. (The guard tripwire in
--     supabase/tests/oauth_client_guards.test.sql wants a restrictive policy
--     per command on every table; these are those.)
--
-- link_project_doc() is SECURITY DEFINER and owned by the table's owner,
-- which RLS does not bind (the table does not FORCE it), so the one write
-- path keeps working. It already does everything the direct path lacked:
--
--   * the role: assert_project_role(p_project_id, 'admin') first, so not_found
--     for an outsider and forbidden below admin (D-23);
--   * the https rule: `doc_url` lands in the column, whose CHECK holds it to a
--     plain https URL (D-45). doqtri's origin is deployment config, so the API
--     route checks that part (POST /api/v1/projects/{id}/docs);
--   * the frozen columns: `linked_by` is auth.uid(), never a parameter; the
--     re-post refresh sets only `doc_title` and `doc_url`, and only when the
--     doc is linked to the same project; check_project_doc_link() still
--     refuses any other change for every caller, the function included.
--
-- SELECT and DELETE are unchanged: viewers read, admins unlink (D-22, D-23),
-- and an app may delete as before (D-03). The service role and direct
-- database sessions keep their access; they are operators, not users.
--
-- ---------------------------------------------------------------------------
-- 2. THE WEBHOOK SCHEDULER SAYS WHEN IT IS NOT CONFIGURED (D-57)
-- ---------------------------------------------------------------------------
-- The pg_cron job of 20261024130000_integration_webhooks.sql (section 8)
-- reads the route's URL and the CRON_SECRET from Vault at each run and does
-- nothing while either is missing. Nothing said so: an environment whose
-- operator never stored them delivered once a day (the Vercel backstop) and
-- looked healthy. Now:
--
--   * the job calls request_webhook_delivery(), which RAISEs a WARNING naming
--     the missing secret(s) on every run that sends nothing because of them,
--     so pg_cron's run log and the Postgres log show it each minute;
--   * this migration RAISEs the same WARNING when it runs in a database that
--     has the scheduler but not the secrets (every fresh environment, until
--     the operator stores them);
--   * webhook_scheduler_health() answers `configured`, `missing` (with the
--     names) or `unavailable` (no pg_cron, pg_net or Vault here), for the
--     service role only. GET /api/cron/deliver-webhooks returns it with each
--     run and logs a warning when it is not `configured`, so the daily Vercel
--     run, or an operator calling the route with the CRON_SECRET, sees it.
--     qdit has no webhook settings page to show it on: webhooks are rows an
--     operator writes in the SQL editor (20261024130000, header).
--
-- Names are reported, never values. The functions read Vault as their
-- owner, and no client may call them; the route reaches the health signal
-- with the service role.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. project_doc_links: no direct INSERT or UPDATE (D-48)
-- ----------------------------------------------------------------------------

revoke insert, update on table public.project_doc_links from authenticated, anon;

drop policy "project_doc_links: insert as admin"                   on public.project_doc_links;
drop policy "project_doc_links: update as admin"                   on public.project_doc_links;
drop policy "project_doc_links: oauth clients insert as their user" on public.project_doc_links;
drop policy "project_doc_links: no update by oauth clients"        on public.project_doc_links;

create policy "project_doc_links: no direct insert (D-48)"
  on public.project_doc_links
  as restrictive
  for insert
  to public
  with check (false);

create policy "project_doc_links: no direct update (D-48)"
  on public.project_doc_links
  as restrictive
  for update
  to public
  using (false)
  with check (false);

comment on table public.project_doc_links is
  'A doqtri doc linked to a qdit project (D-09: one project per doc, many docs per project). Copies of the doc title and URL only; doqtri owns the doc. Written only by link_project_doc() (D-48); clients read and delete.';


-- ----------------------------------------------------------------------------
-- 2. The webhook scheduler: a warning when Vault is missing its secrets (D-57)
-- ----------------------------------------------------------------------------

-- The Vault secrets the job needs and that are missing, by name, in a fixed
-- order. Empty when both are stored. Assumes Vault exists; callers check.
-- PL/pgSQL rather than SQL so it can be created where Vault is absent: a SQL
-- function's body is checked against the catalog when it is created.
create or replace function public.webhook_scheduler_missing_secrets()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
    select coalesce(array_agg(n.name order by n.ord), '{}')
      from (values (1, 'qdit_deliver_webhooks_url'), (2, 'qdit_cron_secret')) as n (ord, name)
     where not exists (
       select 1 from vault.decrypted_secrets d
        where d.name = n.name
          and d.decrypted_secret is not null
     )
  );
end;
$$;

comment on function public.webhook_scheduler_missing_secrets() is
  'Names of the Vault secrets the qdit-deliver-webhooks job needs (qdit_deliver_webhooks_url, qdit_cron_secret) that are not stored. Never returns a value.';


-- What the pg_cron job runs every minute: one GET of the delivery route with
-- the CRON_SECRET bearer, or, while a secret is missing, a WARNING and
-- nothing else. Returns the pg_net request id, or null when nothing was sent.
create or replace function public.request_webhook_delivery()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_missing text[] := public.webhook_scheduler_missing_secrets();
begin
  if cardinality(v_missing) > 0 then
    raise warning 'qdit-deliver-webhooks: Vault secret(s) % not stored; webhooks are not delivered by the database, only by the daily Vercel cron',
      array_to_string(v_missing, ', ')
      using hint = 'Store them with vault.create_secret(), see supabase/migrations/20261024130000_integration_webhooks.sql section 8.';
    return null;
  end if;

  return net.http_get(
    url := (select d.decrypted_secret from vault.decrypted_secrets d
             where d.name = 'qdit_deliver_webhooks_url'),
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select d.decrypted_secret from vault.decrypted_secrets d
                     where d.name = 'qdit_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
end;
$$;

comment on function public.request_webhook_delivery() is
  'Run by the qdit-deliver-webhooks pg_cron job: GETs /api/cron/deliver-webhooks with the URL and bearer from Vault, or RAISEs WARNING naming the missing secret(s) and sends nothing (D-57).';


-- The health signal. `unavailable` when this database has no pg_cron, pg_net
-- or Vault (the daily Vercel cron is then all that delivers), `missing` when
-- it has them but the job is not scheduled or a secret is not stored, and
-- `configured` otherwise. `job` says whether the job exists and is active.
create or replace function public.webhook_scheduler_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job     boolean;
  v_missing text[];
begin
  if to_regclass('cron.job') is null
     or to_regnamespace('net') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return jsonb_build_object('status', 'unavailable', 'job', false, 'missing_secrets', '[]'::jsonb);
  end if;

  v_job := exists (
    select 1 from cron.job j
     where j.jobname = 'qdit-deliver-webhooks'
       and j.active
  );
  v_missing := public.webhook_scheduler_missing_secrets();

  return jsonb_build_object(
    'status', case when v_job and cardinality(v_missing) = 0 then 'configured' else 'missing' end,
    'job', v_job,
    'missing_secrets', to_jsonb(v_missing)
  );
end;
$$;

comment on function public.webhook_scheduler_health() is
  'SECURITY DEFINER, service_role only. {status: configured | missing | unavailable, job, missing_secrets}: whether the pg_cron webhook delivery job can run (D-57). Names only, never secret values.';


revoke all on function public.webhook_scheduler_missing_secrets() from public, anon, authenticated, service_role;
revoke all on function public.request_webhook_delivery()          from public, anon, authenticated, service_role;
revoke all on function public.webhook_scheduler_health()          from public, anon, authenticated;
grant execute on function public.webhook_scheduler_health() to service_role;


-- The job now runs request_webhook_delivery() instead of its own inline
-- query; the same name replaces it. Skipped, as before, where the scheduler
-- is not there, and then the earlier migration has already said so.
do $schedule$
declare
  v_health jsonb;
begin
  if to_regprocedure('cron.schedule(text, text, text)') is null
     or to_regnamespace('net') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;

  perform cron.schedule(
    'qdit-deliver-webhooks',
    '* * * * *',
    'select public.request_webhook_delivery()'
  );

  v_health := public.webhook_scheduler_health();
  if jsonb_array_length(v_health -> 'missing_secrets') > 0 then
    raise warning 'integration webhooks: the qdit-deliver-webhooks job will send nothing until Vault holds %',
      (select string_agg(x, ', ') from jsonb_array_elements_text(v_health -> 'missing_secrets') as x)
      using hint = 'Store them with vault.create_secret(), see supabase/migrations/20261024130000_integration_webhooks.sql section 8.';
  end if;
end;
$schedule$;
