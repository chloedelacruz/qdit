-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261024110000_oauth_client_guards.sql
--
-- What a token issued to another app may do here, decided by the database.
--
-- ---------------------------------------------------------------------------
-- WHY THIS SHIPS BEFORE THE OAUTH SERVER IS SWITCHED ON
-- ---------------------------------------------------------------------------
-- qdit is about to become an OAuth 2.1 provider (masterplan D-02): doqtri asks
-- a qdit user for consent, and Supabase Auth then issues doqtri an access token
-- for that user. That token is an ordinary Supabase JWT. Its `role` is
-- `authenticated` and its `sub` is the user, so every policy in
-- 20260731133313_rls.sql reads it exactly as it reads the user's own session —
-- a token doqtri holds could approve milestones, delete projects and hand out
-- memberships, and read every task, review note and notification, because
-- the user it names can.
--
-- And it is not only reachable through /api/v1. PostgREST accepts the same JWT
-- with the publishable key that ships in every browser, so whatever an API
-- route refuses to do, a hand-written request to /rest/v1 can still try. The
-- rule therefore has to live where both paths end: here. Masterplan risk R-01
-- says these guards ship first, before the OAuth server is enabled anywhere,
-- so there is never a moment where such a token exists and this does not.
--
-- ---------------------------------------------------------------------------
-- WHAT TELLS THE TWO APART
-- ---------------------------------------------------------------------------
-- A token issued through the OAuth server carries a `client_id` claim naming
-- the OAuth client. A first-party session — wallet sign-in, email sign-in,
-- anything minted by this app — does not. So
--
--   (auth.jwt() ->> 'client_id') is null
--
-- is "this request is the user themselves". It is written below as
-- `((select auth.jwt()) ->> 'client_id') is null`, which is the same test with
-- the claim read once per statement instead of once per row, the way every
-- other policy here reads auth.uid().
--
-- ---------------------------------------------------------------------------
-- WHY RESTRICTIVE
-- ---------------------------------------------------------------------------
-- Permissive policies are OR-ed: adding one can only ever widen access.
-- Restrictive ones are AND-ed with whatever the permissive ones allowed, so a
-- restrictive policy can only narrow it. That is the shape this rule needs —
-- "everything the user may do, minus the things an app acting for them may
-- not" — and it means the existing role checks stay exactly as written.
--
-- They are `to public`, not `to authenticated`: a restrictive policy that
-- names fewer roles than the grants do leaves the others unguarded, and there
-- is no role this rule should not cover. (service_role has BYPASSRLS and is
-- unaffected either way.)
--
-- One is created for every INSERT, UPDATE and DELETE on every table, including
-- tables that today have no permissive policy for that command at all
-- (milestone_anchors and milestone_reviews have no UPDATE or DELETE;
-- notifications has no INSERT or DELETE). A restrictive policy grants nothing
-- by itself, so these cost nothing now, and they mean a permissive policy
-- added later does not quietly open the command to OAuth clients as well.
-- SELECT gets one on every table an app has no reason to read; the next
-- section lists the ones it may.
--
-- ---------------------------------------------------------------------------
-- WHAT AN OAUTH CLIENT KEEPS (D-03, D-32)
-- ---------------------------------------------------------------------------
-- D-03 says an app may read projects and milestones, and D-32 adds their
-- anchor records; nothing else. So reads are guarded too, not only writes.
-- What stays readable, under the user's own permissive policies:
--
--   projects           the projects the user belongs to (GET /projects)
--   milestones         the thing being linked (GET /milestones/{id})
--   milestone_anchors  each milestone's milestone_proof history, readable on
--                      purpose (D-32): this migration gives it no SELECT
--                      guard. Every column is a copy of a public ledger entry
--                      (D-04: the chain is the truth, this table only points
--                      at it), and the `anchor` object of GET /milestones/{id}
--                      in docs/integration/CONTRACT.md — version, last_action,
--                      last_tx_hash, anchored_at, proof_hash — is read from
--                      here. Writes to it are still guarded (section 9)
--   profiles           the user's own row only (GET /me) — not teammates',
--                      which carry their wallet addresses and usernames
--   project_members    the user's own row in each project only — that is,
--                      their role, which /api/v1 needs before it creates
--                      anything for them. Not the roster: who else is in a
--                      project is not something D-03 hands an app. The
--                      permissive policies on every other table ask
--                      is_project_member(), which reads the table as its
--                      owner, so none of them needs the roster to be visible.
--
-- And nothing at all from tasks, stellar_proofs, deployments,
-- milestone_reviews (rejection reasons are written to a person, not to an
-- app) or notifications. A restrictive SELECT policy hides rows rather than
-- raising, so a request for those tables answers with an empty list.
--
-- Writes it keeps:
--
--   * INSERT on public.milestones, under the existing "member+" policy, and
--     only with status 'proposed'. A milestone created already `approved`
--     would be an approval that never went through review, which is the exact
--     thing D-03 withholds; the integration contract says creation always
--     starts at proposed, and this is the copy of that rule a direct
--     PostgREST insert cannot get past.
--
-- Coming in WP-2.4, not here: title-only UPDATE of a *linked* milestone
-- (D-12), and INSERT on the link tables (project_doc_links,
-- milestone_external_links). WP-2.4 relaxes the milestones UPDATE guard below
-- for that one case and gives its own tables their own guards. Any table added
-- after this migration MUST add the same restrictive policies — one for each
-- of SELECT, INSERT, UPDATE and DELETE — or it is readable and writable by
-- every OAuth client its users have approved. A table that apps should read
-- skips only the SELECT one, and says so; supabase/tests/
-- oauth_client_guards.test.sql keeps the list of those and fails on any other.
--
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER FUNCTIONS
-- ---------------------------------------------------------------------------
-- RLS does not see inside a SECURITY DEFINER function: it runs as its owner,
-- which owns the tables and so is not subject to their policies. Every such
-- function that writes and is reachable by a client has to refuse OAuth
-- callers itself. Reading every migration, those are:
--
--   add_project_member_by_email     20260810034700  inserts project_members
--   add_project_member_by_wallet    20260812130752  inserts project_members
--   add_project_member_by_username  20260813101400  inserts project_members
--
-- They are recreated below, each unchanged except for a first step that calls
-- public.assert_first_party_session(). The other definer functions need
-- nothing:
--
--   is_project_member
--       read only, and answers yes/no about the caller's own membership,
--       which the caller's own project_members row shows anyway.
--   shares_project_with
--       read only, and answers yes/no to "do I share a project with this
--       user id". An app cannot list teammates' ids — the roster and their
--       profiles are hidden from it — so all it can do is confirm a guess,
--       and every id it can see without guessing (milestone_anchors.created_by,
--       projects.owner_id) is already one it knows shares a project.
--   public_milestone_proof
--       read only, and granted to anon: it returns data only for projects
--       with public_proofs = true, and then to anyone holding the slug and
--       milestone id. So an OAuth token gets nothing through it — including
--       the milestone_reviews reasons it returns, which section 10 otherwise
--       hides — that a signed-out visitor with the same slug and milestone id
--       could not.
--   handle_new_user      trigger on auth.users; not callable by clients.
--   handle_new_project   AFTER INSERT trigger on projects; the projects INSERT
--                        guard rejects the row before it can fire.
--   notify_milestone_status
--                        AFTER UPDATE trigger on milestones; the milestones
--                        UPDATE guard rejects the row before it can fire.
--
-- Approval and rejection have no RPC: the app moves milestones.status and
-- inserts a milestone_reviews row, and both writes are guarded below.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The check for SECURITY DEFINER functions
--
-- Not SECURITY DEFINER itself: auth.jwt() reads a request setting, which needs
-- no privilege. Callable by nobody but the functions that use it — they run as
-- their owner, so EXECUTE is checked against the owner, and a client calling
-- it directly would learn nothing it could not read from its own token.
-- ----------------------------------------------------------------------------

