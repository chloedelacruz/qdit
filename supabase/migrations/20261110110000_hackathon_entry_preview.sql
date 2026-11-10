-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261110110000_hackathon_entry_preview.sql
--
-- Applied to the hosted project through the Supabase MCP, which stamped it
-- 20261110043649: before 20261110100000_hackathons, which this depends on.
-- The ledger row was set back to this file's version rather than renaming the
-- file (gaps.md section 2). SQL unchanged.
--
-- QDIT-55 (WP-4.7): the submission dialog checks a team's current work against
-- the eligibility gate before it submits, with "Submit anyway" always offered.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- The gate (web/src/lib/hackathon/eligibility.ts) reads the frozen qdit
-- snapshot and the doqtri snapshot of a submission version. Before a submit
-- there is no version, and build_hackathon_qdit_snapshot() has no client
-- grant, so the app cannot build what the gate would see.
--
-- preview_hackathon_entry() returns exactly what submit_hackathon_entry()
-- would freeze right now, and writes nothing:
--
--   qdit_snapshot        build_hackathon_qdit_snapshot(project), with the same
--                        4,000 / 1,000 / 300 clip fallback as submit;
--   doqtri_snapshot      the payload of the newest doqtri snapshot pushed for
--                        (hackathon, project), the one submit would attach,
--                        or null;
--   doqtri_received_at   when that snapshot arrived, or null;
--   doqtri_note_count    its note count, or null.
--
-- The caller checks are submit's own, in submit's order: first-party session,
-- signed in, the hackathon exists, project admin or above, the window open
-- for this project (late pass honoured). A caller who may not submit learns
-- nothing more here than submit would tell them. Team, image and size checks
-- are left to submit itself: the gate reports team and images, and a preview
-- of a too-large project is still worth showing (the qdit snapshot then says
-- truncated).
--
-- The result is advisory. Grading never reads it: the worker computes the
-- gate from the version submit freezes (QDIT-54).
-- ============================================================================

create or replace function public.preview_hackathon_entry(
  p_hackathon_id uuid,
  p_project_id   uuid
)
returns jsonb
language plpgsql
-- volatile, not stable: it calls assert_hackathon_open(), which is volatile.
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_clip     integer;
  v_snapshot jsonb;
  v_doqtri   public.hackathon_doqtri_snapshots;
begin
  perform public.assert_first_party_session();

  if v_uid is null then
    raise exception 'Sign in to submit.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.hackathons h where h.id = p_hackathon_id) then
    raise exception 'No such hackathon.' using errcode = 'P0002';
  end if;

  -- P0002 outside the project, 42501 below admin.
  perform public.assert_project_role(p_project_id, 'admin');

  perform public.assert_hackathon_open(p_hackathon_id, p_project_id);

  -- Submit's fallback: the first clip that fits in 2 MB, else the smallest.
  foreach v_clip in array array[4000, 1000, 300] loop
    v_snapshot := public.build_hackathon_qdit_snapshot(p_project_id, v_clip);
    exit when pg_column_size(v_snapshot) <= 2 * 1024 * 1024;
  end loop;

  -- The same pick as submit_hackathon_entry().
  select ds.* into v_doqtri
    from public.hackathon_doqtri_snapshots ds
   where ds.hackathon_id = p_hackathon_id
     and ds.project_id = p_project_id
   order by ds.received_at desc, ds.id desc
   limit 1;

  return jsonb_build_object(
    'qdit_snapshot',      v_snapshot,
    'doqtri_snapshot',    v_doqtri.payload,
    'doqtri_received_at', v_doqtri.received_at,
    'doqtri_note_count',  v_doqtri.note_count
  );
end;
$$;

comment on function public.preview_hackathon_entry(uuid, uuid) is
  'SECURITY DEFINER, first-party sessions, project admin+, window open (late pass honoured). What submit_hackathon_entry() would freeze right now: {qdit_snapshot, doqtri_snapshot, doqtri_received_at, doqtri_note_count}. Writes nothing; advisory only (QDIT-55). Errors as submit''s for the same checks.';

revoke all on function public.preview_hackathon_entry(uuid, uuid) from public, anon;
grant execute on function public.preview_hackathon_entry(uuid, uuid) to authenticated;
