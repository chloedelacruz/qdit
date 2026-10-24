-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261024120000_integration_links.sql
--
-- qdit's side of the doqtri links (WP-2.4): which docs a project holds, which
-- milestone each doqtri heading points at, and the rules that keep a linked
-- milestone's title doqtri's.
--
-- ---------------------------------------------------------------------------
-- WHAT IS STORED
-- ---------------------------------------------------------------------------
-- docs/integration/CONTRACT.md section 2 gives qdit two tables of doqtri data:
--
--   project_doc_links          one row per doqtri doc linked to a project. A
--                              doc belongs to at most one project, a project
--                              holds many docs (D-09), so `doc_id` is unique
--                              and `project_id` is not.
--   milestone_external_links   one row per linked milestone: the doc, the
--                              heading's positional node id, its label and
--                              the doc version the link was written against.
--                              One node, one milestone, both ways (D-06):
--                              `milestone_id` is unique, and so is
--                              `(doc_id, node_id)`.
--
-- Copies, not truth. The doc, its headings and their status are doqtri's
-- (D-11); qdit keeps what it needs to show "From doqtri" and to answer the
-- API. Nothing here is ever sent back to doqtri as fact about a doc.
--
-- A link row points through `(project_id, doc_id)` at its doc link, with
-- ON DELETE CASCADE. That is D-22 in the schema: removing a doc from a project
-- removes every milestone link into it in the same statement, whichever path
-- removed it (the API's unlink_project_doc(), a direct PostgREST delete, the
-- project being deleted). Milestones are never deleted by it; they only lose
-- their link and become editable in qdit again.
--
-- ---------------------------------------------------------------------------
-- WHO MAY DO WHAT (D-23)
-- ---------------------------------------------------------------------------
--   read either table          viewer and above
--   link and unlink docs       admin and above
--   create, change and delete
--   milestone links            member and above
--
-- Those are the permissive policies, for every caller. On top of them, an
-- OAuth client (a token with a `client_id` claim, see
-- 20261024110000_oauth_client_guards.sql) gets the restrictive guards every
-- table must have. D-03 lets an app "write link rows", so on these two tables
-- they are opened for exactly that, and no further:
--
--   project_doc_links          INSERT and DELETE open; UPDATE closed. The
--                              API's re-post refresh (`doc_title`, `doc_url`)
--                              goes through link_project_doc(), which checks
--                              the role itself, so a token cannot rewrite a
--                              doc link's columns directly.
--   milestone_external_links   INSERT, UPDATE (D-21) and DELETE open. Which
--                              columns may change is the trigger's job
--                              (section 4), for every caller alike.
--
-- For every caller, a doc link's `project_id`, `doc_id`, `linked_by` and
-- `created_at` are fixed once written (section 4): only the copies,
-- `doc_title` and `doc_url`, are refreshed. Moving a doc to another project is
-- an unlink and a new link, which is doqtri's call (D-10).
--
-- Reads are not guarded: GET /milestones/{id} returns the link, and the API
-- reads both tables with the caller's token. Both are added to the list of
-- app-readable tables in supabase/tests/oauth_client_guards.test.sql and in
-- web/src/lib/auth/oauth-consent.ts (APP_READ_SCOPE).
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES ON public.milestones (D-12, D-03)
-- ---------------------------------------------------------------------------
-- WP-2.2 closed UPDATE on milestones to OAuth clients entirely. It is
-- replaced here by a guard that admits an OAuth client's UPDATE of a *linked*
-- milestone, and a BEFORE UPDATE trigger narrows that to the title:
--
--   * an OAuth client may change `title` of a linked milestone, and nothing
--     else on any milestone — not status, not the description, not the order;
--   * once a milestone has a link, nobody else may change its title. qdit's
--     own UI shows it read-only (D-12: doqtri wins on titles), and a hand-made
--     PostgREST request from a qdit session is refused here;
--   * a linked milestone stays in its project, for every caller. The link is
--     in the milestone's project (D-09: the doc belongs to that project), so
--     moving the milestone would leave the link, and the title copy it keeps,
--     in a project the milestone is no longer in. Unlink it first.
--
-- The link's `node_label` follows the title by trigger, so the two never
-- differ (contract section 8, PATCH /links/{id}).
--
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER FUNCTIONS
-- ---------------------------------------------------------------------------
-- Three RPCs, each SECURITY DEFINER, each re-checking the caller's role with
-- is_project_member() (which reads auth.uid(), i.e. the caller) before it
-- touches a row, and each doing only what D-03 lets an app do. They are
-- deliberately open to OAuth clients — doqtri is who calls them — so they do
-- not call assert_first_party_session():
--
--   link_project_doc       POST /projects/{id}/docs: insert, or refresh the
--                          title and URL of the same doc in the same project.
--   unlink_project_doc     DELETE /projects/{id}/docs/{doc_id}: the doc link
--                          and its milestone links in one transaction (D-22),
--                          returning the removed link ids.
--   create_linked_milestone
--                          POST /milestones: a proposed milestone and its
--                          link in one transaction, refusing a doc that is
--                          not linked to that project.
--
-- Errors they raise, which web/src/lib/api maps onto the contract's codes:
--
--   P0002  not_found   the project is not one the caller can see, or the doc
--                      is not linked to it
--   42501  forbidden   the caller can see the project but their role is too low
--   QD409  conflict    MESSAGE is the contract's `details.reason`; HINT
--                      carries `details.milestone_id` when there is one
--
-- The trigger functions are SECURITY DEFINER too, so that what they check or
-- copy does not depend on what RLS lets the caller see; none of them is
-- callable by a client.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table public.project_doc_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,

  -- doqtri's documents.id. Not a foreign key: it lives in doqtri's database
  -- (D-01).
  doc_id      uuid not null,

  -- Shown in qdit's "Plan docs" list. doqtri sends the current title on every
  -- re-post, so it is a refreshable copy.
  doc_title   text not null check (char_length(btrim(doc_title)) between 1 and 300),

  -- Where a qdit user goes to read the plan. https only: it is rendered as a
  -- link, and anything else is either a mistake or an attempt at one.
  doc_url     text not null
    check (char_length(doc_url) <= 2048 and doc_url ~ '^https://[^/?#[:space:]]+'),

  -- Who linked it. Kept when the account goes, as an empty pointer.
  linked_by   uuid references auth.users (id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- D-09: a doc belongs to at most one project.
  constraint project_doc_links_doc_id_key unique (doc_id),
  -- The target of milestone_external_links' composite foreign key.
  constraint project_doc_links_project_doc_key unique (project_id, doc_id)
);

