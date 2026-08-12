# Wallet is the front door

Plan for making **Connect wallet** the way people get into qdit, with email and
password kept as a recovery credential rather than the entrance.

Reference implementation for the connect flow: `../doqtri`, which has no login
at all — you connect a Stellar wallet and you are in the app. qdit takes the
same front door and adds a recovery path behind it, because a task hub that
loses a team's project history when someone loses a seed phrase is not
acceptable.

This file is the *design*. Nothing here is built yet.

---

## 1. The model, in one paragraph

Every qdit account is **born from a wallet**. Connecting proves control of a
Stellar account (a signed challenge, §3), and that proof is the credential: if
the address is known you are signed in, and if it is not, the account is created
and you are signed in anyway. You land in the app having typed nothing. *After*
that, onboarding offers to attach an email and password — framed as "so you can
get back in if you lose your wallet," not as a gate. Email sign-in stays exactly
as it is today and becomes the recovery path. Email *sign-up* is retired, since
accounts now start with a wallet.

Two invariants fall out, and everything downstream leans on them:

- **Every account has exactly one verified wallet address.** So the address is a
  universal identifier — usable for invites, the roster, and anchoring
  attribution.
- **An account may have a real email and password.** Optional, so nothing may
  *require* one.

---

## 2. What exists right now

| Piece | File | Behaviour |
|---|---|---|
| Sign in / sign up | `web/src/app/login/{page,login-form,actions}.tsx` | Supabase email + password |
| Auth gate | `web/src/app/(app)/layout.tsx:20` | `getUser()` → `redirect("/login")` |
| Session refresh | `web/src/proxy.ts`, `web/src/lib/supabase/proxy.ts` | refresh only — deliberately **not** an authorization gate |
| Real boundary | `supabase/migrations/20260731133313_rls.sql` | 30 policies, all keyed off `auth.uid()` via `project_members` |
| Profile mirror | `handle_new_user()` in `..._init.sql:100` | trigger on `auth.users` → `public.profiles` |
| Email confirm | `web/src/app/auth/callback/route.ts` | exists, currently only used by sign-up |
| Wallet | `web/src/lib/wallet.ts`, `web/src/components/wallet-connect.tsx` | connect / sign / `saveWalletAddress` onto the profile |
| Anchoring | `web/src/lib/chain/actions.ts` | client passes `signer`; server re-derives the real signer from the submitted XDR |
| Invites | `add_project_member_by_email()` in `..._member_invite_by_email.sql` | resolves a stranger by email, admin-gated |

Three facts that shape everything below:

1. **RLS never sees a wallet.** Every policy asks `auth.uid()`. This is an
   *authentication* change only — no policy is touched, no data is re-keyed.
2. **The web app holds no service-role secret today.** `web/.env.example:55`:
   *"Only needed for admin scripts or webhooks; the app does not use it."*
   Creating an account from a wallet is what changes that.
3. **`web/src/lib/wallet.ts` currently states the opposite of this plan** in its
   header — *"The wallet is an attestation key, not a login"* — and so does the
   comment at `(app)/settings/page.tsx:43`. Both need rewriting, not deleting;
   they are load-bearing explanations that will now be wrong.

---

## 3. Proving the wallet

doqtri's endpoint accepts a bare address, so anyone who types a public key gets
a session as its owner. Public keys are printed on every block explorer. For a
single-user note vault that is a small hole; qdit is multi-tenant, and a session
is read access to a team's projects, tasks, proofs and deployment history.

**SEP-10 style challenge–response.** No new dependency — `@stellar/stellar-sdk`
v16 already ships the helpers (verified at
`node_modules/@stellar/stellar-sdk/lib/esm/webauth/challenge_transaction.d.ts`):

