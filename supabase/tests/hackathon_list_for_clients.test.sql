-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/hackathon_list_for_clients.test.sql
--
-- Covers 20261111120000_hackathon_list_for_clients.sql (QDIT-60, WP-4.7,
-- D-122): list_open_hackathons_for_client(), the read behind
-- GET /api/v1/hackathons. Which hackathons it lists and which it leaves out
-- (hidden, `test-`, closed), the order, the shape of a row, who may call it,
-- and that the hackathons table itself stays closed to OAuth clients.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back.
--
-- The function lists every listed hackathon in the database, so a local
-- seed's would show up too: each check below reads only this file's rows
-- (slugs starting `hl-` or `test-hl-`), except the limit check, which only
-- needs at least 50 to exist.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(23);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- u1 is staff of the hidden hackathon, u2 nobody in particular.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('a6000000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated',
       'hl-' || n || '@qdit.test',
       '{"provider":"email","providers":["email"]}',
       jsonb_build_object('full_name', 'Hl ' || n, 'username', 'hl_u' || n),
       now(), now()
  from generate_series(1, 2) as n;

-- now() is the transaction's start, so the two `- 1 hour` rows share one
-- opens_at exactly, and the slug decides their order.
insert into public.hackathons (id, slug, name, opens_at, closes_at, hidden)
values
  -- listed
  -- 205 characters stored, 200 once trimmed: the most the table's check allows.
  ('c6000000-0000-4000-8000-000000000001', 'hl-early',    '   ' || repeat('Ab', 100) || '  ', now() - interval '2 hours',  now() + interval '3 hours', false),
  ('c6000000-0000-4000-8000-000000000002', 'hl-open-b',   'Open B',       now() - interval '1 hour',   now() + interval '1 hour',  false),
  ('c6000000-0000-4000-8000-000000000003', 'hl-open-a',   '  Padded  ',   now() - interval '1 hour',   now() + interval '1 hour',  false),
  ('c6000000-0000-4000-8000-000000000004', 'hl-test-mid', 'Test in the middle', now() - interval '30 minutes', now() + interval '1 hour', false),
  ('c6000000-0000-4000-8000-000000000005', 'hl-soon',     'Soon',         now() + interval '1 day',    now() + interval '2 days',  false),
  -- left out
  ('c6000000-0000-4000-8000-000000000006', 'hl-hidden',   'Hidden',       now() - interval '1 hour',   now() + interval '1 hour',  true),
  ('c6000000-0000-4000-8000-000000000007', 'test-hl-rehearsal', 'Rehearsal', now() - interval '1 hour', now() + interval '1 hour', false),
  ('c6000000-0000-4000-8000-000000000008', 'hl-closed',   'Closed',       now() - interval '3 days',   now() - interval '2 days',  false),
  -- closes_at = the transaction's start: already past by the time it runs.
  ('c6000000-0000-4000-8000-000000000009', 'hl-just-closed', 'Just closed', now() - interval '1 day', now(),                    false);

insert into public.hackathon_staff (hackathon_id, user_id, role)
values ('c6000000-0000-4000-8000-000000000006', 'a6000000-0000-4000-8000-000000000001', 'admin');


-- ----------------------------------------------------------------------------
-- Caller switches
-- ----------------------------------------------------------------------------

create function pg_temp.as_session(p_user uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'aud', 'authenticated'
  )::text, true);
$$;

-- Not doqtri's client on purpose: any authorised app may list (D-122).
create function pg_temp.as_oauth_client(
  p_user uuid,
  p_client text default '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a'
) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aud', 'authenticated',
    'client_id', p_client,
    'iat', floor(extract(epoch from now()))::bigint - 60
  )::text, true);
$$;

create function pg_temp.as_anon() returns void
language sql as $$
  select set_config('role', 'anon', true);
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

create function pg_temp.as_postgres() returns void
language sql as $$
  select set_config('role', 'postgres', true);
  select set_config('request.jwt.claims', '', true);