comment on table public.project_doc_links is
  'A doqtri doc linked to a qdit project (D-09: one project per doc, many docs per project). Copies of the doc title and URL only; doqtri owns the doc.';


create table public.milestone_external_links (
  id           uuid primary key default gen_random_uuid(),

  -- Deleting the milestone deletes its link. The reverse never happens.
  milestone_id uuid not null references public.milestones (id) on delete cascade,

  -- The milestone's project, which is also the doc's (the composite foreign
  -- key below). Checked against the milestone by trigger, and frozen after.
  project_id   uuid not null,

  -- One provider per node, and in v1 the only one that writes here (D-08).
  source       text not null default 'doqtri' check (source = 'doqtri'),

  doc_id       uuid not null,

  -- doqtri's positional node id: `root`, `h0`, `h1`, ... (contract section 4;
  -- the character set is the `node-id` rule of section 10).
  node_id      text not null check (node_id ~ '^[A-Za-z0-9_-]{1,64}$'),

  -- The heading text. Always equal to milestones.title (section 4).
  node_label   text not null check (char_length(btrim(node_label)) between 1 and 300),

  -- DoqtriRegistry Document.version (a u32) the link was last written
  -- against, or null when the doc was not anchored then.
  doc_version  bigint check (doc_version between 1 and 4294967295),

  -- Copy of project_doc_links.doc_title, kept in step by trigger, so a
  -- milestone row can say which plan it came from without another join.
  doc_title    text,

  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- D-06, both directions.
  constraint milestone_external_links_milestone_id_key unique (milestone_id),
  constraint milestone_external_links_node_key unique (doc_id, node_id),

  -- D-22: unlinking the doc removes its milestone links, atomically, however
  -- the doc link was removed. Also makes "the doc is linked to this project"
  -- a fact the database checks, not only the API.
  constraint milestone_external_links_doc_fkey
    foreign key (project_id, doc_id)
    references public.project_doc_links (project_id, doc_id)
    on delete cascade
);