```
POST /api/auth/wallet/challenge   { address }
  → WebAuth.buildChallengeTx(), signed by a server keypair,
    sequence 0, 5-minute timebounds
  → returns XDR

browser signs it with the existing signTransaction() in lib/wallet.ts

POST /api/auth/wallet/verify      { address, signedXdr }
  → WebAuth.readChallengeTx() + verifyChallengeTxSigners()
  → server signature, client signature and timebounds all check, or 401
```

The challenge transaction is **self-verifying** — it carries the server's
signature and its own expiry — so there is no nonce table to build or clean up.
Replay inside the 5-minute window yields the same session that wallet would have
got anyway.

Not `kit.signMessage()` (which exists, at
`@creit.tech/stellar-wallets-kit/esm/sdk/kit.d.ts:51`): wallets disagree about
what `signedMessage` contains. Every wallet in the kit implements
`signTransaction` correctly, and qdit already calls it — including capture mode,
which matters for §11.

`/verify` produces one thing, **a verified address**, and branches on whether the
caller already has a session:

- **no session, address known** → sign in (§4.2)
- **no session, address unknown** → create the account, then sign in (§4.3)
- **session** → link the address to that profile (§6)

One endpoint, one proof, three outcomes. That is what lets the landing page and
the profile editor share a single button.

---

## 4. Sessions and account creation

### 4.1 Link first

`profiles.wallet_address` already holds addresses for existing accounts, so the
lookup runs before anything is created. This is what makes §7.3 work — an
email-era account that links a wallet keeps its projects instead of waking up in
an empty second account.

The lookup reads across all profiles, which RLS forbids, so it runs on the
**admin client** inside the route handler. That is the new secret this feature
introduces (§9, §12).

It also needs a uniqueness guarantee that does not exist yet — two profiles can
currently hold the same `wallet_address`. Migration in §8.

### 4.2 Minting a session without a password

Wallet-created accounts have no password, and email-era accounts have one that
must not be touched. So neither path can use `signInWithPassword`:

```ts
admin.auth.admin.generateLink({ type: "magiclink", email })   // sends nothing
  → properties.hashed_token
supabase.auth.verifyOtp({ token_hash, type: "magiclink" })    // → session
```

Run `verifyOtp` on the **SSR server client** inside the route handler, so the
cookies are written server-side and no token ever reaches JavaScript. doqtri
returns the tokens to the browser and calls `setSession()`; qdit does not need
to, and a token that never reaches JS cannot be read by anything injected into
the page.

Note this is *not* doqtri's approach of deriving a password by HMAC and
resetting the user's password to it. qdit has real accounts with real passwords
and §4.1 deliberately signs those people in; silently overwriting the password
would break the recovery path this whole plan depends on.

### 4.3 Creating an account from a wallet

`admin.createUser({ email, email_confirm: true, user_metadata })` with:

- `email` — a placeholder, `<lowercased-address>@wallet.qdit.local`. Supabase
  requires an identifier and there is no real address yet. **Transitional**: it
  is replaced by the real one in §5.2, and it is never shown to a user (§7.1).
- `user_metadata.wallet_address` — the verified address.
- `user_metadata.full_name` — the shortened address (`GABC…WXYZ`), so
  `handle_new_user()` has something human to write into `display_name` instead
  of falling back to `split_part(email, '@', 1)`.

Then §4.2 for the session, and straight to `/dashboard`.

---

## 5. Onboarding — the recovery credential

This is the part that distinguishes this plan from wallet-only auth, and it is
the reason the flow is safe to ship.

### 5.1 Where it appears

A dismissible card at the top of `/dashboard`, shown when the account has no
real email:

> **Add a way back in.** Right now this account can only be opened with your
> wallet. Add an email and password and you can get back in if you lose it.
> `[ email ] [ password ] [Save]`  ·  `Skip for now`

Whether an email is "real" is derived, not stored: `!email.endsWith("@wallet.qdit.local")`.
Server-side, in the layout, exposed as a `hasRecoveryCredential` boolean. No
schema change.