$$;

-- This file's rows from the list, as 'slug:state', in the order returned.
create function pg_temp.listed() returns text[]
language sql as $$
  select coalesce(array_agg(l.slug || ':' || l.state order by l.ord), '{}')
    from (
      select r.slug, r.state, row_number() over () as ord
        from public.list_open_hackathons_for_client() r
    ) l
   where l.slug like 'hl-%' or l.slug like 'test-hl-%';
$$;

grant execute on all functions in schema pg_temp to anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 1. Shape of the function
-- ----------------------------------------------------------------------------

select ok(
  (select p.prosecdef from pg_catalog.pg_proc p
    where p.oid = 'public.list_open_hackathons_for_client()'::regprocedure),
  'SECURITY DEFINER'
);

select ok(
  (select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p
    where p.oid = 'public.list_open_hackathons_for_client()'::regprocedure),
  'search_path is pinned to empty'
);

select is(
  pg_catalog.pg_get_function_result('public.list_open_hackathons_for_client()'::regprocedure),
  'TABLE(slug text, name text, opens_at timestamp with time zone, closes_at timestamp with time zone, state text)',
  'returns exactly slug, name, opens_at, closes_at, state'
);

select ok(
  has_function_privilege('authenticated', 'public.list_open_hackathons_for_client()', 'execute')
  and not has_function_privilege('anon', 'public.list_open_hackathons_for_client()', 'execute'),
  'authenticated may execute it, anon may not'
);


-- ----------------------------------------------------------------------------
-- 2. What an OAuth app gets
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a6000000-0000-4000-8000-000000000002');

select is(
  pg_temp.listed(),
  array['hl-early:open', 'hl-open-a:open', 'hl-open-b:open', 'hl-test-mid:open', 'hl-soon:upcoming'],
  'open and upcoming, opens_at then slug; hidden, test-, closed and just-closed left out'
);

select is(
  (select r.name from public.list_open_hackathons_for_client() r where r.slug = 'hl-open-a'),
  'Padded',
  'name comes back trimmed'
);

-- hl-early is stored as 3 spaces + 200 characters + 2 spaces (205).
select is(
  (select char_length(r.name) || ':' || (r.name = repeat('Ab', 100))
     from public.list_open_hackathons_for_client() r
    where r.slug = 'hl-early'),
  '200:true',
  'a 200-character name stored with surrounding spaces comes back trimmed to exactly those 200'
);

select is(
  (select r.opens_at || '|' || r.closes_at from public.list_open_hackathons_for_client() r where r.slug = 'hl-soon'),
  (now() + interval '1 day') || '|' || (now() + interval '2 days'),
  'opens_at and closes_at are the hackathon''s own'
);

select is(
  (select array_agg(distinct r.state order by r.state) from public.list_open_hackathons_for_client() r),
  array['open', 'upcoming'],
  'state is only ever open or upcoming'
);

select is_empty(
  $$ select 1 from public.list_open_hackathons_for_client() r
      where r.slug in ('hl-hidden', 'test-hl-rehearsal', 'hl-closed', 'hl-just-closed') $$,
  'none of the left-out ones appears, by slug'
);


-- ----------------------------------------------------------------------------
-- 3. The table stays closed to apps
-- ----------------------------------------------------------------------------

select is(
  (select count(*)::int from public.hackathons h where h.slug like 'hl-%' or h.slug like 'test-hl-%'),
  0,
  'an app still reads no hackathons row directly (restrictive SELECT guard)'
);

select pg_temp.as_postgres();

select is(
  (select p.permissive || ':' || p.cmd || ':' || p.qual
     from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'hackathons'
      and p.policyname = 'hackathons: no select by oauth clients'),
  'RESTRICTIVE:SELECT:((( SELECT auth.jwt() AS jwt) ->> ''client_id''::text) IS NULL)',
  'the hackathons OAuth SELECT guard is unchanged'
);


