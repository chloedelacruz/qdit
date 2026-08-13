-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260812235342_profile_username.sql
--
-- A profile gains a username, and handle_new_user() stops trusting the client.
--
-- ---------------------------------------------------------------------------
-- WHY THESE TWO THINGS ARE ONE MIGRATION
-- ---------------------------------------------------------------------------
-- Both are changes to handle_new_user(), and rewriting that function twice in
-- two migrations would leave the intermediate version in the ledger as a thing
-- someone could deploy to and stop at. It is one function; this is one rewrite.
--
--   1. profiles.username — the handle a wallet account is registered with.
--   2. wallet_address is read from raw_app_meta_data, not raw_user_meta_data.
--
-- (2) is a security fix and is described at length in section 3. It is not
-- related to usernames and would be here anyway.
--
-- No Row Level Security policy is touched. `profiles: update own` already
-- permits a user to write their own row, and username is a column on that row;
-- the uniqueness guarantee below is an index, not a policy.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The column
--
-- `text` with a CHECK, not `citext`.
--
-- citext is the textbook answer to "usernames must not differ only by case",
-- and it costs an extension this database does not currently have. The cheaper
-- answer is to refuse to store a name that is not already lowercase: if `Ada`
-- can never be written, `Ada` and `ada` can never collide, and a plain unique
-- index is then exactly as strong as a case-insensitive one. The application
-- lowercases before it writes (see usernameSchema in web/src/lib/schemas.ts);
-- this constraint is what makes that a guarantee rather than a habit.
--
-- Nullable, deliberately. Every account that predates this column has no
-- username, including the two seeded profiles and the one wallet account that
-- the auto-create flow made. A NOT NULL column would have to be backfilled
-- before it could be added, and the backfill would be inventing names for
-- people. The *application* requires a username at registration; the database
-- requires only that one is unique when present.
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column username text;

alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,30}$');

-- Partial, for the same reason profiles_wallet_address_key is partial: null
-- means "not set yet" and any number of rows may be in that state.
create unique index profiles_username_key
  on public.profiles (username)
  where username is not null;

comment on column public.profiles.username is
  'Unique handle chosen at registration. Lowercase a-z, 0-9 and underscore, '
  '3-30 characters — the CHECK enforces lowercase so a plain unique index is '
  'sufficient and no citext extension is needed. Null on accounts predating '
  'the wallet registration flow.';


-- ----------------------------------------------------------------------------
-- 2. Backfill the accounts that predate the column
--
-- Derived from display_name, which for the seeded profiles is a human name and
-- for a wallet-created account is the shortened address (`GABC…WXYZ`). Lowercase
-- it, replace every character the format constraint rejects with an underscore,
-- collapse runs, and trim to length.
--
-- This can produce a collision — two display names that differ only in
-- punctuation — so the update is ordered and skips any name already taken. A row
-- that loses the race keeps a null username, which is a valid state and which
-- the owner resolves by picking one. Inventing `ada_2` for somebody is worse
-- than leaving the field blank.
--
-- Names shorter than three characters after cleaning are left null rather than
-- padded.
-- ----------------------------------------------------------------------------

with candidate as (
  select
    p.id,
    left(
      regexp_replace(
        regexp_replace(lower(coalesce(p.display_name, '')), '[^a-z0-9_]+', '_', 'g'),
        '_+', '_', 'g'
      ),
      30
    ) as name
  from public.profiles p
  where p.username is null
),
usable as (
  select c.id, btrim(c.name, '_') as name
  from candidate c
  where length(btrim(c.name, '_')) between 3 and 30
),
ranked as (
  select u.id, u.name, row_number() over (partition by u.name order by u.id) as rn
  from usable u
)
update public.profiles p
   set username = r.name
  from ranked r
 where p.id = r.id
   and r.rn = 1
   and not exists (
     select 1 from public.profiles other where other.username = r.name
   );


-- ----------------------------------------------------------------------------
-- 3. handle_new_user() — where the wallet address is allowed to come from
--
-- ---------------------------------------------------------------------------
-- THE BUG THIS FIXES
-- ---------------------------------------------------------------------------
-- 20260812130728_wallet_identity.sql taught this function to copy
--
--   new.raw_user_meta_data ->> 'wallet_address'
--
-- into the profile. raw_user_meta_data is whatever the client sent to GoTrue's
-- signup endpoint — it is the `data` field of a public POST /auth/v1/signup,
-- reachable by anyone holding the publishable key, which ships in the browser.
--
-- So until this migration, any visitor could create an account claiming any
-- Stellar address they do not control. The partial unique index stops them
-- taking an address some profile already holds, but an unclaimed one is theirs
-- for the asking — and then signInWithWallet() resolves that address to the
-- attacker's account, so the real owner of the wallet can never sign in with it
-- and cannot register it either. A denial of someone's own identity, for the
-- price of one HTTP request.
--
-- raw_app_meta_data is the fix. GoTrue refuses to let a client write it; only
-- the service role can, through admin.createUser({ app_metadata }). The web app
-- reaches that call from exactly one place — the registration action — and that
-- place only runs after verifyChallenge() has proved the signature.
--
-- Section 2 of supabase/config.toml closes the public signup endpoint as well,
-- so neither the door nor the thing behind it is available. Either fix alone
-- would do; both is correct, because the config is a setting someone can flip
-- back and this is not.
--
-- ---------------------------------------------------------------------------
-- WHAT ELSE CHANGED
-- ---------------------------------------------------------------------------
-- username is unpacked from raw_user_meta_data, which is safe for the same
-- reason display_name always has been: it is a label its owner chose, it grants
-- nothing, and the format CHECK plus the unique index in section 1 bound what
-- can be written. A forged signup could claim a username; it could not claim
-- somebody else's, and after config.toml there is no forged signup.
--
-- Everything else is unchanged from 20260812130728, including why this is
-- SECURITY DEFINER: it fires on auth.users during sign-up, when the effective
-- role is `supabase_auth_admin`, which holds no rights on public.profiles.
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, wallet_address, username)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    -- app, not user: only the service role can write this. See above.
    new.raw_app_meta_data ->> 'wallet_address',
    new.raw_user_meta_data ->> 'username'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT trigger on auth.users: creates the matching public.profiles '
  'row. wallet_address is read from raw_app_meta_data, which only the service '
  'role can write — reading it from raw_user_meta_data let any client claim an '
  'address it did not control. username and display_name come from user '
  'metadata, where a forged value grants nothing.';