"Skip for now" writes a `localStorage` flag — it is a nudge, not a workflow, and
a per-browser dismissal is proportionate. Settings always carries the same
control, so skipping never means losing the option. (If it should follow a user
across devices instead, that is a `profiles.recovery_prompt_dismissed_at`
column; I would not add one for this.)

### 5.2 Attaching the email

From the user's own session, no admin client:

```ts
supabase.auth.updateUser(
  { email, password },
  { emailRedirectTo: `${origin}/auth/callback` },
)
```

Supabase sends a confirmation to the new address; `/auth/callback` already
exists and handles the return. Until it is confirmed the placeholder stays and
the account is **entirely usable** — the wallet still signs you in. Nothing
blocks on the inbox, which is the property that lets this be optional.

**One config change is required.** `supabase/config.toml:62` sets
`double_confirm_changes = true`, which confirms email changes at *both* the old
and new addresses. The old address here is `…@wallet.qdit.local`, which is
undeliverable, so every attach attempt would silently never complete. Set it to
`false` locally and turn off the matching "Secure email change" setting in the
hosted project. Keep `enable_confirmations` **on** in hosted — an unconfirmed
recovery address would let someone squat an email they do not own.

Also check `secure_password_change` in the hosted project: if it requires a
recent login, setting a first password on a wallet session may be rejected.
Local config has it off (`config.toml:65`).

### 5.3 Settings gets a "Sign-in & recovery" section

The permanent home for all of it, and the only place the address is linkable:

| Row | States |
|---|---|
| Wallet | linked address + "Signs you in" · extension on a different address (§6.1) |
| Email | none yet → add · pending confirmation → resend · confirmed → change |
| Password | set · change |

---

## 6. Linking is the connect flow, everywhere

`profiles.wallet_address` has three writers today, and one of them is a text box:

1. `updateProfile()` — a free-text `<Input placeholder="G…">` in
   `EditProfileDialog` (`entity-dialogs.tsx:890`);
2. `saveWalletAddress()` — the address the kit reported;
3. the login path, after this plan.

The codebase already argues against the first. `lib/actions.ts:819`, on why
`saveWalletAddress` exists at all: *"the wallet flow has no form: the user
clicks Connect, picks a wallet, and the address arrives from the kit. Making
them retype it into the profile dialog would be the only way it could be
wrong."* The typed field survived that reasoning anyway. It should not survive
this change.

**You can link an address from your profile, but the only way to do it is to
connect the wallet.** No text box anywhere in the app. That is not just
ergonomics: typing an address *claims* one, connecting *proves* one, because the
connect flow is a signed challenge. Every address on every profile becomes
verified control — which is what the anchoring flow and the member roster have
been quietly assuming all along.

Concretely:

- `EditProfileDialog` loses the `walletAddress` field and keeps display name.
  `updateProfile()` stops parsing and writing `wallet_address`. Removing it from
  the *action*, not merely the form, is the same defence `projectMemberSchema`
  already applies to the `owner` role: *"omitting it from the schema means a
  hand-made POST cannot set it either."*
- `saveWalletAddress()` is **deleted**, not restricted. It takes a bare address
  and writes it. Its replacement is `/verify` with a session (§3).
- `profileSchema.walletAddress` stays — the server still validates the shape of
  what it verified.

### 6.1 Rebinding

One address per account. Linking B replaces A, and afterwards **A no longer
signs you in** — the confirmation says that sentence, not a softer one.

If B already sits on another profile the unique index (§8) rejects it: *"That
wallet already belongs to another qdit account."* Safe to say out loud, since
the caller just proved they control B.

Rebinding is also **the lost-wallet path**, and this is where the recovery
credential earns its place: sign in with email and password, open Settings,
connect the new wallet, rebind. Under wallet-only auth that path did not exist —
rebinding required the wallet you had lost.

