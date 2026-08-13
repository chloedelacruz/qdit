# Connecting a wallet no longer creates an account

> **Status: built, live, and tested end to end.** Everything in §§3–11 is
> implemented. Both migrations are applied to the hosted project, and
> `web/e2e/wallet-auth.spec.ts` drives the whole flow against it with a real
> signature and no wallet extension — see §14. One hosted-only setting remains,
> recorded in `gaps.md` §2. Running it found two defects that no amount of
> reading would have; they are fixed, and §15 says what they were.

Plan for putting a **registration screen** between "wallet proved" and "account
exists", so every qdit account is born with a username, an email and a password
bound to exactly one wallet address.

Supersedes §1, §4.3 and §5 of `WALLET-AUTH-PLAN.md`. Everything else in that
document — the SEP-10 challenge (§3), the session minting (§4.2), the
no-text-box rule for addresses (§6), RLS being untouched (§12) — still holds and
is not restated here.

---

## 1. The model, in one paragraph

Connecting a wallet proves control of a Stellar address. That proof buys **one of
two things and never a third**: if an account already holds the address, a
session; if none does, a *ticket* to the registration screen. The ticket is not a
session and grants nothing. Registration asks for a username, an email and a
password, and only then is the account created — with the proved address written
into it, permanently. A returning wallet types nothing. A new wallet types three
fields, once, ever.

Two invariants replace the ones in the old plan:

- **Every account has a username, a real email and a password.** No account can
  exist without a way back in that does not involve the wallet.
- **Every account has exactly one wallet address, fixed at creation.** It is
  written once and no application path can change it afterwards.

---

## 2. What changes, at a glance

| | Today | After |
|---|---|---|
| New wallet connects | account created silently, session minted | registration screen; no account until the form is submitted |
| Known wallet connects | session minted | **unchanged** — session minted, nothing typed |
| Account identifier | `<address>@wallet.qdit.local` | the email the user gave |
| `display_name` | truncated address (`GABC…WXYZ`) | the username |
| `profiles.wallet_address` | writable by `updateProfile`, `saveWalletAddress`, link | written once at creation; a trigger rejects every later change |
| Public Supabase signup | open | closed — all creation goes through the registration action |
| Recovery card (§5, never built) | planned | **dropped.** Registration makes it unnecessary |

---

## 3. The two answers `/verify` can give

`POST /api/auth/wallet/verify` keeps its `intent` parameter and its refusal to
infer intent from the session (that reasoning in the route header is still
correct and stays). What changes is that `intent: "sign-in"` gains a second
outcome:

```jsonc
// address is known
{ "address": "G…", "status": "signed-in" }

// address is unknown — NO account was created
{ "address": "G…", "status": "registration-required" }
```

plus a `Set-Cookie` carrying the registration ticket (§4). The client routes on
`status`: `signed-in` → `router.refresh()` + `/dashboard`, as now;
`registration-required` → `/register`.

### 3.1 This tells the caller whether an account exists. That is fine — here.

`/challenge` must keep answering identically for every address; it is the
enumeration oracle the codebase already refuses to be (`challenge/route.ts:8-16`,
`login/actions.ts:50`). But by the time `/verify` answers, **the caller has
signed a challenge for that address** — they control it. Telling someone whether
their own address has an account reveals nothing about a stranger. The property
`WALLET-AUTH-PLAN.md` §12 protects is preserved exactly, and the distinction is
worth a comment in the route handler because it looks like a regression and is
not.

---

## 4. The registration ticket

Between proof and account there is a gap the user spends filling in a form. That
gap needs something that says "this browser proved address G… at time T" and
that is *not* a session.