create or replace function public.assert_first_party_session()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'Apps connected through OAuth cannot do this.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.assert_first_party_session() is
  'Raises 42501 when the request JWT carries a client_id claim, i.e. it was '
  'issued to an OAuth client rather than being the user''s own session. Called '
  'first by every SECURITY DEFINER function that writes, because RLS — and so '
  'the restrictive OAuth guards — does not apply inside them.';

revoke all on function public.assert_first_party_session() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. profiles — an app never edits who you are, and sees only you
--
-- The SELECT guard keeps the user's own row so GET /api/v1/me can answer, and
-- hides teammates' rows, which "read own or teammate" would otherwise hand
-- over with their wallet addresses and usernames.
-- ----------------------------------------------------------------------------

create policy "profiles: only own row for oauth clients"
  on public.profiles
  as restrictive
  for select
  to public
  using (
    ((select auth.jwt()) ->> 'client_id') is null
    or id = (select auth.uid())
  );

create policy "profiles: no insert by oauth clients"
  on public.profiles
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "profiles: no update by oauth clients"
  on public.profiles
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "profiles: no delete by oauth clients"
  on public.profiles
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 3. projects — creating, editing and deleting a workspace stay first-party
-- ----------------------------------------------------------------------------

create policy "projects: no insert by oauth clients"
  on public.projects
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "projects: no update by oauth clients"
  on public.projects
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "projects: no delete by oauth clients"
  on public.projects
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 4. project_members — the user's own role, and no member management (D-03)
--
-- The SELECT guard keeps the user's own row in each project, which is all
-- /api/v1 needs to know their role, and hides everyone else's: "read as
-- member" would otherwise hand an app the whole roster — teammates' user ids
-- and roles — of every project the user is in.
--
-- The write guards include leaving: "delete as admin or leave" lets a user
-- remove their own row, and an app has no business taking a user out of a
-- project either.
-- ----------------------------------------------------------------------------