Multiple addresses per account (a login key plus other signing keys) needs a
join table and a "which one signs this?" picker on every anchor. Not now.

---

## 7. Everything else that moves

### 7.1 Who you appear to be

`(app)/layout.tsx` passes `user.email` to `AppShell` → `UserMenu`, which derives
initials from the email local part. A wallet account's placeholder renders as
`gabc…local` with initials `GA`. Wrong on every screen at once.

The layout resolves a **display identity** instead — `profiles.display_name`,
falling back to the shortened address — and `UserMenu` shows the wallet address
beneath it in the existing `HashLink` treatment. The placeholder email is never
rendered; a real one is.

### 7.2 Signed-out surfaces

| Surface | Today | After |
|---|---|---|
| `/` hero | "Open the dashboard" → `/dashboard` → bounce to `/login` | **Connect wallet**, opening the kit modal in place. Signed-in visitors get "Open the dashboard" |
| `landing/marketing-header.tsx` | "Open app" | **Connect wallet** — same component |
| `/login` | the front door | demoted to recovery: "Signing in with a wallet? Connect it here" above the email form |
| `/login` sign-up toggle | switches to Create account | **retired** — accounts start with a wallet |
| Guarded routes | `redirect("/login")` | unchanged |
| `src/proxy.ts` | refresh only | **unchanged.** doqtri's proxy also redirects; qdit's header explains why it must not, and `(app)/layout.tsx` already gates |

Per the original "disable login but keep the code": `signUp()` stays in
`login/actions.ts`, unreferenced, with a comment saying what retired it.
`signIn()` stays live — it is the recovery path now.

### 7.3 Existing email-era accounts

They sign in as they always have, then link a wallet from Settings (§6). After
that either credential opens the account. Nothing is taken away and there is no
flag to flip, so — unlike the wallet-only draft of this plan — there is no
migration deadline and nobody can be locked out.

### 7.4 Anchoring gets stricter, for free

The anchor preparers take `signer` from the client. The server already refuses
to trust it at submit time, re-deriving the signer from the verified XDR, but at
prepare time it can now assert something it could not before:

```ts
if (signer !== sessionWalletAddress) return { ok: false, error: "…" };
```

Cheap, and it turns a confusing late failure into an early honest one.

### 7.5 Invites need a wallet path

`add_project_member_by_email()` resolves strangers through `auth.users.email`.
Every account now has a verified wallet address but only *some* have a real
email, so the address is the universal identifier and the email is the partial
one. The primary invite path has to be the wallet.

A sibling function, `add_project_member_by_wallet(p_project_id, p_address,
p_role)`, resolving through `profiles.wallet_address`. It copies the existing
function's defences verbatim — authorize against `p_project_id` first via
`is_project_member(…, 'admin')`, never assign `owner`, perform the insert itself
rather than returning a user id, `search_path = ''`, revoked from
`public`/`anon`. The header comment on the email version already argues each;
the wallet version inherits the argument and the same stated leak.

The dialog offers both: "Add by wallet address" first, "or by email" second. The
email function stays exactly as it is.

### 7.6 A brand-new account lands in an empty app

First-run is now common — it is one click from the landing page and the demo
depends on it. A fresh account has no projects, so `/dashboard` renders zeroed
tiles, the sidebar switcher is empty, and `/projects` shows "No projects yet".
Only the third is deliberate. The dashboard needs a first-run state that says
what to do next and links to project creation, sitting alongside the recovery
card from §5.1.

---

## 8. Database

Two migrations, both additive.

**`<ts>_wallet_identity.sql`**

- Partial unique index, so §4.1's lookup cannot be ambiguous:
  ```sql
  create unique index profiles_wallet_address_key
    on public.profiles (wallet_address)
    where wallet_address is not null;
  ```
  *Check the hosted table for duplicates first* — creation fails on conflict,
  which is the right failure but a surprising one mid-deploy.
