-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261112140000_hackathon_mindmap_link.sql
--
-- QDIT-66 (WP-4.7, DOQ-53): a link to the team's public mindmap page on
-- doqtri, sent with the snapshot and kept on the submission version, so
-- judges open the live map instead of squinting at an exported PNG.
--
-- ---------------------------------------------------------------------------
-- WHY ON THE VERSION TOO
-- ---------------------------------------------------------------------------
-- doqtri hosts the page at <doqtri origin>/m/<token> and sends that URL as
-- the optional `mindmap_url` of POST /api/v1/projects/{id}/hackathon-snapshots
-- (contract v1.4.0, section 8). Snapshots are pruned 90 days after a
-- released hackathon closes and the version then keeps a null
-- doqtri_snapshot_id, so a link kept only on the snapshot would disappear
-- with it. The submit dialog prefills the field from the newest snapshot and
-- the link is frozen on the version, like the Slides link (D-123).
--
-- Images stay required. Eligibility (global_mindmap_image), the grader and
-- the image columns are not touched.
--
-- ---------------------------------------------------------------------------
-- WHAT
-- ---------------------------------------------------------------------------
--   1. hackathon_mindmap_url_ok(text)
--        The shape, for the two columns' checks: https, a lowercase host
--        with an optional port, then exactly /m/ and a token of 22 to 64
--        characters of [A-Za-z0-9_-], and nothing after it (no slash, query
--        or fragment). Immutable: which host is doqtri's is per-environment
--        config, not data, so a check constraint cannot hold it.
--   2. hackathon_mindmap_url_allowed(text)
--        The shape, and the host: when integration_settings.doqtri_origin is
--        set, the link must start with it and /m/, byte for byte (the D-95
--        rule, as link_project_doc() applies it to doc_url). While it is
--        unset only the shape is checked here; the API and the submit action
--        check DOQTRI_ORIGIN either way (web/src/lib/doqtri-origin.ts,
--        isDoqtriMindmapUrl, which mirrors both).
--   3. hackathon_doqtri_snapshots.mindmap_url
--        The link as doqtri sent it, null when the body left it out or sent
--        null. Readable under the table's existing grant and row policy (the
--        project's members, the hackathon's staff).
--   4. hackathon_submission_versions.mindmap_url
--        The link as the team submitted it, trimmed; null when none.
--        Granted to authenticated like slides_url.
--   5. push_doqtri_hackathon_snapshot(), same signature
--        Reads `mindmap_url` from the payload: a string is checked with (2)
--        and stored in (3); left out or JSON null stores null; any other
--        JSON type is refused. Checked with the other arguments, before the
--        replay test. Idempotency is unchanged: the key and the raw-body
--        hash decide replay and conflict, so the same snapshot_id with
--        another link is snapshot_conflict as any other body change is.
--   6. submit_hackathon_entry(uuid, uuid, text, uuid[], text[], text, text)
--        Replaces the six-argument version. p_mindmap_url is optional
--        (default null; blank is null), checked with (2) after the Slides
--        link, so every earlier refusal is unchanged; stored trimmed.
--
-- Errors (adds to the headers of 20261110100000_hackathons.sql and
-- 20261112062735_hackathon_slides_link.sql):
--   22023  hint mindmap_url: from submit_hackathon_entry(), a link (2)
--          refuses; from push_doqtri_hackathon_snapshot(), a payload
--          `mindmap_url` that is not a string or null, or one (2) refuses.
--          /api/v1 answers both as 400 invalid_request on `mindmap_url`.
--
-- Apply before deploying the qdit code that sends p_mindmap_url, and deploy
-- that code before doqtri sends links (runbook 1.9). The old app keeps
-- working against this migration: it calls submit_hackathon_entry() with six
-- named arguments, which the default covers, and its API route refuses a
-- body with `mindmap_url` before the database sees it.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The shape
-- ----------------------------------------------------------------------------