create policy "project_members: only own row for oauth clients"
  on public.project_members
  as restrictive
  for select
  to public
  using (
    ((select auth.jwt()) ->> 'client_id') is null
    or user_id = (select auth.uid())
  );

create policy "project_members: no insert by oauth clients"
  on public.project_members
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "project_members: no update by oauth clients"
  on public.project_members
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "project_members: no delete by oauth clients"
  on public.project_members
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 5. milestones — create yes (as proposed), change and delete no
--
-- UPDATE covers every column, status included, so this is what keeps approve
-- and reject first-party. WP-2.4 replaces the UPDATE guard with one that also
-- admits a title-only change to a linked milestone.
-- ----------------------------------------------------------------------------

create policy "milestones: oauth clients insert as proposed only"
  on public.milestones
  as restrictive
  for insert
  to public
  with check (
    ((select auth.jwt()) ->> 'client_id') is null
    or status = 'proposed'
  );

create policy "milestones: no update by oauth clients"
  on public.milestones
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "milestones: no delete by oauth clients"
  on public.milestones
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 6. tasks — not part of the integration at all (D-07: milestones only), so
-- not readable either
-- ----------------------------------------------------------------------------

create policy "tasks: no select by oauth clients"
  on public.tasks
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "tasks: no insert by oauth clients"
  on public.tasks
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "tasks: no update by oauth clients"
  on public.tasks
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "tasks: no delete by oauth clients"
  on public.tasks
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 7. stellar_proofs — proof of work is attached, and read, by the people who
-- did it
-- ----------------------------------------------------------------------------

create policy "stellar_proofs: no select by oauth clients"
  on public.stellar_proofs
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "stellar_proofs: no insert by oauth clients"
  on public.stellar_proofs
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "stellar_proofs: no update by oauth clients"
  on public.stellar_proofs
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "stellar_proofs: no delete by oauth clients"
  on public.stellar_proofs
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 8. deployments — not part of the integration; hidden and read-only
-- ----------------------------------------------------------------------------

create policy "deployments: no select by oauth clients"
  on public.deployments
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "deployments: no insert by oauth clients"
  on public.deployments
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "deployments: no update by oauth clients"
  on public.deployments
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "deployments: no delete by oauth clients"
  on public.deployments
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 9. milestone_anchors — the record that a transaction happened
--
-- An anchor row is written by the person who signed the transaction, in this
-- app. doqtri reads milestone_proof itself (D-04) and never records anchors
-- here. UPDATE and DELETE have no permissive policy today; see the header.
-- Reads stay open on purpose (D-32, see the header): the row is a pointer to
-- a public ledger entry, and GET /api/v1/milestones/{id} builds its `anchor`
-- object from it. Do not add a SELECT guard here.
-- ----------------------------------------------------------------------------

create policy "milestone_anchors: no insert by oauth clients"
  on public.milestone_anchors
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "milestone_anchors: no update by oauth clients"
  on public.milestone_anchors
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "milestone_anchors: no delete by oauth clients"
  on public.milestone_anchors
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 10. milestone_reviews — approve and reject write here, so this is half of
-- what keeps a decision first-party (the milestones UPDATE guard is the other).
-- Hidden as well: a rejection reason is written to the person who did the
-- work, and doqtri gets the outcome from milestones.status and the chain.
-- ----------------------------------------------------------------------------