- Extend `handle_new_user()` to copy `raw_user_meta_data ->> 'wallet_address'`
  into `profiles.wallet_address`. Keep it `security definer`, `search_path = ''`,
  schema-qualified — the existing header's reasoning still applies.

**`<ts>_member_invite_by_wallet.sql`** — §7.5, with grants mirroring the email
version.

Both belong in `gaps.md`'s migration-version table, which tracks repo/hosted
drift.

---

## 9. Files

**New**

```
web/src/lib/auth/challenge.ts                   build + verify wrappers
web/src/lib/auth/wallet-session.ts              link-or-create, minting (server-only)
web/src/app/api/auth/wallet/challenge/route.ts
web/src/app/api/auth/wallet/verify/route.ts     sign in · create · link
web/src/components/auth/connect-wallet-button.tsx
                                                one button: landing, /login, Settings
web/src/components/onboarding/recovery-card.tsx §5.1
supabase/migrations/<ts>_wallet_identity.sql
supabase/migrations/<ts>_member_invite_by_wallet.sql
```

**Changed**

```
web/src/app/page.tsx                    hero + closing CTA
web/src/components/landing/marketing-header.tsx
web/src/app/login/{page,login-form}.tsx demoted to recovery; sign-up retired
web/src/app/login/actions.ts            signUp() unreferenced + comment
web/src/app/(app)/layout.tsx            display identity; hasRecoveryCredential
web/src/components/layout/{app-shell,user-menu}.tsx
web/src/app/(app)/settings/page.tsx     Sign-in & recovery section (§5.3)
web/src/components/wallet-connect.tsx   the linking surface (§6)
web/src/components/entity-dialogs.tsx   drop the address field; invite by wallet
web/src/lib/actions.ts                  delete saveWalletAddress; updateProfile
                                        stops writing wallet_address; addMember
                                        → wallet RPC
web/src/lib/chain/actions.ts            signer === session wallet
web/src/lib/wallet.ts                   the header is now wrong (§2.3)
web/src/app/(app)/dashboard/page.tsx    first-run + recovery card
supabase/config.toml                    double_confirm_changes = false (§5.2)
web/.env.example                        §10
```

---

## 10. Environment

```bash
# Server-only. Bypasses RLS. Required by the wallet route handlers — the first
# thing in the app to need it.
SUPABASE_SECRET_KEY="sb_secret_…"

# Server-only. An unfunded Stellar keypair that signs SEP-10 challenges.
# Generate with Keypair.random(). Must be stable across deploys, or challenges
# issued before a restart fail verification.
STELLAR_AUTH_SERVER_SECRET="S…"
```

`SUPABASE_SECRET_KEY` must be reachable only from the two route handlers. Do not
add it to `lib/supabase/env.ts` — that module's header promises `NEXT_PUBLIC_*`
only, and the browser client imports it.

No new e2e variables: §11.

---

## 11. Tests and the demo

**The 124 existing e2e specs do not change.** `e2e/auth.setup.ts` signs in
through the email form and saves the session; email sign-in remains live as the
recovery path, and the seeded owner has a real address and password. This is a
large, quiet benefit of keeping email rather than deferring it — the wallet-only
draft of this plan required rewriting the setup handshake and re-linking the
seeded owner before anything could go green.

New coverage:

- **anon project** — the landing shows Connect wallet; `/login` still shows the
  email form; sign-up is gone.
- **route handlers, unit** — a valid signature mints a session; a tampered XDR,
  an expired challenge, and a challenge signed by a different key each 401;
  a known address links rather than creating; an unknown one creates exactly one
  account.
- **pure helpers, unit** — address validation, shortening, placeholder-email
  derivation and detection.
- **onboarding** — the recovery card appears for a placeholder-email account and
  disappears once an email is attached.

Driving the *browser* wallet modal from Playwright is not possible, so the
end-to-end connect path is covered by the route-handler tests plus capture mode,
exactly as anchoring already is.