create or replace function public.hackathon_mindmap_url_ok(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
     and char_length(p_url) <= 2048
     and p_url ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?/m/[A-Za-z0-9_-]{22,64}$';
$$;

comment on function public.hackathon_mindmap_url_ok(text) is
  'Internal (QDIT-66). True when p_url is https://<lowercase host>[:port]/m/<token>, the token 22 to 64 of [A-Za-z0-9_-] with nothing after it. The shape only, for the mindmap_url checks; hackathon_mindmap_url_allowed() adds doqtri''s origin.';

revoke all on function public.hackathon_mindmap_url_ok(text) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. The shape and doqtri's origin
-- ----------------------------------------------------------------------------

create or replace function public.hackathon_mindmap_url_allowed(p_url text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.hackathon_mindmap_url_ok(p_url)
     and coalesce(
           (select left(p_url, char_length(s.doqtri_origin) + 3) = s.doqtri_origin || '/m/'
              from public.integration_settings s
             where s.doqtri_origin is not null),
           true);
$$;

comment on function public.hackathon_mindmap_url_allowed(text) is
  'Internal (QDIT-66, D-95). hackathon_mindmap_url_ok(p_url), and when integration_settings.doqtri_origin is set, p_url starts with it followed by /m/. Used by push_doqtri_hackathon_snapshot() and submit_hackathon_entry(); web/src/lib/doqtri-origin.ts (isDoqtriMindmapUrl) mirrors it with DOQTRI_ORIGIN.';

revoke all on function public.hackathon_mindmap_url_allowed(text) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3, 4. The columns
-- ----------------------------------------------------------------------------

alter table public.hackathon_doqtri_snapshots
  add column mindmap_url text,
  add constraint hackathon_doqtri_snapshots_mindmap_url_check
    check (mindmap_url is null or public.hackathon_mindmap_url_ok(mindmap_url));

comment on column public.hackathon_doqtri_snapshots.mindmap_url is
  'The payload''s mindmap_url: doqtri''s public mindmap page for this snapshot (QDIT-66, DOQ-53). Null when doqtri sent none, and on every snapshot received before 20261112140000.';

alter table public.hackathon_submission_versions
  add column mindmap_url text,
  add constraint hackathon_submission_versions_mindmap_url_check
    check (mindmap_url is null or public.hackathon_mindmap_url_ok(mindmap_url));

comment on column public.hackathon_submission_versions.mindmap_url is
  'The team''s Mindmap link, as submitted (QDIT-66). Optional: null when the team left it empty, and on every version submitted before 20261112140000. Kept here so it outlives the snapshot''s 90-day retention.';

grant select (mindmap_url) on table public.hackathon_submission_versions to authenticated;


-- ----------------------------------------------------------------------------
-- 5. push_doqtri_hackathon_snapshot, storing the link
--
-- The body from 20261110100000_hackathons.sql, with the mindmap_url check in
-- step (2) and the column in the insert. Signature and grants are unchanged.
-- ----------------------------------------------------------------------------

create or replace function public.push_doqtri_hackathon_snapshot(
  p_hackathon_slug text,
  p_project_id     uuid,
  p_snapshot_id    uuid,
  p_workspace_id   uuid,
  p_payload        jsonb,
  p_payload_sha256 text,
  p_note_count     integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_client   text := auth.jwt() ->> 'client_id';
  v_doqtri   uuid;
  v_existing public.hackathon_doqtri_snapshots;
  v_h        public.hackathons;
  v_row      public.hackathon_doqtri_snapshots;
  v_replay   boolean := false;
  v_current  uuid;
  v_has_sub  boolean;
  v_link     text;
begin
  -- (0) Only through an app, and only doqtri's (D-117, D-61). A revoked
  -- token is refused before anything else (D-75, D-96).
  if v_client is null then
    raise exception 'Hackathon snapshots are sent from doqtri, through its connection to qdit.'
      using errcode = '42501';
  end if;

  if public.oauth_token_revoked() then
    raise exception 'This app''s access to qdit was revoked.' using errcode = '42501';
  end if;

  select s.doqtri_oauth_client_id into v_doqtri from public.integration_settings s;

  -- Nested, not OR-ed: SQL does not promise to test the shape before the
  -- cast. (A non-UUID client_id is already "revoked" above, D-96.)
  if v_doqtri is null
     or v_client !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Only doqtri can send hackathon snapshots.' using errcode = '42501';
  end if;
  if v_client::uuid <> v_doqtri then
    raise exception 'Only doqtri can send hackathon snapshots.' using errcode = '42501';
  end if;

  -- (1) P0002 outside the project, 42501 below admin.
  perform public.assert_project_role(p_project_id, 'admin');

  -- (2) Arguments. The route validated the payload's shape.
  if p_snapshot_id is null then
    raise exception 'snapshot_id is required.' using errcode = '22023', hint = 'snapshot_id';
  end if;
  if p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'payload_sha256 must be 64 lowercase hex characters.'
      using errcode = '22023', hint = 'payload_sha256';
  end if;
  if p_note_count is null or p_note_count not between 0 and 200 then
    raise exception 'note_count must be 0 to 200.' using errcode = '22023', hint = 'note_count';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_workspace_id is null
     or jsonb_typeof(p_payload -> 'notes') is distinct from 'array' then
    raise exception 'payload must be a JSON object with a notes array and a workspace.'
      using errcode = '22023', hint = 'payload';
  end if;
  -- Defence in depth only (D-118). The route enforces the contract's exact
  -- 2 MiB on the raw request bytes; here only jsonb's text form can be
  -- measured, and it adds a space after every `:` and `,`, so a compact body
  -- just under 2 MiB reads as more than 2 MiB. 3 MiB leaves room for that
  -- and still bounds what one row can hold.
  if octet_length(p_payload::text) > 3145728 then
    raise exception 'payload_too_large'
      using errcode = 'QD413', detail = 'A hackathon snapshot is at most 2 MiB as sent.';
  end if;
  if p_note_count <> jsonb_array_length(p_payload -> 'notes') then
    raise exception 'note_count must be the number of notes in the payload.'
      using errcode = '22023', hint = 'note_count';
  end if;
  -- QDIT-66: the optional mindmap link, left out or null for none. The
  -- route checked it against DOQTRI_ORIGIN; this repeats the shape, and the
  -- origin once integration_settings.doqtri_origin is set (D-95).
  if jsonb_typeof(p_payload -> 'mindmap_url') = 'string' then
    v_link := p_payload ->> 'mindmap_url';
    if not public.hackathon_mindmap_url_allowed(v_link) then
      raise exception 'must be a doqtri mindmap link: the doqtri origin, /m/ and a token of 22 to 64 characters'
        using errcode = '22023', hint = 'mindmap_url';
    end if;
  elsif coalesce(jsonb_typeof(p_payload -> 'mindmap_url'), 'null') <> 'null' then
    raise exception 'must be a string or null'
      using errcode = '22023', hint = 'mindmap_url';
  end if;

  -- (3) Replay or conflict, before the slug and the window, so a retry of a
  -- send that landed before the close still answers 200.
  select * into v_existing
    from public.hackathon_doqtri_snapshots ds
   where ds.project_id = p_project_id
     and ds.snapshot_id = p_snapshot_id;

  if found then
    -- Same key: a replay only for the same body to the same hackathon.
    if v_existing.payload_sha256 <> p_payload_sha256
       or not exists (select 1 from public.hackathons h
                       where h.id = v_existing.hackathon_id and h.slug = p_hackathon_slug) then
      raise exception 'snapshot_conflict'
        using errcode = 'QD409',
              detail = 'This snapshot_id was already sent to this project with a different body.';
    end if;
    v_row := v_existing;
    v_replay := true;
  else
    -- (4) The hackathon, FOR SHARE until commit (header: races with release).
    select * into v_h from public.hackathons h where h.slug = p_hackathon_slug for share;
    if not found then
      raise exception 'No such hackathon.' using errcode = 'P0002';
    end if;

    -- (5) At most 30 per entry. Pushes for one (hackathon, project) take
    -- turns from here, so the count cannot be raced past.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('hackathon_doqtri_snapshots:' || v_h.id || ':' || p_project_id, 0)
    );

    if (select count(*) from public.hackathon_doqtri_snapshots ds
         where ds.hackathon_id = v_h.id and ds.project_id = p_project_id) >= 30 then
      raise exception 'snapshot_limit'
        using errcode = 'QD409',
              detail = 'This project has sent 30 snapshots to this hackathon, the most it may.';
    end if;

    -- (6) The window, late pass honoured.
    perform public.assert_hackathon_open(v_h.id, p_project_id);

    -- (7) One statement: of two concurrent sends with one key exactly one
    -- inserts; the other waits for it here and then answers as a replay or
    -- a conflict.
    insert into public.hackathon_doqtri_snapshots as ds
      (snapshot_id, hackathon_id, project_id, workspace_id, pushed_by, client_id,
       payload, payload_sha256, note_count, mindmap_url)
    values
      (p_snapshot_id, v_h.id, p_project_id, p_workspace_id, auth.uid(), v_client::uuid,
       p_payload, p_payload_sha256, p_note_count, v_link)
    on conflict on constraint hackathon_doqtri_snapshots_key do nothing
    returning * into v_row;

    if v_row.id is null then
      select * into v_row
        from public.hackathon_doqtri_snapshots ds
       where ds.project_id = p_project_id
         and ds.snapshot_id = p_snapshot_id;
      if v_row.payload_sha256 <> p_payload_sha256 or v_row.hackathon_id <> v_h.id then
        raise exception 'snapshot_conflict'
          using errcode = 'QD409',
                detail = 'This snapshot_id was already sent to this project with a different body.';
      end if;
      v_replay := true;
    end if;
  end if;

  select s.current_version_id, true
    into v_current, v_has_sub
    from public.hackathon_submissions s
   where s.hackathon_id = v_row.hackathon_id
     and s.project_id = v_row.project_id;

  return jsonb_build_object(
    'id', v_row.id,
    'note_count', v_row.note_count,
    'received_at', v_row.received_at,
    'replay', v_replay,
    'submission_state',
      case
        when v_has_sub is null then 'none'
        when exists (
          select 1 from public.hackathon_submission_versions v
           where v.id = v_current and v.doqtri_snapshot_id = v_row.id
        ) then 'current'
        else 'submitted_older'
      end
  );
end;
$$;

comment on function public.push_doqtri_hackathon_snapshot(text, uuid, uuid, uuid, jsonb, text, integer) is
  'SECURITY DEFINER, doqtri''s OAuth client only (D-117, D-61), project admin+. POST /api/v1/projects/{id}/hackathon-snapshots: stores the snapshot once per (project, snapshot_id). Order: client and revoke (42501) -> project role (P0002/42501) -> arguments (22023; QD413 payload_too_large over 3 MiB of jsonb text, a backstop for the route''s 2 MiB; note_count = notes; hint mindmap_url for a payload mindmap_url that is not null or a link hackathon_mindmap_url_allowed() accepts, QDIT-66) -> replay (same hash and hackathon: replay=true) or QD409 snapshot_conflict -> P0002 unknown slug -> QD409 snapshot_limit (30) -> QD409 hackathon_not_open/hackathon_closed (late pass honoured). Stores the payload''s mindmap_url in its own column. Returns {id, note_count, received_at, submission_state: none|submitted_older|current, replay}.';


-- ----------------------------------------------------------------------------
-- 6. submit_hackathon_entry, with the mindmap link
--
-- The body from 20261112062735_hackathon_slides_link.sql, with the
-- p_mindmap_url check after the Slides link and the column in the insert.
-- ----------------------------------------------------------------------------

drop function public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[], text);

create function public.submit_hackathon_entry(
  p_hackathon_id uuid,
  p_project_id   uuid,
  p_team_name    text,
  p_member_ids   uuid[],
  p_image_paths  text[],
  p_slides_url   text default null,
  p_mindmap_url  text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_h          public.hackathons;
  v_team_name  text := btrim(coalesce(p_team_name, ''));
  v_slides_url text := btrim(coalesce(p_slides_url, ''));
  v_mindmap    text := nullif(btrim(coalesce(p_mindmap_url, '')), '');
  v_members    uuid[];
  v_path       text;
  v_parts      text[];
  v_taken      text;
  v_snapshot   jsonb;
  v_size       integer;
  v_clip       integer;
  v_sub_id     uuid;
  v_version_no integer;
  v_doqtri_id  uuid;
  v_version_id uuid;
begin
  perform public.assert_first_party_session();

  if v_uid is null then
    raise exception 'Sign in to submit.' using errcode = '42501';
  end if;

  -- FOR SHARE until commit: a release (FOR UPDATE) or a staff change (FOR NO
  -- KEY UPDATE) waits for this submit, or this submit for it, and the window
  -- below then sees released_at as it is after the lock.
  select * into v_h from public.hackathons h where h.id = p_hackathon_id for share;
  if not found then
    raise exception 'No such hackathon.' using errcode = 'P0002';
  end if;

  -- P0002 outside the project, 42501 below admin.
  perform public.assert_project_role(p_project_id, 'admin');

  perform public.assert_hackathon_open(v_h.id, p_project_id);

  if char_length(v_team_name) not between 1 and 80 then
    raise exception 'Team name must be 1 to 80 characters.'
      using errcode = '22023', hint = 'team_name';
  end if;

  select coalesce(array_agg(distinct m), '{}') into v_members
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) as m
   where m is not null;

  if cardinality(v_members) <> cardinality(coalesce(p_member_ids, '{}'::uuid[])) then
    raise exception 'Each team member may be listed once.'
      using errcode = '22023', hint = 'member_ids';
  end if;

  if cardinality(v_members) not between v_h.team_min and v_h.team_max then
    raise exception 'A team has % to % members; this one has %.',
      v_h.team_min, v_h.team_max, cardinality(v_members)
      using errcode = '22023', hint = 'member_ids';
  end if;

  if exists (
    select 1 from unnest(v_members) as m
     where not exists (
       select 1 from public.project_members pm
        where pm.project_id = p_project_id and pm.user_id = m
     )
  ) then
    raise exception 'Every team member must be a member of the project.'
      using errcode = '22023', hint = 'member_ids';
  end if;

  select string_agg(coalesce(pr.username, tm.user_id::text), ', ' order by pr.username)
    into v_taken
    from public.hackathon_team_members tm
    join public.hackathon_submissions s on s.id = tm.submission_id
    left join public.profiles pr on pr.id = tm.user_id
   where tm.hackathon_id = v_h.id
     and tm.user_id = any (v_members)
     and s.project_id <> p_project_id;

  if v_taken is not null then
    raise exception 'member_on_other_team'
      using errcode = 'QD409',
            detail = format('Already on another team in this hackathon: %s.', v_taken);
  end if;

  -- Staff judge the entries, so none of them is on one.
  select string_agg(coalesce(pr.username, st.user_id::text), ', ' order by pr.username)
    into v_taken
    from public.hackathon_staff st
    left join public.profiles pr on pr.id = st.user_id
   where st.hackathon_id = v_h.id
     and st.user_id = any (v_members);

  if v_taken is not null then
    raise exception 'member_is_staff'
      using errcode = 'QD409',
            detail = format('Staff of this hackathon cannot be on a team: %s.', v_taken);
  end if;

  if cardinality(coalesce(p_image_paths, '{}'::text[])) not between 1 and 3
     or array_position(p_image_paths, null) is not null
     or (select count(distinct x) from unnest(p_image_paths) as x) <> cardinality(p_image_paths) then
    raise exception 'Attach 1 to 3 different mindmap images.'
      using errcode = '22023', hint = 'image_paths';
  end if;

  foreach v_path in array p_image_paths loop
    v_parts := public.hackathon_mindmap_path(v_path);
    if v_parts is null
       or v_parts[1]::uuid <> v_h.id
       or v_parts[2]::uuid <> p_project_id then
      raise exception 'Image % is not a mindmap upload for this hackathon and project.', v_path
        using errcode = '22023', hint = 'image_paths';
    end if;

    -- Uploaded, and by someone in the project. `owner` is the column every
    -- Storage version fills; `owner_id` is read where it exists.
    if not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'hackathon-mindmaps'
         and o.name = v_path
         and exists (
           select 1 from public.project_members pm
            where pm.project_id = p_project_id
              and pm.user_id::text = coalesce(o.owner::text, to_jsonb(o) ->> 'owner_id')
         )
    ) then
      raise exception 'Image % was not uploaded for this project.', v_path
        using errcode = '22023', hint = 'image_paths';
    end if;
  end loop;

  -- QDIT-63 (D-123): after the images, so every earlier refusal stands as it was.
  if v_slides_url = '' then
    raise exception 'Add the link to your slides.'
      using errcode = '22023', hint = 'slides_url';
  end if;

  if not public.hackathon_slides_url_ok(v_slides_url) then
    raise exception 'Use an https Google Slides or PowerPoint (OneDrive or SharePoint) link.'
      using errcode = '22023', hint = 'slides_url';
  end if;

  -- QDIT-66: optional, after the Slides link, so every earlier refusal stands.
  if v_mindmap is not null and not public.hackathon_mindmap_url_allowed(v_mindmap) then
    raise exception 'Use the mindmap link doqtri gives you: it starts with the doqtri address and /m/.'
      using errcode = '22023', hint = 'mindmap_url';
  end if;

  -- 4,000 characters of free text, then 1,000, then 300, until it fits.
  foreach v_clip in array array[4000, 1000, 300] loop
    v_snapshot := public.build_hackathon_qdit_snapshot(p_project_id, v_clip);
    v_size := pg_column_size(v_snapshot);
    exit when v_size <= 2 * 1024 * 1024;
  end loop;
  if v_size > 2 * 1024 * 1024 then
    raise exception 'snapshot_too_large'
      using errcode = 'QD413',
            detail = format('The project snapshot is %s bytes with text clipped to 300 characters; the limit is 2 MB.', v_size);
  end if;

  -- The entry row, locked by the upsert for the rest of this transaction, so
  -- two submits of one entry take turns and version numbers stay dense.
  insert into public.hackathon_submissions as s (hackathon_id, project_id, team_name, created_by)
  values (v_h.id, p_project_id, v_team_name, v_uid)
  on conflict on constraint hackathon_submissions_entry_key do update
    set team_name = excluded.team_name,
        updated_at = now()
  returning s.id into v_sub_id;

  delete from public.hackathon_team_members tm where tm.submission_id = v_sub_id;

  begin
    insert into public.hackathon_team_members (hackathon_id, submission_id, user_id)
    select v_h.id, v_sub_id, m from unnest(v_members) as m;
  exception when unique_violation then
    -- Another entry took a member after the check above.
    raise exception 'member_on_other_team'
      using errcode = 'QD409',
            detail = 'A team member was just added to another team in this hackathon.';
  end;

  select coalesce(max(v.version_no), 0) + 1 into v_version_no
    from public.hackathon_submission_versions v
   where v.submission_id = v_sub_id;

  select ds.id into v_doqtri_id
    from public.hackathon_doqtri_snapshots ds
   where ds.hackathon_id = v_h.id
     and ds.project_id = p_project_id
   order by ds.received_at desc, ds.id desc
   limit 1;

  insert into public.hackathon_submission_versions
    (submission_id, version_no, team_name, member_ids, qdit_snapshot,
     doqtri_snapshot_id, image_paths, slides_url, mindmap_url, submitted_by)
  values
    (v_sub_id, v_version_no, v_team_name,
     (select array_agg(m order by m) from unnest(v_members) as m),
     v_snapshot, v_doqtri_id, p_image_paths, v_slides_url, v_mindmap, v_uid)
  returning id into v_version_id;

  update public.hackathon_submissions s
     set current_version_id = v_version_id
   where s.id = v_sub_id;

  update public.hackathon_grading_jobs j
     set status = 'superseded',
         lease_until = null
    from public.hackathon_submission_versions v
   where v.id = j.version_id
     and v.submission_id = v_sub_id
     and v.id <> v_version_id
     and j.status in ('pending', 'running');

  insert into public.hackathon_grading_jobs (version_id, run_no)
  values (v_version_id, 1), (v_version_id, 2);

  return v_version_id;
end;
$$;

comment on function public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[], text, text) is
  'SECURITY DEFINER, first-party sessions, project admin+. Submits or resubmits the project''s entry: window (late pass honoured), team size, members in the project and on no other team, 1-3 uploaded mindmap paths, a Slides link hackathon_slides_url_ok() accepts (QDIT-63, D-123), an optional Mindmap link hackathon_mindmap_url_allowed() accepts (QDIT-66); freezes the qdit snapshot and the newest doqtri snapshot into a new version, supersedes the old version''s open jobs and queues runs 1 and 2. Returns the version id. Errors: headers of 20261110100000_hackathons.sql, 20261112062735_hackathon_slides_link.sql and 20261112140000_hackathon_mindmap_link.sql.';

revoke all on function public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[], text, text) from public, anon;
grant execute on function public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[], text, text) to authenticated;