comment on table public.milestone_external_links is
  'The doqtri heading a milestone is linked to (D-06: one node per milestone, one milestone per node). While a row exists the milestone title is doqtri''s (D-12).';
comment on column public.milestone_external_links.node_label is
  'The heading text, always equal to the milestone title: set together by PATCH /api/v1/milestones/{id}, kept equal by trigger.';


-- ----------------------------------------------------------------------------
-- 2. Indexes
--
-- The unique constraints index doc_id, (project_id, doc_id), milestone_id and
-- (doc_id, node_id). The one left is the cascade from project_doc_links, which
-- looks link rows up by (project_id, doc_id).
-- ----------------------------------------------------------------------------

create index milestone_external_links_doc_idx
  on public.milestone_external_links (project_id, doc_id);


-- ----------------------------------------------------------------------------
-- 3. updated_at
-- ----------------------------------------------------------------------------

create trigger project_doc_links_set_updated_at
  before update on public.project_doc_links
  for each row execute function public.set_updated_at();

create trigger milestone_external_links_set_updated_at
  before update on public.milestone_external_links
  for each row execute function public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 4. Link rows: what may be written, and the copies that follow
--
-- One BEFORE trigger for every caller, first party or app, so the rules hold
-- whichever path wrote the row:
--
--   * a link is in its milestone's project;
--   * `node_label` equals the milestone's title, on insert and whenever it
--     changes — the only legitimate change is the one the title trigger below
--     makes, right after the title itself changed;
--   * after insert, only `node_id`, `doc_version` and those two copies move.
--     A link is re-pointed within its doc (D-21), never to another milestone,
--     doc or project; for that, delete it and create another;
--   * `doc_title` is always the doc link's current title, whatever was sent.
--
-- And on the doc link itself: after insert only `doc_title` and `doc_url`
-- move. A doc link is never re-pointed at another project or doc, and who
-- linked it is never rewritten (the INSERT policy pins `linked_by` to the
-- caller; without this an UPDATE could set it to anyone).
-- ----------------------------------------------------------------------------

create or replace function public.check_project_doc_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.id, new.project_id, new.doc_id, new.linked_by, new.created_at)
     is distinct from
     (old.id, old.project_id, old.doc_id, old.linked_by, old.created_at) then
    raise exception 'Only doc_title and doc_url of a doc link can change; unlink the doc and link it again instead.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.check_project_doc_link() is
  'BEFORE UPDATE on project_doc_links: only doc_title and doc_url are movable, for every caller.';

create trigger project_doc_links_check
  before update on public.project_doc_links
  for each row execute function public.check_project_doc_link();


create or replace function public.check_milestone_external_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_title      text;
begin
  if tg_op = 'UPDATE' and (
       new.milestone_id, new.project_id, new.doc_id, new.source, new.created_by, new.created_at
     ) is distinct from (
       old.milestone_id, old.project_id, old.doc_id, old.source, old.created_by, old.created_at
     ) then
    raise exception 'Only node_id and doc_version of a milestone link can change.'
      using errcode = '42501';
  end if;

  select m.project_id, m.title
    into v_project_id, v_title
    from public.milestones m
   where m.id = new.milestone_id;

  -- A missing milestone is left to the foreign key, which says so precisely.
  if found then
    if tg_op = 'INSERT' and new.project_id is distinct from v_project_id then
      raise exception 'A milestone link must be in the milestone''s own project.'
        using errcode = '23514';
    end if;

    if (tg_op = 'INSERT' or new.node_label is distinct from old.node_label)
       and new.node_label is distinct from v_title then
      raise exception 'node_label must equal the milestone title (D-12); rename the milestone instead.'
        using errcode = '23514';
    end if;
  end if;

  select d.doc_title
    into new.doc_title
    from public.project_doc_links d
   where d.project_id = new.project_id
     and d.doc_id = new.doc_id;

  return new;