**The demo video gains its best beat.** `video/capture/shoot.ts:149` and
`register.ts:93` log in through the email form; they can keep doing that, but
the demo should now open on Connect wallet, because that is the app's front
door. Capture mode already overrides `signTransaction()` in `lib/wallet.ts` —
the exact function the challenge flow uses — so the injected keypair signs the
challenge with no new machinery. The 1600ms dwell in that branch gives the beat
the same readable pause the anchor beat already has.

---

## 12. Security notes

- **New trust surface.** A service-role key now lives in the web app's
  environment. Contained to two route handlers, never imported by a client
  component, never re-exported from `lib/supabase/env.ts`.
- **Unchanged boundary.** RLS is untouched. Every policy still asks
  `auth.uid()`; a wallet session is an ordinary Supabase session. Nothing here
  weakens one of the 30 policies.
- **No enumeration.** `/challenge` answers for any address and returns a
  challenge, not a fact about whether an account exists, and `/verify` signs you
  in either way — creating on the fly rather than saying "no such account". This
  matters: it is what keeps the existing deliberate choice at
  `login/actions.ts:50` (*"do not try to distinguish them, that is account
  enumeration"*) true on the wallet path too.
- **Rate limiting.** `/verify` does signature verification and, on the create
  path, an admin write. Cap it per IP. There is no limiter in the app today, so
  this is new code, and it is small.
- **Recovery email squatting.** Keep `enable_confirmations` on in hosted, or a
  user could attach an address they do not own and make it a second way in.
- **Contract-side.** Unchanged. `assertInvocation` still runs, the signer is
  still re-derived from the submitted transaction, and the app still holds no
  key.
- **`NEXT_PUBLIC_CAPTURE_MODE`** is still build-time-inlined and absent from
  deployed builds. §11 does not change that.

---

## 13. Phasing

| PR | Contents | Rough size |
|---|---|---|
| 1 | Migrations (§8), `challenge.ts`, `wallet-session.ts`, both route handlers, unit tests — **written; migrations not applied and the handlers have never run** | half a day |
| 2 | `ConnectWalletButton`; landing + header CTA; `/login` demoted, sign-up retired | half a day |
| 3 | Onboarding recovery card (§5.1–5.2), Settings sign-in & recovery (§5.3), `config.toml` + hosted auth settings | half a day |
| 4 | Identity display (§7.1), linking + rebind in Settings (§6), signer assertion (§7.4) | few hours |
| 5 | Invite by wallet (§7.5), first-run dashboard state (§7.6) | few hours |
| 6 | e2e additions (§11), demo capture beat, `README.md`, `gaps.md`, `.env.example` | few hours |

PR 1 is testable on its own with `curl` and a local keypair, before any UI
exists. **PRs 1–2 make "connect a wallet and you're in the app" true**, which is
the headline. PR 3 is what makes it responsible — ship 1–2 without it and every
new account is one lost seed phrase away from being unrecoverable, which is the
exact failure this design was chosen to avoid. Do not leave it for later.

There is no flag flip and no migration deadline anywhere in this list.

---

## 14. Open questions

1. **Does the hosted `profiles` table have duplicate `wallet_address` values?**
   Blocks the unique index in §8. One query answers it.
2. **Should the recovery prompt ever become mandatory** — e.g. before creating a
   first project, or before being added to someone else's? Optional forever is
   the assumption here; a soft gate at "you now have data worth losing" is the
   obvious alternative and is a one-line condition wherever the card lives.
3. **Rebinding: allowed?** §6.1 assumes yes, warned plainly. It is now much
   safer than under wallet-only auth, since the recovery credential means a lost
   wallet is no longer a lost account.
4. **Placeholder domain** — `@wallet.qdit.local`. It never renders (§7.1), but
   it does land in `auth.users`, so it is worth agreeing on once rather than
   twice.