create policy "milestone_reviews: no select by oauth clients"
  on public.milestone_reviews
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "milestone_reviews: no insert by oauth clients"
  on public.milestone_reviews
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "milestone_reviews: no update by oauth clients"
  on public.milestone_reviews
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "milestone_reviews: no delete by oauth clients"
  on public.milestone_reviews
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 11. notifications — the user's inbox; an app neither reads nor marks it
-- ----------------------------------------------------------------------------

create policy "notifications: no select by oauth clients"
  on public.notifications
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "notifications: no insert by oauth clients"
  on public.notifications
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "notifications: no update by oauth clients"
  on public.notifications
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "notifications: no delete by oauth clients"
  on public.notifications
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 12. Member invites — SECURITY DEFINER, so RLS cannot guard them
--
-- Each body is the one from its original migration with step (0) added.
-- Step (0) runs before authorization so an OAuth caller learns nothing, not
-- even whether it is an admin of the project. Signatures, volatility and
-- grants are unchanged; `create or replace` keeps the existing grants, and
-- they are restated anyway in the style of the originals.
-- ----------------------------------------------------------------------------

create or replace function public.add_project_member_by_email(
  p_project_id uuid,
  p_email      text,
  p_role       public.member_role
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  -- (0) Not through an app (D-03). See 20261024110000_oauth_client_guards.sql.
  perform public.assert_first_party_session();

  -- (1) Authorize before the email is touched. is_project_member() reads
  -- auth.uid(), so this asks "is the *caller* an admin here", never "is the
  -- argument". Owner outranks admin, so owners pass too.
  if not public.is_project_member(p_project_id, 'admin') then
    raise exception 'Not authorized to add members to this project.'
      using errcode = '42501';
  end if;

  -- (2) `owner` is not assignable. The owner row mirrors projects.owner_id,
  -- which the RLS policies and the contract's approver check both key off, so
  -- handing it out here would leave a project with two owners and only one of
  -- them recorded where it counts. schemas.ts omits it for the same reason;
  -- this is the copy a hand-made POST cannot get past.
  if p_role = 'owner' then
    raise exception 'Ownership is transferred, not granted.'
      using errcode = '22023';
  end if;

  -- (3) Resolve. Case-insensitive because email case is not significant and
  -- users type it however they please.
  select u.id
    into v_user_id
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
   limit 1;

  if v_user_id is null then
    raise exception 'No qdit account uses that email address.'
      using errcode = 'P0002';
  end if;

  -- (4) Insert. A duplicate surfaces as 23505 from the composite primary key,
  -- which the action phrases; it is not caught here, so the distinction between
  -- "added" and "already there" stays truthful.
  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, v_user_id, p_role);

  return v_user_id;
end;
$$;

comment on function public.add_project_member_by_email(uuid, text, public.member_role) is
  'SECURITY DEFINER. Adds the holder of p_email to p_project_id. Refuses OAuth '
  'clients first, then authorizes the caller as an admin of that project before '
  'resolving the address, and performs the insert itself rather than returning '
  'a lookup, so it cannot be used as a general address-book oracle. Never '
  'assigns the owner role.';

revoke all on function
  public.add_project_member_by_email(uuid, text, public.member_role) from public, anon;

grant execute on function
  public.add_project_member_by_email(uuid, text, public.member_role) to authenticated, service_role;