end;
$$;

comment on function public.check_milestone_external_link() is
  'BEFORE INSERT OR UPDATE on milestone_external_links: link in the milestone''s project, node_label equal to the milestone title, only node_id/doc_version movable, doc_title copied from project_doc_links. SECURITY DEFINER so the checks do not depend on what the caller can read.';

create trigger milestone_external_links_check
  before insert or update on public.milestone_external_links
  for each row execute function public.check_milestone_external_link();


create or replace function public.sync_link_doc_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.milestone_external_links l
     set doc_title = new.doc_title
   where l.project_id = new.project_id
     and l.doc_id = new.doc_id
     and l.doc_title is distinct from new.doc_title;
  return null;
end;
$$;

comment on function public.sync_link_doc_title() is
  'AFTER UPDATE OF doc_title on project_doc_links: refreshes the copy on the doc''s milestone links.';

create trigger project_doc_links_sync_title
  after update of doc_title on public.project_doc_links
  for each row execute function public.sync_link_doc_title();


-- ----------------------------------------------------------------------------
-- 5. Milestones: the title lock (D-12) and the OAuth column limit (D-03)
--
-- Who counts as whom is read from the request JWT, exactly as the WP-2.2
-- guards do:
--
--   client_id claim present    an OAuth client. May change `title` of a
--                              linked milestone and no other column of any
--                              milestone.
--   role authenticated / anon  the user's own qdit session. May change
--   and no client_id           anything RLS allows, except the title of a
--                              linked milestone.
--   anything else              the service role, or a direct database session
--                              with no JWT. Not limited here, as RLS does not
--                              limit them either: those are operators, not
--                              users.
--
-- One rule holds for all three: a linked milestone does not change project.
-- Its link is in the milestone's project, and a moved milestone would leave
-- the link behind, readable (with the title it copies) by the old project
-- and invisible to the new one. Unlinking first is the way to move it.
--
-- SECURITY DEFINER so "is it linked?" is answered from the table itself and
-- not from what the caller can see of it. `updated_at` is not compared: the
-- milestones_set_updated_at trigger stamps it on every update.
-- ----------------------------------------------------------------------------

create or replace function public.guard_milestone_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := auth.jwt();
  v_linked boolean;
begin
  v_linked := exists (
    select 1 from public.milestone_external_links l where l.milestone_id = old.id
  );

  if v_linked and new.project_id is distinct from old.project_id then
    raise exception 'A milestone linked to a doqtri plan cannot move to another project; unlink it first.'
      using errcode = '23514';
  end if;

  if (v_claims ->> 'client_id') is not null then
    if (new.id, new.project_id, new.description, new.status, new.due_date, new.order_index, new.created_at)
       is distinct from
       (old.id, old.project_id, old.description, old.status, old.due_date, old.order_index, old.created_at) then
      raise exception 'Apps connected through OAuth can only rename a linked milestone.'
        using errcode = '42501';
    end if;

    if new.title is distinct from old.title and not v_linked then
      raise exception 'Apps connected through OAuth can only rename a linked milestone.'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if (v_claims ->> 'role') in ('authenticated', 'anon')
     and new.title is distinct from old.title
     and v_linked then
    raise exception 'This milestone''s title is managed by doqtri.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_milestone_update() is
  'BEFORE UPDATE on milestones. A linked milestone cannot change project (every caller); OAuth clients may change only the title, and only of a linked milestone (D-03, D-12); user sessions may not change a linked milestone''s title (D-12).';

create trigger milestones_guard_update
  before update on public.milestones
  for each row execute function public.guard_milestone_update();


create or replace function public.sync_link_node_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.milestone_external_links l
     set node_label = new.title
   where l.milestone_id = new.id
     and l.node_label is distinct from new.title;
  return null;
end;
$$;

