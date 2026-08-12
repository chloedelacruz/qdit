-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260812130752_member_invite_by_wallet.sql
--
-- Adding someone to a project by their wallet address.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS ALONGSIDE add_project_member_by_email()
-- ---------------------------------------------------------------------------
-- 20260810034700_member_invite_by_email.sql solved "a workspace could not grow
-- past whoever was seeded into it" by resolving a stranger through
-- auth.users.email. That worked when every account was an email sign-up.
--
-- It no longer describes the population. Accounts are now created by connecting
-- a wallet, and the email on such an account is a placeholder nobody knows or
-- could type. Attaching a real address is offered afterwards, as recovery, and
-- is optional — so email is the identifier *some* accounts have, while the
-- wallet address is the one they all have.
--
-- The universal identifier is the one an invite should key off. This function
-- is therefore the primary path and the email version is the fallback, which is
-- the reverse of how they were built.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS SHAPED LIKE ITS SIBLING
-- ---------------------------------------------------------------------------
-- 20260731133313_rls.sql states the rule its helpers follow: each one "derives
-- the subject from auth.uid() and never from an argument". Both invite
-- functions depart from that, because resolving a stranger is the entire
-- feature, and both pay for the departure the same three ways:
--
--   1. The insert happens here. A function that *returned* a user id would be a
--      general-purpose address-book oracle for anyone who could reach it; this
--      can only ever add one person to one project, which is the operation the
--      caller already had the right to perform.
--   2. Authorization runs against p_project_id *first*, before the address is
--      used for anything. A caller who is not an admin of that specific project
--      learns nothing, because the lookup never runs.
--   3. `search_path = ''` with every identifier schema-qualified, so a caller
--      cannot shadow public.profiles or public.project_members on their own path.
--
-- WHAT IT STILL LEAKS, STATED PLAINLY: a project admin can distinguish "no
-- account has linked that wallet" from "already a member" from "added", so they
-- can test whether a given address has a qdit account. The email version's
-- header makes the same admission and the same argument for accepting it. One
-- difference is worth naming: a Stellar address is public by construction —
-- it is on the ledger — so what leaks is an association, never the identifier.
-- ============================================================================


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
  'Authorizes the caller as an admin of that project before resolving the '
  'address, and performs the insert itself rather than returning a lookup, so '
  'it cannot be used as a general address-book oracle. Never assigns owner.';


-- Least privilege, spelled out rather than inherited — see the note in
-- 20260810034700_member_invite_by_email.sql: the default-privileges revoke set
-- in 20260731133429_function_grants.sql depends on which role runs the
-- migration, and a SECURITY DEFINER function that resolves identities is not
-- something to leave resting on that assumption. PUBLIC goes too, because
-- Postgres grants EXECUTE to PUBLIC on every new function and `anon` would
-- otherwise inherit through it.
revoke all on function
  public.add_project_member_by_wallet(uuid, text, public.member_role) from public, anon;

grant execute on function
  public.add_project_member_by_wallet(uuid, text, public.member_role) to authenticated, service_role;
