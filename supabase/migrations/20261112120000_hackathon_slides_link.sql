-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261112120000_hackathon_slides_link.sql
--
-- QDIT-63 (WP-4.7, D-123): every hackathon submit carries the team's Slides
-- link, so judges can open the deck and organisers can export it.
--
-- ---------------------------------------------------------------------------
-- WHAT
-- ---------------------------------------------------------------------------
--   1. hackathon_submission_versions.slides_url
--        The deck link, frozen on the version like everything else there.
--        Null only on versions submitted before this migration: those teams
--        add a link on their next resubmit. Granted to authenticated like the
--        other version columns, so the project's members and the hackathon's
--        staff read it under the existing row policy.
--   2. hackathon_slides_url_ok(text)
--        Whether a link is one we accept: https, at most 2,048 characters, no
--        whitespace or control characters, and on one of
--          docs.google.com/presentation/[u/<n>/]d/<id>   Google Slides
--          drive.google.com/file/d/<id>                  a deck file on Drive
--          onedrive.live.com/, 1drv.ms/                  PowerPoint, OneDrive
--          <tenant>.sharepoint.com/                      PowerPoint, SharePoint
--        The host must be followed by `/`, so `docs.google.com.example.com`
--        and `x.sharepoint.com@example.com` are refused. Used by the column's
--        check and by the RPC; web/src/lib/hackathon/schemas.ts mirrors it.
--        Sharing is not checked: teams are told to share the deck as "Anyone
--        with the link can view" (D-123).
--   3. submit_hackathon_entry(uuid, uuid, text, uuid[], text[], text)
--        Replaces the five-argument version. p_slides_url is required; it
--        defaults to null only so a caller still on the old five named
--        arguments gets the 22023 below instead of "function does not exist"
--        while the app deploys. Checked after the images, so every earlier
--        refusal is unchanged; stored trimmed on the new version.
--
-- Errors (adds to the header of 20261110100000_hackathons.sql):
--   22023  hint slides_url: no link, or not one hackathon_slides_url_ok()
--          accepts. Message is a sentence.
--
-- Apply before merging the code that sends p_slides_url (runbook 1.8). The
-- old app keeps working against this function until then, except that its
-- submits are refused for want of a link.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The validator
-- ----------------------------------------------------------------------------

create or replace function public.hackathon_slides_url_ok(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
     and char_length(p_url) <= 2048
     and p_url ~* (
       '^https://('
         || 'docs\.google\.com/presentation/(u/[0-9]+/)?d/[A-Za-z0-9_-]+'
         || '|drive\.google\.com/file/d/[A-Za-z0-9_-]+'
         || '|onedrive\.live\.com/'
         || '|1drv\.ms/'
         || '|[a-z0-9-]+(\.[a-z0-9-]+)*\.sharepoint\.com/'
       || ')[^[:space:][:cntrl:]]*$'
     );
$$;

comment on function public.hackathon_slides_url_ok(text) is
  'Internal (QDIT-63, D-123). True when p_url is an https Google Slides, Google Drive file, OneDrive or SharePoint link of at most 2,048 characters with no whitespace. Used by hackathon_submission_versions_slides_url_check and submit_hackathon_entry(); web/src/lib/hackathon/schemas.ts mirrors it.';

revoke all on function public.hackathon_slides_url_ok(text) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. The column
-- ----------------------------------------------------------------------------

alter table public.hackathon_submission_versions
  add column slides_url text,
  add constraint hackathon_submission_versions_slides_url_check
    check (slides_url is null or public.hackathon_slides_url_ok(slides_url));

comment on column public.hackathon_submission_versions.slides_url is
  'The team''s Slides link, as submitted (QDIT-63, D-123). Null only on versions submitted before 20261112120000.';

grant select (slides_url) on table public.hackathon_submission_versions to authenticated;


-- ----------------------------------------------------------------------------
-- 3. submit_hackathon_entry, with the link
-- ----------------------------------------------------------------------------

drop function public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[]);

create function public.submit_hackathon_entry(
  p_hackathon_id uuid,
  p_project_id   uuid,
  p_team_name    text,
  p_member_ids   uuid[],
  p_image_paths  text[],
  p_slides_url   text default null
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
     doqtri_snapshot_id, image_paths, slides_url, submitted_by)
  values
    (v_sub_id, v_version_no, v_team_name,
     (select array_agg(m order by m) from unnest(v_members) as m),
     v_snapshot, v_doqtri_id, p_image_paths, v_slides_url, v_uid)
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

comment on function public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[], text) is
  'SECURITY DEFINER, first-party sessions, project admin+. Submits or resubmits the project''s entry: window (late pass honoured), team size, members in the project and on no other team, 1-3 uploaded mindmap paths, a Slides link hackathon_slides_url_ok() accepts (QDIT-63, D-123); freezes the qdit snapshot and the newest doqtri snapshot into a new version, supersedes the old version''s open jobs and queues runs 1 and 2. Returns the version id. Errors: header of 20261110100000_hackathons.sql and of 20261112120000_hackathon_slides_link.sql.';

revoke all on function public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[], text) from public, anon;
grant execute on function public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[], text) to authenticated;