comment on function public.sync_link_node_label() is
  'AFTER UPDATE OF title on milestones: sets the link''s node_label to the new title, so the two never differ (D-12).';

create trigger milestones_sync_link_label
  after update of title on public.milestones
  for each row execute function public.sync_link_node_label();


-- ----------------------------------------------------------------------------
-- 6. Row Level Security — D-23, for every caller
-- ----------------------------------------------------------------------------

alter table public.project_doc_links        enable row level security;
alter table public.milestone_external_links enable row level security;

create policy "project_doc_links: read as member"
  on public.project_doc_links
  for select
  to authenticated
  using (public.is_project_member(project_id, 'viewer'));

create policy "project_doc_links: insert as admin"
  on public.project_doc_links
  for insert
  to authenticated
  with check (
    public.is_project_member(project_id, 'admin')
    and linked_by = (select auth.uid())
  );

create policy "project_doc_links: update as admin"
  on public.project_doc_links
  for update
  to authenticated
  using (public.is_project_member(project_id, 'admin'))
  with check (public.is_project_member(project_id, 'admin'));

create policy "project_doc_links: delete as admin"
  on public.project_doc_links
  for delete
  to authenticated
  using (public.is_project_member(project_id, 'admin'));


create policy "milestone_external_links: read as member"
  on public.milestone_external_links
  for select
  to authenticated
  using (public.is_project_member(project_id, 'viewer'));

create policy "milestone_external_links: insert as member"
  on public.milestone_external_links
  for insert
  to authenticated
  with check (
    public.is_project_member(project_id, 'member')
    and created_by = (select auth.uid())
  );

create policy "milestone_external_links: update as member"
  on public.milestone_external_links
  for update
  to authenticated
  using (public.is_project_member(project_id, 'member'))
  with check (public.is_project_member(project_id, 'member'));

create policy "milestone_external_links: delete as member"
  on public.milestone_external_links
  for delete
  to authenticated
  using (public.is_project_member(project_id, 'member'));


-- ----------------------------------------------------------------------------
-- 7. OAuth client guards (D-03) — see the header
--
-- Every table has a restrictive policy for INSERT, UPDATE and DELETE (the
-- tripwire in supabase/tests/oauth_client_guards.test.sql). Where D-03 opens a
-- command to apps, the guard says what it is opened to; where it opens it
-- outright, the guard is `true` and its name says that this is a decision,
-- not an omission.
-- ----------------------------------------------------------------------------

create policy "project_doc_links: oauth clients insert as their user"
  on public.project_doc_links
  as restrictive
  for insert
  to public
  with check (
    ((select auth.jwt()) ->> 'client_id') is null
    or linked_by = (select auth.uid())
  );

-- The refresh goes through link_project_doc(); see the header.
create policy "project_doc_links: no update by oauth clients"
  on public.project_doc_links
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "project_doc_links: oauth clients may delete (D-03, D-22)"
  on public.project_doc_links
  as restrictive
  for delete
  to public
  using (true);


create policy "milestone_external_links: oauth clients insert as their user"
  on public.milestone_external_links
  as restrictive
  for insert
  to public
  with check (
    ((select auth.jwt()) ->> 'client_id') is null
    or created_by = (select auth.uid())
  );

-- Which columns may move is check_milestone_external_link()'s job.
create policy "milestone_external_links: oauth clients may update (D-21)"
  on public.milestone_external_links
  as restrictive
  for update
  to public
  using (true)
  with check (true);

create policy "milestone_external_links: oauth clients may delete (D-03)"
  on public.milestone_external_links
  as restrictive
  for delete
  to public
  using (true);


-- The WP-2.2 milestones UPDATE guard, widened to linked milestones only.
-- guard_milestone_update() then holds the app to the title column.
drop policy "milestones: no update by oauth clients" on public.milestones;

create policy "milestones: oauth clients update linked only"
  on public.milestones
  as restrictive
  for update
  to public
  using (
    ((select auth.jwt()) ->> 'client_id') is null
    or exists (
      select 1 from public.milestone_external_links l
       where l.milestone_id = milestones.id
    )
  )
  with check (
    ((select auth.jwt()) ->> 'client_id') is null
    or exists (
      select 1 from public.milestone_external_links l
       where l.milestone_id = milestones.id
    )
  );


