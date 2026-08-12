-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260812130728_wallet_identity.sql
--
-- The wallet stops being an attestation key and becomes a credential.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
-- ---------------------------------------------------------------------------
-- Not a single Row Level Security policy is touched by this migration, and that
-- is the point. Every policy in 20260731133313_rls.sql derives access from
-- auth.uid() through public.project_members; a session minted from a wallet
-- signature is an ordinary Supabase session with an ordinary uid. The wallet is
-- a new way to *obtain* a session, not a new way to authorize one.
--
-- Two things do change:
--
--   1. profiles.wallet_address becomes an identity, so it has to be unique.
--   2. handle_new_user() learns to carry a wallet address in from sign-up
--      metadata, so an account created by connecting a wallet arrives complete.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. One account per wallet
--
-- Sign-in resolves a wallet address to an account by looking it up here. Two
-- profiles holding the same address would make that lookup ambiguous, and the
-- ambiguity would not surface as an error — whichever row the planner returned
-- first would win, so the same wallet could open different accounts on
-- different days.
--
-- Partial, because `null` means "no wallet linked yet" and any number of
-- accounts may be in that state. Postgres would permit duplicate nulls in a
-- plain unique index anyway; the WHERE clause says so on purpose and keeps the
-- index off the rows that will never be searched by address.
--
-- This fails loudly if the table already holds a duplicate. That is the correct
-- failure — a duplicate is a pre-existing bug this migration must not paper
-- over — but check before deploying rather than during:
--
--   select wallet_address, count(*)
--     from public.profiles
--    where wallet_address is not null
--    group by 1 having count(*) > 1;
-- ----------------------------------------------------------------------------

create unique index profiles_wallet_address_key
  on public.profiles (wallet_address)
  where wallet_address is not null;

comment on index public.profiles_wallet_address_key is
  'One account per Stellar address. Sign-in resolves a wallet to an account '
  'through this column, so a duplicate would let one wallet open two accounts.';


-- ----------------------------------------------------------------------------
-- 2. Carry the wallet address in from sign-up metadata
--
-- An account created by connecting a wallet is created through the Auth admin
-- API, which can write auth.users but knows nothing about public.profiles. The
-- profile row is made by this trigger, a moment later and in the same
-- transaction. So the address has to travel as user metadata and be unpacked
-- here.
--
-- The alternative — have the app write profiles.wallet_address in a second
-- statement after creating the user — was rejected: it can fail on its own,
-- leaving an account whose wallet cannot sign it in, which is an account nobody
-- can open.
--
-- `full_name` is already the first thing display_name falls back to, and the
-- sign-in path sets it to the shortened address. Without that, the last resort
-- is `split_part(email, '@', 1)`, which for a wallet account is the lowercased
-- 56-character address — technically a name, and unusable as one.
--
-- Everything else about this function is unchanged from 20260731133219_init.sql,
-- including why it is SECURITY DEFINER: it fires on auth.users during sign-up,
-- when the effective role is `supabase_auth_admin`, which holds no rights on
-- public.profiles.
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, wallet_address)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    -- Null for an email sign-up, which links a wallet later from Settings.
    new.raw_user_meta_data ->> 'wallet_address'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT trigger on auth.users: creates the matching public.profiles '
  'row, carrying wallet_address and full_name in from sign-up metadata so an '
  'account created by connecting a wallet arrives complete.';