-- ----------------------------------------------------------------------------
-- 4. First-party sessions, staff included
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a6000000-0000-4000-8000-000000000002');

select is(
  pg_temp.listed(),
  array['hl-early:open', 'hl-open-a:open', 'hl-open-b:open', 'hl-test-mid:open', 'hl-soon:upcoming'],
  'a first-party session gets the same list'
);

select pg_temp.as_session('a6000000-0000-4000-8000-000000000001');

select is(
  pg_temp.listed(),
  array['hl-early:open', 'hl-open-a:open', 'hl-open-b:open', 'hl-test-mid:open', 'hl-soon:upcoming'],
  'the hidden hackathon''s own admin does not get it listed either'
);

select is(
  (select count(*)::int from public.hackathons h where h.slug like 'hl-%' or h.slug like 'test-hl-%'),
  9,
  'while that session still reads every row directly, as before'
);


-- ----------------------------------------------------------------------------
-- 5. Who is refused
-- ----------------------------------------------------------------------------

select pg_temp.as_anon();

select throws_ok(
  $$ select * from public.list_open_hackathons_for_client() $$,
  '42501', null,
  'anon is refused'
);

-- A signed-in role with no user in its claims.
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select throws_ok(
  $$ select * from public.list_open_hackathons_for_client() $$,
  '42501', 'Sign in first.',
  'no user, no list'
);

select pg_temp.as_postgres();
insert into public.oauth_client_revocations (user_id, client_id, revoked_at)
values ('a6000000-0000-4000-8000-000000000002', '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a', now());

select pg_temp.as_oauth_client('a6000000-0000-4000-8000-000000000002');

select throws_ok(
  $$ select * from public.list_open_hackathons_for_client() $$,
  '42501', 'This app''s access to qdit was revoked.',
  'a token issued before its user disconnected the app is refused'
);

select pg_temp.as_oauth_client('a6000000-0000-4000-8000-000000000001');

select is(
  array_length(pg_temp.listed(), 1),
  5,
  'the same app for another user, who did not disconnect it, still lists'
);

select pg_temp.as_oauth_client('a6000000-0000-4000-8000-000000000001', 'not-a-uuid');

select throws_ok(
  $$ select * from public.list_open_hackathons_for_client() $$,
  '42501', 'This app''s access to qdit was revoked.',
  'a client_id that is not a UUID counts as revoked (D-96)'
);


-- ----------------------------------------------------------------------------
-- 6. At most 50
-- ----------------------------------------------------------------------------

select pg_temp.as_postgres();

insert into public.hackathons (slug, name, opens_at, closes_at)
select 'hl-bulk-' || lpad(n::text, 2, '0'), 'Bulk ' || n,
       now() + make_interval(hours => n), now() + make_interval(hours => n + 1)
  from generate_series(1, 55) as n;

select pg_temp.as_oauth_client('a6000000-0000-4000-8000-000000000001');

select is(
  (select count(*)::int from public.list_open_hackathons_for_client()),
  50,
  'at most 50 rows'
);

select is(
  (pg_temp.listed())[1:6],
  array['hl-early:open', 'hl-open-a:open', 'hl-open-b:open', 'hl-test-mid:open', 'hl-bulk-01:upcoming', 'hl-bulk-02:upcoming'],
  'the limit keeps the earliest opens_at, and the order holds across them'
);

-- 5 of this file's rows open before the bulk ones and 50 fit: hl-bulk-01 to
-- hl-bulk-45 make the cut (fewer if a local seed lists earlier ones), so the
-- latest bulk rows never do.
select is_empty(
  $$ select r.slug from public.list_open_hackathons_for_client() r
      where r.slug in ('hl-bulk-46', 'hl-bulk-50', 'hl-bulk-55') $$,
  'the latest-opening rows past the limit are left out'
);


select * from finish();

rollback;
