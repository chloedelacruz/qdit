-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260731000003_function_grants.sql
--
-- Execute privileges on the functions created in 20260731000001_init.sql and
-- 20260731000002_rls.sql.
--
-- BACKFILLED. This ran against the hosted project on 2026-07-31 as migration
-- `20260731133429_function_grants` and was never committed. Recovered from
-- supabase_migrations.schema_migrations on 2026-08-09 and written here verbatim
-- so the repository can describe the deployed schema. Do not re-run it against
-- that project; it is already applied.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and Supabase
-- exposes `anon` and `authenticated` to the internet through PostgREST. So a
-- freshly created function is callable by anyone who can reach the API unless
-- it is explicitly revoked.
--
-- That matters twice over here:
--
--   * The trigger functions have no business being called directly at all.
--     `handle_new_project` inserts an owner membership row; invoking it by hand
--     is not a use case, it is a way to get one.
--   * The RLS helpers are SECURITY DEFINER, so they execute as their owner with
--     RLS switched off. They are written to be safe (see the header of the RLS
--     migration), but "safe to call" is not a reason to leave them reachable by
--     an unauthenticated role.
--
-- The `alter default privileges` lines close the same hole for functions added
-- later, so a future migration that forgets to revoke does not reopen it.
-- ============================================================================

-- Trigger functions: called by Postgres, never by a client.
revoke all on function public.set_updated_at()      from public, anon, authenticated;
revoke all on function public.handle_new_user()     from public, anon, authenticated;
revoke all on function public.handle_new_project()  from public, anon, authenticated;

-- RLS helpers: needed by signed-in users, never by anonymous ones.
revoke all on function public.member_role_rank(public.member_role) from public, anon;
revoke all on function public.is_project_member(uuid, text)        from public, anon;
revoke all on function public.shares_project_with(uuid)            from public, anon;

grant execute on function public.member_role_rank(public.member_role) to authenticated, service_role;
grant execute on function public.is_project_member(uuid, text)        to authenticated, service_role;
grant execute on function public.shares_project_with(uuid)            to authenticated, service_role;

-- Anything created in public from now on starts unreachable by anon.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
