-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260810034700_member_invite_by_email.sql
--
-- Adding someone to a project by their email address.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM THIS SOLVES
-- ---------------------------------------------------------------------------
-- `profiles` is readable only for yourself plus whoever shares_project_with()
-- matches, so the member picker can only ever offer people you already share a
-- project with. Someone outside that circle is not merely unlisted — they are
-- invisible to every query the client is allowed to make, so there is no way to
-- resolve them to a user id and therefore no way to add them. A workspace could
-- not grow past whoever was seeded into it.
--
-- ---------------------------------------------------------------------------
-- WHY THIS FUNCTION LOOKS DIFFERENT FROM THE OTHER SECURITY DEFINERS
-- ---------------------------------------------------------------------------
-- 20260731133313_rls.sql states the rule its helpers follow: each one "derives
-- the subject from auth.uid() and never from an argument, so it cannot be used
-- to probe another user's membership". This function takes an email argument.
-- That is a deliberate departure, and it is the only way to do this at all —
-- resolving a stranger is the entire feature.
--
-- So the departure is paid for three ways:
--
--   1. It performs the insert itself rather than returning a user id. A lookup
--      that returned ids would be a general-purpose address-book oracle for
--      anyone who could reach it; this can only ever add one person to one
--      project, which is the single operation the caller already had the right
--      to perform.
--   2. It authorizes against `p_project_id` *first*, via is_project_member(...,
--      'admin'), before the email is used for anything. A caller who is not an
--      admin of that specific project learns nothing, because the lookup never
--      runs.
--   3. It pins `set search_path = ''` and schema-qualifies everything, so a
--      caller cannot shadow auth.users or project_members on their own path.
--
-- WHAT IT STILL LEAKS, STATED PLAINLY: a project admin can distinguish "no
-- account with that email" from "already a member" from "added", so they can
-- test whether a given address has a qdit account. That is inherent to
-- invite-by-email in an app with no email delivery — the invitee must already
-- have signed up — and the alternative, a single opaque failure, makes the
-- feature unusable in exchange for withholding one bit from someone who already
-- administers a project. If email delivery is ever added, invert this: send an
-- invitation to any address and stop answering the existence question at all.
-- ============================================================================


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
  'SECURITY DEFINER. Adds the holder of p_email to p_project_id. Authorizes the '
  'caller as an admin of that project before resolving the address, and performs '
  'the insert itself rather than returning a lookup, so it cannot be used as a '
  'general address-book oracle. Never assigns the owner role.';


-- Least privilege, spelled out rather than inherited.
--
-- 20260731133429_function_grants.sql set `alter default privileges ... revoke
-- execute on functions from anon`, so this function already starts unreachable
-- by anon. The explicit revoke is still here because that default depends on
-- which role runs the migration, and a SECURITY DEFINER function that resolves
-- email addresses is not something to leave resting on that assumption. PUBLIC
-- goes too: Postgres grants EXECUTE to PUBLIC on every new function, and `anon`
-- would otherwise inherit through it.
revoke all on function
  public.add_project_member_by_email(uuid, text, public.member_role) from public, anon;

grant execute on function
  public.add_project_member_by_email(uuid, text, public.member_role) to authenticated, service_role;