-- ----------------------------------------------------------------------------
-- 8. RPCs for /api/v1 — see the header for why they are SECURITY DEFINER and
-- what they raise
-- ----------------------------------------------------------------------------

-- The role check every RPC opens with: not_found for a project the caller
-- cannot see, forbidden for one they can see with too low a role. The order is
-- the contract's (section 8): existence is never revealed to an outsider.
create or replace function public.assert_project_role(
  p_project_id uuid,
  p_min_role   text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_project_member(p_project_id, 'viewer') then
    raise exception 'No such project.' using errcode = 'P0002';
  end if;

  if not public.is_project_member(p_project_id, p_min_role) then
    raise exception 'Your role in this project does not allow that.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.assert_project_role(uuid, text) is
  'Raises P0002 when the caller is not a member of p_project_id, 42501 when their role is below p_min_role. Used first by the /api/v1 RPCs.';


create or replace function public.link_project_doc(
  p_project_id uuid,
  p_doc_id     uuid,
  p_doc_title  text,
  p_doc_url    text
)
returns table (
  id         uuid,
  project_id uuid,
  doc_id     uuid,
  doc_title  text,
  doc_url    text,
  created_at timestamptz,
  updated_at timestamptz,
  created    boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.assert_project_role(p_project_id, 'admin');

  -- One statement, so two concurrent posts of the same doc cannot both
  -- insert. The WHERE makes the conflict branch a no-op for a doc linked to
  -- another project, which then returns no row. `xmax = 0` is true only for
  -- a row this statement inserted, which is how 201 is told from 200.
  return query
    insert into public.project_doc_links as d (project_id, doc_id, doc_title, doc_url, linked_by)
    values (p_project_id, p_doc_id, btrim(p_doc_title), p_doc_url, auth.uid())
    on conflict on constraint project_doc_links_doc_id_key do update
      set doc_title = excluded.doc_title,
          doc_url   = excluded.doc_url
      where d.project_id = excluded.project_id
    returning d.id, d.project_id, d.doc_id, d.doc_title, d.doc_url,
              d.created_at, d.updated_at, (d.xmax = 0);

  if not found then
    raise exception 'doc_linked_elsewhere' using errcode = 'QD409';
  end if;
end;
$$;

comment on function public.link_project_doc(uuid, uuid, text, text) is
  'SECURITY DEFINER. POST /api/v1/projects/{id}/docs: links a doqtri doc to a project the caller administers, or refreshes title and URL when it is already linked there. QD409 doc_linked_elsewhere when another project holds it.';


create or replace function public.unlink_project_doc(
  p_project_id uuid,
  p_doc_id     uuid
)
returns uuid[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_removed uuid[];
begin
  perform public.assert_project_role(p_project_id, 'admin');

  -- Locked first, so a milestone link created concurrently either commits
  -- before this (and is listed below) or waits and then fails its foreign
  -- key. Without the lock it could be removed by the cascade and not listed.
  perform 1
     from public.project_doc_links d
    where d.project_id = p_project_id
      and d.doc_id = p_doc_id
      for update;

  if not found then
    raise exception 'That doc is not linked to this project.' using errcode = 'P0002';
  end if;

  with removed as (
    delete from public.milestone_external_links l
     where l.project_id = p_project_id
       and l.doc_id = p_doc_id
    returning l.id
  )
  select coalesce(array_agg(r.id order by r.id), '{}')
    into v_removed
    from removed r;

  delete from public.project_doc_links d
   where d.project_id = p_project_id
     and d.doc_id = p_doc_id;

  return v_removed;
end;
$$;

comment on function public.unlink_project_doc(uuid, uuid) is
  'SECURITY DEFINER. DELETE /api/v1/projects/{id}/docs/{doc_id}: removes the doc link and every milestone link into it in one transaction (D-22) and returns the removed link ids. Milestones stay.';


create or replace function public.create_linked_milestone(
  p_project_id  uuid,
  p_title       text,
  p_description text,
  p_due_date    date,
  p_doc_id      uuid,
  p_node_id     text,
  p_doc_version bigint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title    text := btrim(p_title);
  v_existing uuid;
  v_order    integer;
  v_id       uuid;
begin
  perform public.assert_project_role(p_project_id, 'member');

  -- Held until commit, so the doc cannot be unlinked between this check and
  -- the link insert below.
  perform 1
     from public.project_doc_links d
    where d.project_id = p_project_id
      and d.doc_id = p_doc_id
      for share;

  if not found then
    raise exception 'doc_not_linked' using errcode = 'QD409';
  end if;

  select l.milestone_id
    into v_existing
    from public.milestone_external_links l
   where l.doc_id = p_doc_id
     and l.node_id = p_node_id;

  if found then
    raise exception 'node_already_linked'
      using errcode = 'QD409', hint = v_existing::text;
  end if;

  select coalesce(max(m.order_index) + 1, 0)
    into v_order
    from public.milestones m
   where m.project_id = p_project_id;

  -- Always proposed, whatever the caller is (contract section 8; D-03).
  insert into public.milestones (project_id, title, description, status, due_date, order_index)
  values (p_project_id, v_title, p_description, 'proposed', p_due_date, v_order)
  returning id into v_id;

  begin
    insert into public.milestone_external_links
      (milestone_id, project_id, source, doc_id, node_id, node_label, doc_version, created_by)
    values
      (v_id, p_project_id, 'doqtri', p_doc_id, p_node_id, v_title, p_doc_version, auth.uid());
  exception when unique_violation then
    -- A concurrent create for the same node won the race. Raising undoes the
    -- milestone inserted above along with everything else.
    select l.milestone_id
      into v_existing
      from public.milestone_external_links l
     where l.doc_id = p_doc_id
       and l.node_id = p_node_id;

    raise exception 'node_already_linked'
      using errcode = 'QD409', hint = coalesce(v_existing::text, '');
  end;

  return v_id;
end;
$$;

comment on function public.create_linked_milestone(uuid, text, text, date, uuid, text, bigint) is
  'SECURITY DEFINER. POST /api/v1/milestones: creates a proposed milestone at the end of the project and links it to a doqtri node, in one transaction. Member and above; QD409 doc_not_linked or node_already_linked (HINT = existing milestone id).';


-- ----------------------------------------------------------------------------
-- 9. Grants
--
-- Tables: authenticated reaches them, RLS decides; anon gets nothing, like
-- every table in 20260731133313_rls.sql.
--
-- Functions: the trigger functions are called by Postgres and never by a
-- client (20260731133429_function_grants.sql's rule). assert_project_role()
-- runs only inside the RPCs, as their owner. The three RPCs go to
-- authenticated, which is what an OAuth token's role is.
-- ----------------------------------------------------------------------------

revoke all on table public.project_doc_links        from anon;
revoke all on table public.milestone_external_links from anon;
grant select, insert, update, delete on public.project_doc_links        to authenticated;
grant select, insert, update, delete on public.milestone_external_links to authenticated;

revoke all on function public.check_milestone_external_link() from public, anon, authenticated;
revoke all on function public.check_project_doc_link()        from public, anon, authenticated;
revoke all on function public.sync_link_doc_title()           from public, anon, authenticated;
revoke all on function public.guard_milestone_update()        from public, anon, authenticated;
revoke all on function public.sync_link_node_label()          from public, anon, authenticated;
revoke all on function public.assert_project_role(uuid, text) from public, anon, authenticated;

revoke all on function public.link_project_doc(uuid, uuid, text, text) from public, anon;
revoke all on function public.unlink_project_doc(uuid, uuid)           from public, anon;
revoke all on function
  public.create_linked_milestone(uuid, text, text, date, uuid, text, bigint) from public, anon;

grant execute on function public.link_project_doc(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.unlink_project_doc(uuid, uuid)           to authenticated, service_role;
grant execute on function
  public.create_linked_milestone(uuid, text, text, date, uuid, text, bigint) to authenticated, service_role;
