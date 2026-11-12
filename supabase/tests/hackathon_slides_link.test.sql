-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/hackathon_slides_link.test.sql
--
-- Covers 20261112120000_hackathon_slides_link.sql (QDIT-63, WP-4.7, D-123):
-- which links hackathon_slides_url_ok() accepts, the column's check and
-- grant, and that submit_hackathon_entry() now has exactly the six-argument
-- form with its old privileges. What the RPC does with the link (refusals,
-- stored trimmed) is in hackathons.test.sql, beside the other submit checks.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);


-- ----------------------------------------------------------------------------
-- 1. Accepted links
-- ----------------------------------------------------------------------------

select ok(public.hackathon_slides_url_ok('https://docs.google.com/presentation/d/1Nxqlqy11bYYONGM-ABCw0T56_NII05L4/edit?usp=sharing'),
  'Google Slides edit link');
select ok(public.hackathon_slides_url_ok('https://docs.google.com/presentation/d/1Nxqlqy11bYYONGM'),
  'Google Slides link with no path after the id');
select ok(public.hackathon_slides_url_ok('https://docs.google.com/presentation/u/1/d/1Nxqlqy11bYYONGM/view'),
  'Google Slides link with an account segment');
select ok(public.hackathon_slides_url_ok('https://docs.google.com/presentation/d/e/2PACX-1vQabc/pub?start=false'),
  'Google Slides published-to-web link');
select ok(public.hackathon_slides_url_ok('https://DOCS.Google.com/presentation/d/abc/edit'),
  'host is case-insensitive');
select ok(public.hackathon_slides_url_ok('https://drive.google.com/file/d/1BdpwiyGm-_FyzfV2ttr0is/view?usp=sharing'),
  'a deck file on Google Drive');
select ok(public.hackathon_slides_url_ok('https://onedrive.live.com/edit?id=ABC123&resid=ABC123!101&cid=abc'),
  'PowerPoint on OneDrive');
select ok(public.hackathon_slides_url_ok('https://1drv.ms/p/s!AbCdEfGh'),
  'OneDrive short link');
select ok(public.hackathon_slides_url_ok('https://contoso.sharepoint.com/:p:/s/team/EabCdEf?e=xyz'),
  'PowerPoint on SharePoint');
select ok(public.hackathon_slides_url_ok('https://contoso-my.sharepoint.com/personal/a_b/Documents/deck.pptx'),
  'PowerPoint on a personal SharePoint site');


-- ----------------------------------------------------------------------------
-- 2. Refused links
-- ----------------------------------------------------------------------------

select ok(not public.hackathon_slides_url_ok(null), 'null');
select ok(not public.hackathon_slides_url_ok(''), 'empty');
select ok(not public.hackathon_slides_url_ok('http://docs.google.com/presentation/d/abc/edit'), 'plain http');
select ok(not public.hackathon_slides_url_ok('docs.google.com/presentation/d/abc/edit'), 'no scheme');
select ok(not public.hackathon_slides_url_ok('https://docs.google.com/document/d/abc/edit'), 'a Google Doc, not Slides');
select ok(not public.hackathon_slides_url_ok('https://docs.google.com/presentation/'), 'Slides with no deck id');
select ok(not public.hackathon_slides_url_ok('https://docs.google.com.example.com/presentation/d/abc'), 'look-alike Google host');
select ok(not public.hackathon_slides_url_ok('https://contoso.sharepoint.com@example.com/deck'), 'SharePoint host with userinfo');
select ok(not public.hackathon_slides_url_ok('https://sharepoint.com.example.com/deck'), 'look-alike SharePoint host');
select ok(not public.hackathon_slides_url_ok('https://drive.google.com/drive/folders/abc'), 'a Drive folder');
select ok(not public.hackathon_slides_url_ok('https://example.com/deck.pptx'), 'any other host');
select ok(not public.hackathon_slides_url_ok('https://docs.google.com/presentation/d/abc/edit x'), 'whitespace inside');
select ok(not public.hackathon_slides_url_ok(E'https://docs.google.com/presentation/d/abc\n'), 'a newline');
select ok(not public.hackathon_slides_url_ok('https://docs.google.com/presentation/d/abc/' || repeat('a', 2048)),
  'over 2,048 characters');


-- ----------------------------------------------------------------------------
-- 3. Column, check and grant
-- ----------------------------------------------------------------------------

select col_is_null('public', 'hackathon_submission_versions', 'slides_url',
  'slides_url is nullable (versions from before the migration)');

select ok(
  exists (select 1 from pg_catalog.pg_constraint
           where conname = 'hackathon_submission_versions_slides_url_check'
             and conrelid = 'public.hackathon_submission_versions'::regclass
             and contype = 'c'),
  'the column carries the hackathon_slides_url_ok check'
);

select ok(
  has_column_privilege('authenticated', 'public.hackathon_submission_versions', 'slides_url', 'select')
  and not has_column_privilege('anon', 'public.hackathon_submission_versions', 'slides_url', 'select'),
  'authenticated may select slides_url (under the row policy); anon may not'
);


-- ----------------------------------------------------------------------------
-- 4. The RPC's signature and privileges
-- ----------------------------------------------------------------------------

select results_eq(
  $$ select pg_catalog.pg_get_function_identity_arguments(p.oid)::text
       from pg_catalog.pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_hackathon_entry' $$,
  $$ values ('p_hackathon_id uuid, p_project_id uuid, p_team_name text, p_member_ids uuid[], p_image_paths text[], p_slides_url text'::text) $$,
  'submit_hackathon_entry exists only in its six-argument form'
);

select ok(
  (select p.prosecdef
          and p.proconfig = array['search_path=""']
          and not has_function_privilege('anon', p.oid, 'execute')
          and has_function_privilege('authenticated', p.oid, 'execute')
     from pg_catalog.pg_proc p
    where p.oid = 'public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[], text)'::regprocedure),
  'submit_hackathon_entry: security definer, empty search_path, authenticated only'
);

select ok(
  not has_function_privilege('anon', 'public.hackathon_slides_url_ok(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.hackathon_slides_url_ok(text)', 'execute'),
  'hackathon_slides_url_ok is internal: neither anon nor authenticated may call it'
);


select * from finish();

rollback;