**An HttpOnly cookie holding an HMAC-signed token.** `qdit-wallet-ticket`,
`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 15-minute expiry:

```
base64url(address) . base64url(expiresAt) . base64url(hmacSHA256(key, address + "." + expiresAt))
```

- **Key**: `STELLAR_AUTH_SERVER_SECRET`, already required, already server-only,
  already documented as needing to be stable across deploys. No new env var.
- **HttpOnly is the point.** The session cookie deliberately is not (see the
  corrected note in `wallet-session.ts:150-164`), but this one never needs to be
  read by the page, so it should not be readable by the page.
- **15 minutes, not 5.** The challenge's own timebounds are 5 minutes, which is
  right for a signature round-trip and cruel for someone picking a password.

New file: `web/src/lib/auth/registration-ticket.ts` — `issueTicket(address)`,
`readTicket()`, `clearTicket()`. Pure-ish, unit-testable, `server-only`.

> Simpler variant considered and rejected: put the signed challenge XDR itself in
> the cookie and re-run `verifyChallenge()` at submit time. No new token format —
> but it inherits the 5-minute window, and a form that expires while you are
> reading it is a bad screen.

---

## 5. `/register`

New route: `web/src/app/register/page.tsx`, outside `(app)` — there is no session
yet, so it must not sit behind the auth gate in `(app)/layout.tsx:20`.

**Server component.** Reads the ticket:

- no ticket / expired → `redirect("/login")`. Nothing else; a bare visit to
  `/register` is not an error worth explaining.
- ticket valid, but the address now has an account (someone registered in
  another tab) → `redirect("/login")` with a note to connect again.
- ticket valid → render the form.

**The form** (`register-form.tsx`, client, `useActionState` — same shape as
`login-form.tsx`, which is the pattern to copy):

| Field | Rules |
|---|---|
| Wallet address | **Rendered, never an input.** Existing `HashLink` treatment, with the sentence: *"This wallet will be permanently linked to this account and cannot be changed."* |
| Username | 3–30 chars, `^[a-z0-9_]+$`, unique (§6) |
| Email | `z.email()` — the recovery credential |
| Password | min 6, matching `credentialsSchema` and Supabase's own floor |

Heading and copy: *"Finish setting up your account."* Not "Sign up" — they have
already done the hard part, and the screen should read as the last step of a
thing in progress rather than the start of a new one.

### 5.1 The server action

`completeWalletRegistration()` in `web/src/app/register/actions.ts`:

1. Parse with the new `walletRegistrationSchema` (§9). Field errors returned in
   the existing `AuthState` shape.
2. Read and verify the ticket. Absent or expired → `{ error: "That took too
   long. Connect your wallet again." }`. **The address comes from the ticket, never
   from the form** — same rule as `/verify` reading it from the signed XDR.
3. Rate-limit on the existing `clientKey`/`rateLimit` helpers. This creates
   accounts; it needs a tighter cap than `/verify`'s 10/min.
4. `admin.createUser({ email, password, email_confirm: false, app_metadata: {
   wallet_address }, user_metadata: { username, full_name: username } })`.
   **`app_metadata`, not `user_metadata`, for the address — see §7.**
5. Mint the session with the existing `mintSession()`. Unmodified.
6. `clearTicket()`, `revalidatePath("/", "layout")`, `redirect("/dashboard")`.

Failure paths that need real sentences, not a generic 500:

| Cause | Message |
|---|---|
| Email already registered | *"That email already has a qdit account. Sign in with it, then link this wallet from Settings."* — a true and actionable route, since `intent: "link"` still exists |
| Username taken (`23505` on the username index) | *"That username is taken."* as a field error |
| Address claimed between ticket and submit (`23505` on `profiles_wallet_address_key`) | *"That wallet was just registered. Connect it again to sign in."* |

### 5.2 Email confirmation — one thing to verify before writing this

`email_confirm: false` is what makes an unconfirmed address unable to open the
account, which is what stops someone registering with an email they do not own
and quietly acquiring a second door into it (`WALLET-AUTH-PLAN.md` §12, "recovery
email squatting"). The wallet signature is what grants the session, so nothing the
user needs is blocked on the inbox.

**Verify locally first** (`supabase start`, ~5 minutes): that
`admin.generateLink({ type: "magiclink" })` issues a token for an *unconfirmed*
user. If it refuses, the fallback is `email_confirm: true` plus an immediate
`supabase.auth.resend({ type: "email_change" })`-style re-verification — worse,
but not blocking. Settle this before step 4 above is written; it changes one line.

`admin.createUser` does not send mail. The confirmation has to be triggered
explicitly after creation.

---

## 6. Username

New column, additive:

```sql
alter table public.profiles add column username citext;

create unique index profiles_username_key on public.profiles (username)
  where username is not null;

alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,30}$');
```

- **`citext`**, so `Ada` and `ada` cannot both exist. Requires
  `create extension if not exists citext` — check it is not already enabled.
- **Nullable, with a partial unique index.** The two seeded users in `seed.sql`
  and any existing account predate this column; making it `not null` would mean
  backfilling before the migration can even apply. The *application* requires it
  at registration; the database only requires it to be unique when present.
- Backfill the seeded profiles in the same migration so the local stack and the
  e2e fixtures are not the only accounts without one.

`display_name` **stays**. It is free text, it is what the roster and assignee
menus render, and it is seeded from the username at registration. Username is the
stable handle; display name is what you call yourself. Collapsing them would mean
either a unique display name or a non-unique username, and both are worse.

---

## 7. Closing the metadata hole (pre-existing, unrelated to this feature)

`handle_new_user()` copies `raw_user_meta_data ->> 'wallet_address'` into the
profile. `raw_user_meta_data` is **whatever the client sent to Supabase's signup
endpoint**, and `config.toml` has `enable_signup = true`, so that endpoint is
open to anyone holding the publishable key.

Today an attacker can POST a signup with `data.wallet_address` set to any address
they do not control. The partial unique index stops them stealing an address that
is already claimed, but an *unclaimed* one is theirs — and the real owner can then
never register or sign in with their own wallet, because the lookup in
`signInWithWallet()` will resolve to the attacker's account.

Two fixes, both cheap, both in this plan:

1. **Read the address from `app_metadata` instead.** `raw_app_meta_data` is
   writable only by the service role; a public signup cannot touch it. One line in
   `handle_new_user()`:
   ```sql
   new.raw_app_meta_data ->> 'wallet_address'
   ```
   and `createUser` passes `app_metadata: { wallet_address }` (§5.1 step 4). This
   is the actual fix.
2. **Close public signup** — `enable_signup = false` under both `[auth]` and
   `[auth.email]` in `config.toml`, and the matching switch in the hosted
   project. All account creation now runs through the registration action on the
   admin client, so nothing legitimate uses the public endpoint any more.

Do both. (1) makes the trigger safe on its own; (2) means the endpoint that fed
it is not reachable either.

---

## 8. Making the address immutable

Three writers exist today. All three go.

- `updateProfile()` (`lib/actions.ts:787`) stops parsing and writing
  `wallet_address`; `EditProfileDialog` loses the free-text `G…` input. Removing
  it from the *action* and not merely the form is the same defence
  `projectMemberSchema` applies to the `owner` role.
- `saveWalletAddress()` (`lib/actions.ts:830`) is **deleted**. It takes a bare
  address and writes it, which is exactly the claim-vs-prove confusion the connect
  flow exists to end.
- `linkWalletToProfile()` **stays, gated**: `.is("wallet_address", null)` added to
  the update. An email-era account with no address can still attach one by
  connecting; an account that has one cannot swap it. Zero rows updated now means
  "already has one", which is a distinct outcome the route must report, not a
  silent success.

And the enforcement that does not depend on the app being correct — RLS lets a
user update their own profile row, so a hand-made PostgREST call bypasses all of
the above:

```sql
create or replace function public.freeze_wallet_address()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.wallet_address is not null
     and new.wallet_address is distinct from old.wallet_address then
    raise exception 'wallet_address is immutable once set'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_freeze_wallet_address
  before update on public.profiles
  for each row execute function public.freeze_wallet_address();
```

An operator who genuinely must rebind disables the trigger for the statement.
That is deliberately inconvenient.

### 8.1 What this costs, and it is your call

Immutability ends the lost-wallet rebind path in `WALLET-AUTH-PLAN.md` §6.1.
Someone who loses their seed phrase keeps their account and their history — they
sign in with email and password forever — but **can never anchor on-chain again**,
because anchoring needs a wallet and this account's wallet is gone.

Three options, in the order I would consider them:

1. **Immutable, as written above.** Rebinding is an operator action. Simplest,
   matches what you asked for, and is right if wallet loss is rare.
2. **Immutable except through a guarded flow** — require the current password
   *and* a signature from the new wallet, warn in plain words that the old address
   stops signing them in, and let the trigger accept the change when a session
   variable set by a `security definer` function says the flow ran.
3. Not immutable. Not recommended, and not what you asked for.

This plan implements (1). (2) is an additive follow-up that reuses everything
here.

---

## 9. Schemas, types, tests

```ts
// lib/schemas.ts — new, alongside credentialsSchema
export const usernameSchema = z.string().trim().toLowerCase()
  .min(3, "At least 3 characters.")
  .max(30, "Keep it under 30 characters.")
  .regex(/^[a-z0-9_]+$/, "Lowercase letters, numbers and underscores only.");

export const walletRegistrationSchema = credentialsSchema.extend({
  username: usernameSchema,
});
```

`profileSchema.walletAddress` **stays** — the server still validates the shape of
what it verified — but no form feeds it any more.

Unit tests (vitest, mirroring `wallet-identity.test.ts`):

- `registration-ticket.ts` — round-trips; rejects a tampered address, a tampered
  expiry, a ticket signed with a different key, and an expired one.
- `walletRegistrationSchema` — username casing, length, charset.
- `/verify` — unknown address returns `registration-required` **and creates no
  user**; known address still returns `signed-in`.
- `completeWalletRegistration` — no ticket refuses; expired ticket refuses; the
  address comes from the ticket even when the form body carries a different one.

E2E: the 124 existing specs are unaffected. `e2e/auth.setup.ts` signs in through
the email form, and the seeded users have real emails, passwords and addresses —
they are exactly the "email-era account" case. Add an anon spec asserting
`/register` bounces to `/login` without a ticket.

---

## 10. Legacy accounts with placeholder emails

Any account created by the current flow has `…@wallet.qdit.local`, no username and
no password. They must not be stranded.

`signInWithWallet()` already loads the auth user, so it already has the email.
When `hasRecoveryCredential(email)` is false, issue a ticket and return
`registration-required` **with a `mode: "complete"` flag** rather than minting a
session. `/register` renders the same form with different copy — *"Finish setting
up your account"* → *"Add a way back in"* — and the action takes the
`updateUser({ email, password })` path from `WALLET-AUTH-PLAN.md` §5.2 instead of
`createUser`, on the user's own session.

One screen, two modes, and the old plan's recovery card is not needed at all.

`placeholderEmail()` loses its only caller and goes.
`PLACEHOLDER_EMAIL_DOMAIN`, `isPlaceholderEmail()` and `hasRecoveryCredential()`
stay — they are how legacy accounts are recognised. Their header comment, which
describes a dashboard card that was never built, needs rewriting to describe this.

---

## 11. Files

**New**

```
web/src/lib/auth/registration-ticket.ts       issue / read / clear      (+ test)
web/src/app/register/page.tsx                 ticket gate, address read-only
web/src/app/register/register-form.tsx
web/src/app/register/actions.ts               completeWalletRegistration
supabase/migrations/<ts>_username.sql         §6
supabase/migrations/<ts>_wallet_immutable.sql §7 (trigger fn) + §8
```

**Changed**

```
web/src/lib/auth/wallet-session.ts       signInWithWallet stops creating;
                                         createUser moves to the register action;
                                         linkWalletToProfile gated to null
web/src/app/api/auth/wallet/verify/route.ts   two outcomes + ticket cookie
web/src/components/auth/connect-wallet-button.tsx  routes on `status`
web/src/lib/auth/wallet-identity.ts      drop placeholderEmail; rewrite header
web/src/lib/schemas.ts                   usernameSchema, walletRegistrationSchema
web/src/lib/actions.ts                   delete saveWalletAddress; updateProfile
                                         stops writing wallet_address
web/src/components/entity-dialogs.tsx    drop the address input
web/src/components/wallet-connect.tsx    linked = permanent, not editable
web/src/app/(app)/settings/page.tsx      the §2.3 comment is still wrong
web/src/app/login/page.tsx               "If this wallet is new here, it gets an
                                         account" is no longer true
web/src/app/login/actions.ts             delete the retired signUp()
web/src/app/page.tsx, landing/marketing-header.tsx   CTA copy
supabase/config.toml                     enable_signup = false (§7)
supabase/seed.sql                        usernames for the seeded profiles
WALLET-AUTH-PLAN.md                      §1, §4.3, §5 superseded — link here
gaps.md                                  both migrations in the version table
```

---

## 12. Order of work

| Step | Contents | Why here |
|---|---|---|
| 1 | Both migrations; `enable_signup = false`; `app_metadata` in the trigger | The security fix (§7) does not depend on any UI and should not wait behind it |
| 2 | `registration-ticket.ts` + tests | Pure, testable alone |
| 3 | `/verify` two outcomes; `signInWithWallet` stops creating | **The app is briefly unable to create accounts.** Intentional — nothing half-creates one |
| 4 | `/register` page, form, action; `ConnectWalletButton` routing | Closes the gap step 3 opened |
| 5 | Immutability: delete `saveWalletAddress`, gate linking, strip the address input | The trigger from step 1 already enforces it; this stops the app from generating errors against it |
| 6 | Legacy `mode: "complete"` (§10) | Only matters if such accounts exist — check first, it may be nothing |
| 7 | Copy, `WALLET-AUTH-PLAN.md`, `gaps.md`, `README.md`, e2e | |

Steps 3 and 4 are one PR. Shipping 3 alone means connecting a new wallet does
nothing at all.

---

## 13. How the open questions resolved

1. **Rebinding — (1), (2) or (3) in §8.1?** Built as **(1), immutable**, per the
   instruction that the address must not be editable afterwards. The trigger is
   in `20260812235413_wallet_address_immutable.sql` and its header documents the
   operator escape hatch. (2) remains an additive follow-up.

2. **Does `generateLink({ type: "magiclink" })` work for an unconfirmed user?**
   **Not answered, and routed around.** Answering it needs a running stack, and
   the only stack available is the user's live project — not somewhere to create
   throwaway accounts to satisfy curiosity. So `createWalletAccount()` uses
   `email_confirm: true`, which is the same call the shipped auto-create flow
   already makes and therefore the path this project is known to work on.
   The cost is stated in that function's header: an email can be registered by
   someone who does not own it. Closing it is a follow-up, and the follow-up is
   the thing this question was about.

3. **Are there real accounts with `@wallet.qdit.local` emails?** **Yes — one**,
   in the hosted project (6 users, 3 with wallets). So §10 is live code, not dead
   code: `signInWithWallet()` returns `complete-account` for it, and
   `(app)/layout.tsx` redirects it to `/register` until it has an email and a
   password.

4. **Should the username be public?** Still open, and now cheap to answer either
   way — `profiles.username` exists and is unique, so
   `add_project_member_by_username` is a migration and a dialog tab whenever it
   is wanted. Nothing depends on the answer today.

---

## 14. What is verified, and what is not

### Verified against the hosted database

Both migrations are applied. The triggers were probed in place, inside
`DO` blocks that end in `RAISE` so the whole probe rolls back and nothing is
committed — the result travels out in the error message. Afterwards: 6 users,
0 probe rows left, Ada's address unchanged, 0 profiles without a username.

- **The metadata hole is closed.** A row inserted into `auth.users` carrying
  *both* a legitimate `raw_app_meta_data.wallet_address` and a forged
  `raw_user_meta_data.wallet_address` — the exact shape a public signup could
  have sent — produced a profile holding the app_metadata address. The forged
  one was ignored.
- **`username` and `display_name` still unpack** from user metadata in the same
  insert (`probe_user`, `Probe User`).
- **The address is frozen.** Rebinding to a different address: refused
  (`42501`). Clearing it to null: refused. Writing the *same* value: allowed —
  which is the case that matters, because `supabase/seed.sql` does exactly that
  on every re-run and a stricter trigger would have broken reseeding.
- **The backfill.** All six profiles, no collisions, no nulls.

### Verified locally

`tsc --noEmit` clean, `eslint` clean, `next build` clean with `/register` in the
route manifest, 153 unit tests passing — including 9 for ticket forgery (swapped
address, extended expiry, wrong signing key, expiry) and 8 for the username
schema.

### Verified end to end

`web/e2e/wallet-auth.spec.ts` drives the whole flow against the hosted project
with a real signature and no wallet extension, and it passes. **The wallet
modal is not the interesting part** — every wallet in the kit signs a
transaction identically, so the spec signs the challenge itself with a keypair
it generates, and the server cannot tell the difference. That is the point of a
signature.

The keypair is never funded and never created on the ledger, and the spec never
touches the network: a SEP-10 challenge has sequence number 0 and is never
submitted, and `verifyChallenge()` uses `verifyChallengeTxSigners` against an
explicit signer list rather than `verifyChallengeTxThresholds`, which is the
call that would have needed Horizon.

Covered: an unknown wallet is offered registration and no account is created;
registering creates the account, binds the address and signs in; the same wallet
then signs in with nothing typed; one email cannot serve two wallets; a username
cannot be taken twice; a challenge signed by a different key is refused with 401.
Full suite: **136 passed, 1 skipped**. Accounts are deleted by
`cleanup.teardown.ts`, matched on the `e2e-wallet-` prefix.

Two real defects were found only by running it — both in §15.

### Still not verified

- **`enable_signup = false` together with session minting.** `config.toml` sets
  it locally; the hosted switch is deliberately not flipped. Minting goes through
  `generateLink` and nothing has proved that call is indifferent to the setting.
  **This is the one remaining change that could break sign-in for everyone.**
- **The `complete-account` path** for the one placeholder account in hosted.
  Reaching it means signing in as that account, which means holding its wallet.

---

## 15. Two things only a live run could find

Both were found by `wallet-auth.spec.ts` and both are fixed. They are recorded
because in each case the code was reasonable, the reasoning was written down,
and the reasoning was wrong.

**1. `app_metadata` is not populated when the trigger fires.**

§7 moved the wallet address from `raw_user_meta_data` to `raw_app_meta_data`
because only the service role can write the latter. That is still the right
security boundary and it still holds. What it does not do is arrive in time:
GoTrue's admin create inserts the `auth.users` row with `raw_app_meta_data`
holding only `{provider, providers}` — firing `handle_new_user()` — and merges
the custom `app_metadata` in a *later update*. `raw_user_meta_data` is present at
insert, which is why `username` and `display_name` came through and
`wallet_address` did not.

Observed directly: a created user comes back with `app_metadata.wallet_address`
set and its profile row holding `wallet_address: null`. The SQL probe in §14
missed it because it wrote `raw_app_meta_data` at insert, which is faithful to
the trigger and not to GoTrue.

Fixed by `bindWallet()` — an explicit service-role write after `createUser`,
which deletes the account if it fails, because §8's objection to a second
statement ("an account whose wallet cannot sign it in") is still correct and is
now answered by making the pair atomic by hand.

**2. supabase-js throws away the constraint name.**

`classifyCreateError()` distinguished a duplicate username from a duplicate
wallet by matching the index name in the error message. The raw REST endpoint
does return `duplicate key value violates unique constraint
"profiles_username_key"` — and supabase-js hands back `error.message === "{}"`,
with no code and no detail.

So a taken username reported "Could not create your account. Try again."
Fixed by asking the database instead: `usernameTaken()` runs before `createUser`
and again after an otherwise-unexplained failure, so the race is caught too. The
email case was never affected — a duplicate email is GoTrue's own check and
survives as a proper `email_exists`.
