-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260812235413_wallet_address_immutable.sql
--
-- A wallet address is written once and never again.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT A POLICY
-- ---------------------------------------------------------------------------
-- Row Level Security decides which *rows* a caller may touch. `profiles: update
-- own` in 20260731133313_rls.sql lets a signed-in user update their own profile
-- row, and it cannot say "…except this column, and only when it is already
-- null". Postgres has column privileges, but they are all-or-nothing per role
-- and every authenticated user shares one role here, so revoking UPDATE on the
-- column would also stop the one legitimate write.
--
-- Which means removing the address field from the profile dialog and deleting
-- saveWalletAddress() — both of which this change does — protect the UI and
-- nothing else. PostgREST exposes the table directly. A hand-written PATCH to
-- /rest/v1/profiles with a session cookie walks past every line of TypeScript in
-- this repository. This trigger is the part that actually holds.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS COSTS, STATED PLAINLY
-- ---------------------------------------------------------------------------
-- Rebinding is now impossible from inside the application, and that is the
-- intended behaviour rather than an oversight. Someone who loses their wallet
-- keeps their account, their projects and their history — they sign in with the
-- email and password they registered with — but they can never anchor on-chain
-- again from that account, because anchoring needs a wallet and this account's
-- wallet is gone.
--
-- An operator who must rebind anyway does it deliberately:
--
--   alter table public.profiles disable trigger profiles_freeze_wallet_address;
--   update public.profiles set wallet_address = 'G…' where id = '…';
--   alter table public.profiles enable trigger profiles_freeze_wallet_address;
--
-- Inconvenient on purpose. If this turns out to be needed often, the fix is a
-- guarded rebind flow — current password plus a signature from the new wallet —
-- not a weaker trigger.
-- ============================================================================


create or replace function public.freeze_wallet_address()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- `is distinct from` rather than `<>`: a change to null is still a change,
  -- and `null <> 'G…'` is null, which is not true, which would let it through.
  if old.wallet_address is not null
     and new.wallet_address is distinct from old.wallet_address then
    raise exception
      'wallet_address is immutable once set (profile %)', old.id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.freeze_wallet_address() is
  'BEFORE UPDATE trigger on public.profiles: rejects any change to a '
  'wallet_address that is already set. The address is a proved identity, not a '
  'preference; it is written once by the registration flow and never edited.';

-- Not SECURITY DEFINER. It reads and rejects the row already being written and
-- needs no privilege the caller does not have — unlike handle_new_user(), which
-- inserts into a table its invoking role cannot see.
--
-- BEFORE UPDATE rather than AFTER: the point is to stop the write, and raising
-- in an AFTER trigger would roll the statement back with the same effect but
-- after the row had been touched.

create trigger profiles_freeze_wallet_address
  before update on public.profiles
  for each row
  execute function public.freeze_wallet_address();
