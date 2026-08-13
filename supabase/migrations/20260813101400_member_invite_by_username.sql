-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260813101400_member_invite_by_username.sql
--
-- Adding someone to a project by their username.
--
-- ---------------------------------------------------------------------------
-- WHY A THIRD ONE, AND WHY THIS IS NOW THE PRIMARY PATH
-- ---------------------------------------------------------------------------
-- 20260812130752_member_invite_by_wallet.sql made the wallet address primary
-- and email the fallback, and argued it like this: "email is the identifier
-- *some* accounts have, while the wallet address is the one they all have. The
-- universal identifier is the one an invite should key off."
--
-- That was true of the population it was written for, where connecting a wallet
-- created an account whose email was a placeholder nobody could type. It is not
-- true any more. Registration (20260812235342_profile_username.sql and the flow
-- around it) requires a username, an email and a password before an account
-- exists, so those two are universal — and the wallet address is now the
-- partial one, because every account created before that flow has none and can
-- only acquire one by connecting through Settings.
--
-- So the argument stands and its conclusion moves. The universal identifier is
-- still the one an invite should key off; it is just no longer the wallet.
--
-- Between the two that *are* universal, this one is the identifier a person can
-- be told out loud. An email address is someone's personal data and a Stellar
-- address is 56 characters of base32 that must be pasted to be got right.
--
-- All three stay. They resolve different things somebody might be holding, and
-- the app dispatches on the shape of what was typed rather than making an admin
-- declare which kind of identifier they have before they can paste it.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS SHAPED LIKE ITS SIBLINGS
-- ---------------------------------------------------------------------------
-- Identical defences, for identical reasons — the wallet version's header
-- carries the full argument and it is not repeated here:
--
--   1. The insert happens inside the function; it never returns a lookup, so it
--      cannot become a general-purpose directory.
--   2. Authorization runs against p_project_id *first*, before the username is
--      used for anything.
--   3. `search_path = ''`, every identifier schema-qualified.
--   4. `owner` is never assignable.
--
-- WHAT IT LEAKS, STATED PLAINLY: as with both siblings, a project admin can
-- tell "no such account" from "already a member" from "added", so they can test
-- whether a username is registered. This is the mildest of the three. A signup
-- form that enforces unique usernames answers the same question to anyone who
-- asks, which is why the exposure is worth accepting here and is argued much
-- more carefully for email, where the identifier is personal data.
-- ============================================================================


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
  'Authorizes the caller as an admin of that project before resolving the '
  'username, and performs the insert itself rather than returning a lookup, so '
  'it cannot be used as a general directory. Never assigns owner.';


-- Least privilege, spelled out rather than inherited — see the note in
-- 20260810034700_member_invite_by_email.sql: the default-privileges revoke set
-- in 20260731133429_function_grants.sql depends on which role runs the
-- migration, and a SECURITY DEFINER function that resolves identities is not
-- something to leave resting on that assumption. PUBLIC goes too, because
-- Postgres grants EXECUTE to PUBLIC on every new function and `anon` would
-- otherwise inherit through it.
revoke all on function
  public.add_project_member_by_username(uuid, text, public.member_role) from public, anon;

grant execute on function
  public.add_project_member_by_username(uuid, text, public.member_role) to authenticated, service_role;