create or replace function public.add_project_member_by_wallet(
  p_project_id uuid,
  p_address    text,
  p_role       public.member_role
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_address text := btrim(p_address);
  v_user_id uuid;
begin
  -- (0) Not through an app (D-03). See 20261024110000_oauth_client_guards.sql.
  perform public.assert_first_party_session();

  -- (1) Authorize before the address is touched. is_project_member() reads
  -- auth.uid(), so this asks "is the *caller* an admin here", never "is the
  -- argument". Owner outranks admin, so owners pass too.
  if not public.is_project_member(p_project_id, 'admin') then
    raise exception 'Not authorized to add members to this project.'
      using errcode = '42501';
  end if;

  -- (2) `owner` is not assignable, for the reason the email version gives: the
  -- owner row mirrors projects.owner_id, which the RLS policies and the
  -- contract's approver check both key off, so handing it out here would leave
  -- a project with two owners and only one of them recorded where it counts.
  if p_role = 'owner' then
    raise exception 'Ownership is transferred, not granted.'
      using errcode = '22023';
  end if;

  -- (3) Shape check before the lookup. Strkeys are base32 with no lowercase, so
  -- unlike an email address there is nothing to normalise — a G-address either
  -- matches exactly or is not an address at all. Rejecting it here gives the
  -- caller a useful error instead of "no such account" for a typo.
  if v_address !~ '^G[A-Z2-7]{55}$' then
    raise exception 'That is not a Stellar account address.'
      using errcode = '22023';
  end if;

  -- (4) Resolve through profiles rather than auth.users: the address lives on
  -- the profile, and 20260812130728_wallet_identity.sql makes it unique, so
  -- this can match at most one row.
  select p.id
    into v_user_id
    from public.profiles p
   where p.wallet_address = v_address;

  if v_user_id is null then
    raise exception 'No qdit account has linked that wallet address.'
      using errcode = 'P0002';
  end if;

  -- (5) A duplicate surfaces as 23505 from the composite primary key, which the
  -- action phrases; it is not caught here, so the distinction between "added"
  -- and "already there" stays truthful.
  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, v_user_id, p_role);

  return v_user_id;
end;
$$;

comment on function public.add_project_member_by_wallet(uuid, text, public.member_role) is
  'SECURITY DEFINER. Adds the account that linked p_address to p_project_id. '
  'Refuses OAuth clients first, then authorizes the caller as an admin of that '
  'project before resolving the address, and performs the insert itself rather '
  'than returning a lookup, so it cannot be used as a general address-book '
  'oracle. Never assigns owner.';

revoke all on function
  public.add_project_member_by_wallet(uuid, text, public.member_role) from public, anon;

grant execute on function
  public.add_project_member_by_wallet(uuid, text, public.member_role) to authenticated, service_role;


create or replace function public.add_project_member_by_username(
  p_project_id uuid,
  p_username   text,
  p_role       public.member_role
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Lowercased, not merely trimmed. profiles_username_format refuses anything
  -- but lowercase, so `Ada` cannot name a row — and an admin typing a name the
  -- way a person capitalises it means the account, not a typo.
  v_username text := lower(btrim(p_username));
  v_user_id  uuid;
begin
  -- (0) Not through an app (D-03). See 20261024110000_oauth_client_guards.sql.
  perform public.assert_first_party_session();

  -- (1) Authorize before the username is touched. is_project_member() reads
  -- auth.uid(), so this asks "is the *caller* an admin here", never "is the
  -- argument". Owner outranks admin, so owners pass too.
  if not public.is_project_member(p_project_id, 'admin') then
    raise exception 'Not authorized to add members to this project.'
      using errcode = '42501';
  end if;

  -- (2) `owner` is not assignable: the owner row mirrors projects.owner_id,
  -- which the RLS policies and the contract's approver check both key off.
  if p_role = 'owner' then
    raise exception 'Ownership is transferred, not granted.'
      using errcode = '22023';
  end if;

  -- (3) Shape check before the lookup, so a malformed name gives a useful error
  -- rather than "no such account". Mirrors profiles_username_format exactly.
  if v_username !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'That is not a valid username.'
      using errcode = '22023';
  end if;

  -- (4) profiles_username_key makes this match at most one row.
  select p.id
    into v_user_id
    from public.profiles p
   where p.username = v_username;

  if v_user_id is null then
    raise exception 'No qdit account uses that username.'
      using errcode = 'P0002';
  end if;

  -- (5) A duplicate surfaces as 23505 from the composite primary key, which the
  -- action phrases; it is not caught here, so the distinction between "added"
  -- and "already there" stays truthful.
  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, v_user_id, p_role);

  return v_user_id;
end;
$$;

comment on function public.add_project_member_by_username(uuid, text, public.member_role) is
  'SECURITY DEFINER. Adds the account holding p_username to p_project_id. '
  'Refuses OAuth clients first, then authorizes the caller as an admin of that '
  'project before resolving the username, and performs the insert itself rather '
  'than returning a lookup, so it cannot be used as a general directory. Never '
  'assigns owner.';

revoke all on function
  public.add_project_member_by_username(uuid, text, public.member_role) from public, anon;

grant execute on function
  public.add_project_member_by_username(uuid, text, public.member_role) to authenticated, service_role;
