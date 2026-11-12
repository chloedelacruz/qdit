# Hackathon runbook (WP-4.7)

How to switch on, run, rehearse and roll back the hackathon submission portal:
qdit's `/hackathons/<slug>` pages, the hidden AI review and doqtri's
**Send to qdit hackathon**. Decisions D-115 to D-119, risks R-12 to R-18 (end of this
page). Jira: QDIT-41 (epic), QDIT-42 to QDIT-49; doqtri DOQ-37 to DOQ-40.

Who does what: steps marked **Owner** are the product owner's (production database,
Vercel settings, merges to `main`). Everything else an admin of the hackathon does in
qdit's UI.

> Merging to `main` deploys to production, in both repos. There is no staging. Apply each
> migration **before** merging the code that needs it.

---

## 1. Owner steps, in order

### 1.1 Apply the doqtri migration, before merging doqtri #114

`doqtri/backend/migrations/20261110100000_documents_created_at.sql` adds
`documents.created_at` (backfilled from `updated_at`). doqtri #114 reads that column, so
production doqtri breaks if #114 lands first.

Apply it the way doqtri's other migrations are applied to production, then check:

```sql
select count(*) filter (where created_at is null) as missing,
       count(*) as total
  from public.documents;          -- missing = 0
```

### 1.2 Apply the qdit migration

`supabase/migrations/20261110100000_hackathons.sql`: new tables only, the private
`hackathon-mindmaps` bucket, the RPCs and two pg_cron jobs. No existing table changes.

Apply it with the Supabase CLI so it is recorded in `supabase_migrations.schema_migrations`
(README, "Database"). Not by pasting it into the SQL editor. Then check:

```sql
select count(*) from public.hackathons;                     -- 0, and no error
select id, public, file_size_limit from storage.buckets
 where id = 'hackathon-mindmaps';                           -- false, 5242880
select jobname, schedule, active from cron.job
 where jobname in ('qdit-grade-hackathon', 'qdit-prune-hackathon-snapshots');
```

The migration warns that the grading job "will send nothing until Vault holds
qdit_grade_hackathon_url". That is expected until step 1.4.

### 1.3 Set `ANTHROPIC_API_KEY` in Vercel

Vercel, project qdit (team admts-projects), Settings > Environment Variables:
`ANTHROPIC_API_KEY` for **Production** only. Optional: `HACKATHON_GRADER_MODEL` (default
`claude-sonnet-5-5`); change it only between events. Redeploy (or merge the next PR) so
the functions pick the key up.

Never set `HACKATHON_GRADER_FAKE` in Vercel. Production builds ignore it anyway
(`src/lib/hackathon/fake-grader.ts`), but it has no business there.

Before the event, check the Anthropic account's rate-limit tier (Q-16, R-12): about
120 to 180 calls within a few minutes of the close, each up to about 30k input tokens
with images.

### 1.4 Store the Vault secret `qdit_grade_hackathon_url`

`qdit_cron_secret` already exists (webhook delivery uses it). In the SQL editor:

```sql
select vault.create_secret('https://<qdit host>/api/cron/grade-hackathon',
                           'qdit_grade_hackathon_url');
select public.hackathon_grading_scheduler_health();
-- {"job": true, "status": "configured", "missing_secrets": []}
```

`<qdit host>` is the production host, the same one as in `qdit_deliver_webhooks_url`.

### 1.5 Create the hackathon

A qdit operator creates it on `/hackathons/manage` > **New hackathon** (QDIT-56): name,
slug (`a-z`, `0-9` and `-`, e.g. `bootcamp-2026-11`; `manage` is reserved), description,
opens and closes in Manila time, team size and finalists. The creator becomes its first
admin. The same page edits it, hides it (out of the Hackathons list and the banner, still
open by link) and deletes it while no team has sent work to it. After that, Hide it
instead. The slug is locked once a team has sent work, because doqtri finds the hackathon
by slug. Dates, team size and finalists are locked once grades are released.

Operators are rows in `public.qdit_operators`, added in the SQL editor (no client can
write the table):

```sql
insert into public.qdit_operators (user_id, note)
select p.id, '<why>' from public.profiles p where p.username = '<username>';
```

That admin adds the other admins and the judges by username on
`/hackathons/<slug>/admin` > Staff. A staff member cannot be on a team, and the last admin
cannot be removed.

Hand teams the link `https://<qdit host>/hackathons/<slug>`. The page is not in the
sidebar.

### 1.6 Turn the flags on in doqtri

In doqtri's Vercel project (Production): `NEXT_PUBLIC_QDIT_HACKATHON=1`. It needs
`NEXT_PUBLIC_QDIT_INTEGRATION=1` too, which is already on wherever doqtri connects to
qdit. Both are build-time, so redeploy. With either one off, the **Send to qdit
hackathon** button is hidden and `POST /api/integrations/qdit/hackathon` answers 404.

### 1.7 Apply the hackathon list migration, before merging QDIT-60 (mandatory)

`supabase/migrations/20261111120000_hackathon_list_for_clients.sql` adds one function,
`list_open_hackathons_for_client()`, behind `GET /api/v1/hackathons` (contract v1.3.0,
D-122). doqtri's Send to qdit hackathon dialog uses it to list hackathons instead of asking
for a link. No table or policy changes: the `hackathons` table stays closed to apps.

This is the first step for QDIT-60, not optional. Merged before the migration, the route
answers `500 internal_error`, and doqtri falls back to the link field **only** on qdit's
JSON `404 not_found` (a qdit without the route). On a 500 the dialog has no list and no
fallback, so teams cannot send a snapshot until the migration is applied.

Apply it with the Supabase CLI, as in 1.2, then check:

```sql
select p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p
 where p.oid = 'public.list_open_hackathons_for_client()'::regprocedure;
-- t, {"search_path=\"\""}, f, t
```

The list holds what the Hackathons index and the banner show to everyone: not hidden, no
`test-` slug, not yet closed, earliest first, at most 50. So **Hide** on
`/hackathons/manage` also takes a hackathon out of doqtri's list. A closed hackathon is never
listed; a team with a late pass sends by link, as before.

### 1.8 Apply the Slides link migration, before merging QDIT-63 (mandatory)

`supabase/migrations/20261112062735_hackathon_slides_link.sql` (D-123) adds
`hackathon_submission_versions.slides_url`, the internal `hackathon_slides_url_ok(text)` and
replaces `submit_hackathon_entry` with a six-argument form whose `p_slides_url` is required.

**Applied to production on 12 Nov 2026** through the Supabase MCP, which stamped it
`20261112062735`; the file was renamed to match (authored as `20261112120000`). The checks
below passed.

Apply it first, then merge the code. Between the two, the live app still calls the function
with five named arguments: that resolves to the new function, which answers `22023 Add the
link to your slides.` and the dialog shows it as a form error. **Teams cannot submit in that
gap**, so do not apply it during an open submission window unless the merge follows at once.
The other order is worse: new code against the old function fails every submit with
"function does not exist".

Apply it with the Supabase CLI, as in 1.2, then check:

```sql
select pg_get_function_identity_arguments(p.oid), p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_hackathon_entry';
-- one row: …, p_image_paths text[], p_slides_url text | t | {"search_path=\"\""} | f | t

select has_column_privilege('authenticated', 'public.hackathon_submission_versions', 'slides_url', 'select');
-- t
```

Entries submitted before it have no link. Their team adds one on its next resubmit; the
staff submission page says "no slides link" and the export leaves the cell empty.

### 1.9 Apply the Mindmap link migration, then deploy qdit, then let doqtri send links (mandatory order)

`supabase/migrations/20261112140000_hackathon_mindmap_link.sql` (QDIT-66, contract v1.4.0)
adds `mindmap_url` to `hackathon_doqtri_snapshots` and to `hackathon_submission_versions`,
the internal `hackathon_mindmap_url_ok(text)` and `hackathon_mindmap_url_allowed(text)`,
stores the snapshot body's `mindmap_url` in `push_doqtri_hackathon_snapshot` (same
signature), and replaces `submit_hackathon_entry` with a seven-argument form whose
`p_mindmap_url` is optional. doqtri's side is DOQ-53, which hosts the public page at
`<doqtri origin>/m/<token>` and sends that URL with each Send.

The order is fixed, and each step waits for the one before it:

1. **Apply the migration.** It is safe with the live app: the old code calls
   `submit_hackathon_entry` with six named arguments, which the new default covers, and the
   old API route still refuses a body with `mindmap_url` before it reaches the database.
   No submit is refused in the gap, so it can be applied during a window.
2. **Deploy qdit (merge QDIT-66).** The new code calls `submit_hackathon_entry` with
   `p_mindmap_url`; against the old function that is "function does not exist" on every
   submit, so never merge before step 1.
3. **Only then merge doqtri DOQ-53**, or turn on whatever makes doqtri send `mindmap_url`.
   A qdit without QDIT-66 answers every snapshot that carries the field, `null` included,
   with `400 invalid_request` (`"mindmap_url": "unknown field"`): teams could not Send at
   all. The contract lets doqtri resend without the field on exactly that answer, but do not
   rely on it during an event.

Apply it with the Supabase CLI, as in 1.2, then check:

```sql
select pg_get_function_identity_arguments(p.oid), p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname = 'submit_hackathon_entry';
-- one row: …, p_slides_url text, p_mindmap_url text | t | {"search_path=\"\""} | f | t

select has_column_privilege('authenticated', 'public.hackathon_submission_versions', 'mindmap_url', 'select'),
       has_column_privilege('authenticated', 'public.hackathon_doqtri_snapshots', 'mindmap_url', 'select');
-- t | t

select doqtri_origin from public.integration_settings;
-- https://www.doqtri.xyz in production
```

The last check matters: with `integration_settings.doqtri_origin` set, the database refuses
a link off doqtri's origin even from a hand-written call; unset, it checks only the shape
and the app's `DOQTRI_ORIGIN` check is the only origin check (as for `doc_url`, D-95). Set it
as in `docs/integration/qdit-oauth-setup.md` if it is empty.

What teams and staff see: the submit dialog's optional **Mindmap link** field fills itself
from the newest snapshot's link ("Filled from your latest Send in doqtri"), and a team can
paste another doqtri mindmap link or clear it. The link is stored on the submission version,
so it survives the 90-day snapshot pruning. The team card and the staff submission page show
**Open mindmap**, and Export submissions has a `Mindmap link` column. Images stay required;
eligibility, the grader and the image columns are unchanged. Entries submitted before it, or
by a team whose doqtri predates DOQ-53, have no link: the button is simply absent and the
cell empty.

### 1.10 Mindmap link status and `hackathon.released`: doqtri DOQ-54, then qdit's code, then the migration (QDIT-67)

QDIT-67 (contract v1.5.0) does two things:

- qdit asks doqtri's public `POST <doqtri origin>/api/mindmap-links/status` whether each
  mindmap link still works before it prefills, shows or exports it, and hides one that was
  revoked or has expired;
- `supabase/migrations/20261112150000_hackathon_released_event.sql` makes Release grades
  queue one signed `hackathon.released` webhook to doqtri, through the same outbox
  (`integration_events`), cron route and retries as `milestone.status_changed`. doqtri then
  expires that hackathon's links 24 hours after `released_at`.

The order, and why:

1. **Deploy doqtri DOQ-54.** It adds the status endpoint, handles `hackathon.released` and
   leaves hidden nodes out of new snapshots. A doqtri without it answers 2xx to an event it
   does not know and drops it, so a `hackathon.released` that reaches it is spent and never
   sent again: that hackathon's links would not expire.
2. **Merge QDIT-67.** The code is safe on the old database: it still claims and sends
   `milestone.status_changed` as before, and the status checks need only `DOQTRI_ORIGIN`.
3. **Apply the migration.** Not before step 2: the delivery code before QDIT-67 does not
   know the new event and would post a release row as a malformed milestone body. Applying
   it also queues one event for every hackathon already released, with its original
   `released_at`: their links expire 24 hours after that, at once if that is past.

Apply it with the Supabase CLI, as in 1.2, then check:

```sql
select count(*) from public.integration_webhooks where link_source = 'doqtri';
-- 1: doqtri's endpoint. 0 means release events have nowhere to go (WP-2.7 setup).

select h.slug, e.released_at, e.occurred_at, e.attempts, e.delivered_at, e.dead_at, e.last_error
  from public.integration_events e join public.hackathons h on h.id = e.hackathon_id
 where e.event = 'hackathon.released'
 order by e.occurred_at;
-- one row per hackathon already released; delivered within a minute or two
-- (pg_cron calls the delivery route every minute, 4.6)
```

After a release, the same query shows the new hackathon's row; `delivered_at` set means
doqtri answered 2xx. A row that goes dead (`dead_at` set, 8 failed attempts over about
22 hours) is not sent again by itself. Once doqtri is reachable, re-queue it. doqtri dedupes
by `id`, so re-queueing an event it already processed changes nothing:

```sql
update public.integration_events
   set attempts = 0, dead_at = null, last_error = null, next_attempt_at = now()
 where event = 'hackathon.released'
   and hackathon_id = (select id from public.hackathons where slug = '<slug>');
```

The event is queued even while doqtri's `integration_webhooks` row is `active = false`, and
goes out once it is active again.

What teams and staff see: a revoked or expired link is no longer prefilled in the submit
dialog (the dialog falls back to the current version's link if that one still works, else
leaves the field empty); a pasted dead link is refused with "This link was revoked or has
expired."; the team card and the staff submission page show "Mindmap link revoked or
expired" instead of **Open mindmap**; Export submissions has a `Mindmap link status` column.
If doqtri is down or slow, a page waits at most 2 seconds and shows links as before (status
Unknown). A status answer is reused for up to 60 seconds, so a revoke shows within a
minute. Snapshots sent after DOQ-54 leave out nodes the sender hid in their doqtri style, so
the staff label list and counts, and the AI review, no longer see them; snapshots sent
before keep them. Scores, eligibility, the grader and the image requirement are unchanged.

---

## 2. Merge order

Each PR targets `main`; wait for each deploy before the next.

**qdit**

1. #19 QDIT-42 integration contract v1.2.0 (docs; byte-identical with doqtri's copy)
2. #22 QDIT-43 schema, sealed-grade RPCs, mindmap bucket (apply migration 1.2 first)
3. #20 QDIT-44 eligibility, rubric and leaderboard rules
4. #21 QDIT-45 AI review worker, cron route (set 1.3 and 1.4 first, or the route answers 503)
5. #23 QDIT-46 `POST /api/v1/projects/{id}/hackathon-snapshots`
6. #24 QDIT-47 participant page `/hackathons/[slug]`
7. #25 QDIT-48 admin and judge consoles, CSV export
8. QDIT-49 (branch `wp-4.7-e2e`): these specs, the seed script and this runbook. It is
   also the integration branch, with every lane above merged into it.
9. QDIT-60 `GET /api/v1/hackathons` (contract v1.3.0). Apply its migration (1.7) first,
   then merge the code.
10. QDIT-63 Slides link and Export submissions. Apply its migration (1.8) first, then merge
    the code.
11. QDIT-66 Mindmap link (contract v1.4.0). Apply its migration (1.9) first, then merge the
    code, and only then merge doqtri DOQ-53.
12. QDIT-67 mindmap link status and `hackathon.released` (contract v1.5.0). After doqtri
    DOQ-54 is deployed: merge the code, then apply its migration (1.10). This one is the
    other way round from the rest.

**doqtri**

1. #113 contract v1.2.0 (same file as qdit #19)
2. #114 `documents.created_at`, snapshot builder, qdit client (apply 1.1 first)
3. #115 Send to qdit hackathon dialog and route (then step 1.6)
4. DOQ-49 hackathon picker (contract v1.3.0). It may merge before qdit's QDIT-60: until
   then qdit answers `404 not_found` on `GET /api/v1/hackathons` and the dialog falls back
   to the link field. It must not meet a qdit where QDIT-60's code is live without its
   migration (1.7), which answers 500 and leaves the dialog unable to send.
5. DOQ-53 public mindmap page and `mindmap_url` in the snapshot (contract v1.4.0). Merge it
   only after qdit QDIT-66 is deployed (1.9): an older qdit refuses any snapshot with the
   field.
6. DOQ-54 link expiry, status endpoint, hidden nodes (contract v1.5.0). Deploy it before
   qdit QDIT-67 (1.10), so the first `hackathon.released` events find it.

qdit must be at #23 or later before doqtri #115 is used: before that, qdit answers 404 on
the snapshot route.

---

## 3. Event-day checklist

**The day before**

- [ ] `select public.hackathon_grading_scheduler_health();` answers `configured`.
- [ ] A dry run (section 5) is done on a local stack this week, with the times written down.
- [ ] The hackathon row's `opens_at`, `closes_at` are right in Manila time: the page shows
      them as "Opens" and "Closes" in Manila.
- [ ] Admins and judges are on Staff with the right role. None of them is on a team.
- [ ] Anthropic: the key works, there is credit (budget: about $35 for 60 teams), and the
      tier allows the burst (R-12).
- [ ] doqtri's Send to qdit hackathon button shows on the global mindmap page.

**During the build (80′)**

- Teams push from doqtri (global mindmap > **Send to qdit hackathon**, then the project
  and the hackathon link). qdit's page then shows "doqtri snapshot received: N notes".
- A team's project owner or admin submits on `/hackathons/<slug>`: team name, 3 or 4
  members, the global mindmap image (required) and up to two note maps. They may resubmit
  until the close; the last submission counts. A push after the last submit counts only
  after another submit ("Submit again to include it").
- Submit first runs the submission checklist on the team's current work (QDIT-55). All
  met: it submits at once. Otherwise the dialog lists what is missing, with **Check again**
  and **Submit anyway**. Notes are read from the last doqtri push, so a team that wrote
  notes since must use Send to qdit hackathon again. The checklist is advisory: grading
  recomputes it from the frozen version, and a check that cannot run never blocks a submit.

**The 5-minute submit window, then the close**

- Watch `/hackathons/<slug>/admin`: Submissions (version, eligibility chips, grading
  state) and the Release panel's counters (Runs pending, running, failed, done).
- Grading starts at each submit (`after()` in the submit action) and is swept every
  minute by pg_cron. Target: everything graded within 3 minutes of the close.
- The gate needs on-chain work (QDIT-54): at least 5 event notes anchored on
  DoqtriRegistry, and at least 1 milestone submitted on the project's milestone_proof
  contract during the event. Tell teams at the start. A job whose chain read failed shows
  `chain_unavailable:<reason>` and retries every ~60 s without spending an attempt;
  `chain_unavailable:unconfigured` fails at once and means `DOQTRI_REGISTRY_*` is unset.
- Grant late passes only for a team that was blocked by something outside its control
  (section 4.1). Release refuses while a pass is in force.

**Release, then pitches**

- Release (4.2) when the Release panel shows 0 pending and 0 running.
- Read the leaderboard. Any **Possible manipulation** banner names the team: open its
  submission and decide before it goes on a slide. Check ineligible entries' reasons.
  Override with a reason if the rule misfired (Override, on the entry's row).
- Set the pitch order (Pitch order section) and export the CSV (4.3) for the slides.
- Judges score on `/hackathons/<slug>/judge` (1 to 5 on Clarity, Structure, Accuracy,
  Connections, Pitch). Export again at the end: the final top 10 is the judges' mean,
  ties by AI score.

---

## 4. How to

### 4.1 Grant a late pass

`/hackathons/<slug>/admin` > Submissions > the team's row > **Late pass** > a time in
Manila > Save. The team can then upload and submit until that time. A doqtri push works
for it too. To end a pass early, save a time in the past. A pass cannot be granted after
release.

A team with no entry yet has no row. Grant the pass in SQL instead (`granted_by` = your
user id):

```sql
insert into public.hackathon_late_passes (hackathon_id, project_id, until, granted_by)
select h.id, p.id, now() + interval '10 minutes', '<your user id>'
  from public.hackathons h, public.projects p
 where h.slug = '<slug>' and p.slug = '<project slug>'
on conflict (hackathon_id, project_id) do update set until = excluded.until;
```

### 4.2 Release grades

`/hackathons/<slug>/admin` > Release grades > type the slug > **Release permanently**.

Release is irreversible (D-116). It is refused before `closes_at` and while a late pass is
in force. It is also refused while any entry's first two runs are pending or running
(`grading_incomplete`). The dialog then offers "Release anyway", which ranks those entries
without their missing runs. Use it only for a job that cannot finish (4.5). Release picks
the top `finalist_count` (10) eligible entries by AI score, tie to the earlier submission,
and stops all grading for the hackathon.

Release also queues one `hackathon.released` webhook to doqtri (QDIT-67, 1.10): the teams'
public mindmap links stop working 24 hours later.

### 4.3 Export the CSV

After release: **Export results** on the admin page, or
`https://<qdit host>/api/hackathons/<slug>/export` while signed in as a hackathon admin.
Columns: `rank, team_name, project_slug, eligible, ai_total, human_mean, finalist, flags`,
in the order the leaderboard shows. Cells that a spreadsheet would read as formulas are
prefixed with `'`. Anyone else, judges included, gets a 404. Before release it is a 409.

**Export submissions** (QDIT-63, D-123), any time: `https://<qdit host>/api/hackathons/<slug>/export/submissions`
as a hackathon admin. Columns: `Team name, Slides link, Global mindmap, Mindmap link,
Mindmap link status, Note map 1, Note map 2`, one row per entry by team name,
formula-guarded the same way. `Mindmap link` (QDIT-66) is the doqtri page the team
submitted, read from the version, so it is there after the snapshot is pruned; empty when
the team sent none. `Mindmap link status` (QDIT-67) is `Live`, `Revoked or expired`, or
`Unknown` when doqtri did not answer within 2 seconds; empty without a link. The image cells are Supabase
signed URLs valid for 7 days: anyone holding the file can open the images until then, so
share it only with the organisers, and export again for fresh links. Nothing score-derived
is in it. Anyone else gets a 404.

### 4.4 Read grading status

On the admin page: the Grading column per entry (`done · pending · running · failed`,
failed error codes in red) and the Release panel's totals. In SQL, job states only (never
scores):

```sql
select j.status, count(*), array_agg(distinct j.last_error) filter (where j.last_error is not null) as errors
  from public.hackathon_grading_jobs j
  join public.hackathon_submissions s on s.current_version_id = j.version_id
  join public.hackathons h on h.id = s.hackathon_id
 where h.slug = '<slug>' and j.status <> 'superseded'
 group by j.status;
```

`last_error` holds a code only (`describeError` in `src/lib/hackathon/grading-worker.ts`):
`provider:429` and `provider:529` (rate limit, overload: retried without counting),
`aborted:budget` (the run's 240 s ended: retried at once), `aborted:lease`, `network`,
`lease_expired` (a worker died: back in the queue), and the permanent ones, failed at once:
`refusal…`, `truncated:max_tokens`, `truncated:context`, `invalid_output`, `stop:…`.

### 4.5 Handle a stuck job (regrade)

- **Running for more than ~4 minutes**: its lease (200 s) has run out. The next sweep puts it
  back to pending, or marks it failed after 3 counted attempts. Wait one minute, or call
  the route yourself:
  `curl -H "Authorization: Bearer <CRON_SECRET>" https://<qdit host>/api/cron/grade-hackathon`
  (it answers counts only).
- **Failed**: on the entry's row, **Regrade** queues two fresh runs for the current version.
  Earlier runs stop counting. There are 9 run numbers per version, so three regrades at most
  (`regrade_limit`). Regrade is refused after release.
- **Pending and nothing moves**: check 4.6. With the job off or a secret missing, only
  `after()` and the daily Vercel cron (03:30 UTC) grade. Call the route as above until
  it is fixed.
- **Many `provider:429`**: the account's rate limit (R-12). The queue keeps at most 20
  running and backs off by itself. Leave it. Raising the tier fixes the cause.

### 4.6 Check that pg_cron is running

```sql
select public.hackathon_grading_scheduler_health();
-- configured: job active, both secrets stored
-- missing:    job off or a secret missing; missing_secrets names it (never its value)
-- unavailable: pg_cron, pg_net or Vault not installed

select status, return_message, start_time
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'qdit-grade-hackathon')
 order by start_time desc limit 5;
```

The job sends a request only while a job is pending or running, so an idle queue shows
runs with nothing sent.

---

## 5. Dry run (about a week before the event)

A local rehearsal at full size, with no Anthropic key and no production data. It uses
`web/scripts/demo/hackathon-seed.mjs`, which refuses any Supabase URL that is not
localhost or 127.0.0.1 unless `--allow-hosted` is passed. That flag writes about 240
accounts and 60 projects to whatever project it points at: the owner's call only (R-17).

1. Start a local stack (`supabase start`). Use non-default ports and a scratch
   `project_id` in an uncommitted `supabase/config.toml` if another stack holds them.
   The local `[auth.email] enable_signup = false` turns password sign-in off entirely, and
   `--release`/`--export` sign the dry-run admin in by password, so set it to `true` for
   the rehearsal. Put both config changes back afterwards.
2. Export the stack's values (`supabase status -o env`) for the script and the app:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET` (the `JWT_SECRET` line), and any
   `CRON_SECRET`.
3. Run the app against it with the fake grader:
   ```bash
   cd web
   HACKATHON_GRADER_FAKE=1 HACKATHON_GRADER_FAKE_MS=1000-3000 npx next dev -p 3200
   ```
   `HACKATHON_GRADER_FAKE=1` swaps Claude for `src/lib/hackathon/fake-grader.ts`, but only
   when `NODE_ENV` is not `production`, so only under `next dev` and in tests. Each run
   waits 1 to 3 s, then answers like the model. Scores come from a hash of the submission,
   and the run is stored with model `fake-grader`.
4. Seed, submit, close, grade, release, export, clean:
   ```bash
   export QDIT_URL=http://127.0.0.1:3200
   curl -s -H "Authorization: Bearer $CRON_SECRET" $QDIT_URL/api/cron/grade-hackathon   # warm the route
   node scripts/demo/hackathon-seed.mjs --seed --teams 60
   node scripts/demo/hackathon-seed.mjs --submit-all --close --grade
   node scripts/demo/hackathon-seed.mjs --release --export
   node scripts/demo/hackathon-seed.mjs --clean
   ```
   `--seed` makes 60 teams of 3 or 4 (example.invalid accounts, random passwords kept only
   in the git-ignored `scripts/demo/.hackathon-seed.json`). Each team gets 5 to 15 cards
   with owner, priority and due date, 5 to 8 doqtri notes connected in one global mindmap,
   and a generated PNG uploaded as the team's lead. The snapshots go through
   `push_doqtri_hackathon_snapshot()` with a locally signed token for a fake doqtri
   OAuth client (written to `integration_settings` only while it is empty, and put back by
   `--clean`). Teams 01 to 05 carry prompt-injection text in notes and card titles.
   `--submit-all` submits all 60 at once and prints the wall time and per-call latency.
   `--grade` calls the cron route the way pg_cron does, until no job is pending or running,
   and prints close→all graded. `--export` saves the CSV and checks it against
   `hackathon_leaderboard`. `--clean` deletes everything and checks that nothing is left.
5. Also, by hand, on the same data before `--clean`: open the admin console and the judge
   page as the dry-run admin, and score a finalist.
6. Write the numbers down next to the last run's:

   | Run | Teams | submit-all wall | close → all graded | runs (third) | failures |
   | --- | --- | --- | --- | --- | --- |
   | 2026-11-09, local, fake grader 1–3 s | 60 | 0.12 s (p95 110 ms per call) | 16.3 s, 1 sweep | 149 (29) | 0 |

   The fake grader's 1 to 3 s understates Claude. With 20 calls in flight, close→graded is
   about `runs / 20 × seconds per call`. At the 20 to 40 s a vision review can take, 150
   runs is 2.5 to 5 minutes, which is at or past the 3-minute target. Most entries are
   submitted and graded before the close, which is what keeps the real number down. A
   real-key rehearsal on a few teams measures seconds per call (step 7).
7. Optional, with a real key, on a handful of teams only (`--teams 5`): run `next dev`
   with `ANTHROPIC_API_KEY` instead of the fake. Then check that teams 01 to 05 come back
   with the `manipulation` flag and without inflated scores (R-14), and read the cost in the
   Anthropic console.

The production e2e run (`npm run test:e2e`, project `hackathon`) is separate. It builds
and removes its own `e2e-<run>` hackathon and needs the qdit migration applied. See
section 7.

---

## 6. Rollback

- **Hide the doqtri button**: unset `NEXT_PUBLIC_QDIT_HACKATHON` in doqtri and redeploy.
  The route answers 404 and nothing else changes.
- **Close submissions now**:
  `update public.hackathons set closes_at = now() where slug = '<slug>';`
  Pages, uploads and pushes follow at once (they read the clock in the database).
- **Stop grading**:
  `select cron.unschedule('qdit-grade-hackathon');` stops the minute sweep. Removing
  `ANTHROPIC_API_KEY` in Vercel makes the route and `after()` grade nothing (503, logged).
  Jobs stay pending; nothing is lost. To resume, re-run the `cron.schedule` call from section
  12 of the migration and restore the key.
- **Revert the code**: revert the PRs in reverse merge order. The pages vanish with #24 and
  #25. The tables stay and hold the event's data: keep them, they are the record.
- **Drop the schema** (only if no event data is worth keeping): there is no down
  migration. Unschedule both cron jobs, delete the bucket's objects through the Storage API
  (a SQL delete on `storage.objects` is refused), then drop the hackathon tables and
  functions and the bucket. Write it as a new migration; do not hand-edit production.
- **Release cannot be undone** (D-116). A release made by mistake stays released. The
  leaderboard is still admin-only, and teams never see grades. Its `hackathon.released`
  event (1.10) reaches doqtri within a minute and the links expire 24 hours later; qdit has
  no event that undoes it, so keeping the links is a doqtri-side fix.
- **doqtri's `documents.created_at`**: harmless to keep. Reverting doqtri #114 does not need
  the column dropped.

---

## 7. Tests that need production or the real pair

- `npm run test:e2e` (from `web/`, against production through `web/.env.local`, local
  machine only, never CI) now includes the `hackathon` project, after `publishing`. It
  creates five `e2e-hackathon-<run>-…@example.invalid` accounts (random passwords held in
  memory), the hackathon `e2e-<run>` and the project `e2e project hackathon-<run>`. It
  settles the grading jobs with synthetic runs through the service-role RPCs (no model
  call), and sweeps all of it in `afterAll` and in `cleanup`. That sweep also deletes the
  Storage objects under each `e2e-` hackathon's prefix, and fails if anything is left. It
  skips itself, with the reason, until the migration is applied. Where production's
  pg_cron sweep and key are live, the spec waits for any job that sweep claimed, instead of
  racing it. That can cost a few cents of real grading for the one e2e entry. To run only
  it: `npx playwright test --project=hackathon`.
- `npm run test:doqtri` (the real pair) now includes `07-hackathon.spec.ts`: a doqtri push,
  then a qdit submit that shows the note count. It needs `NEXT_PUBLIC_QDIT_HACKATHON=1` on
  that doqtri, and skips itself without it.

---

## 8. Risks

| ID | Risk | What we do | Watch on the day |
| --- | --- | --- | --- |
| R-12 | 60 teams submit inside 5 minutes and hit Anthropic rate limits | Queue capped at 20 running; 429/529 retried with Retry-After and not counted; per-minute sweep; prompt caching | Tier checked the week before; `provider:429` codes in 4.4 |
| R-13 | `after()` is cut off at the function's maxDuration | maxDuration 300 on the submit page; leases return a cut job to the queue; pg_cron sweeps every minute | Jobs stuck `running` past 4 minutes (4.5) |
| R-14 | Prompt injection inside a team's notes or board | No tools, schema-only output, team content JSON-encoded in one data block, `manipulation` flag, scores clamped in code; teams 01–05 of the dry run carry attempts | The **Possible manipulation** banner after release |
| R-15 | The database owner or service role can still read sealed grades | Accepted and documented; no client role or RPC exposes them before release | Nobody reads `hackathon_ai_runs` by hand before release |
| R-16 | doqtri timestamps or template and imported notes make a team look eligible | `created_at` and `source` come from doqtri's server; template and import notes don't count; 5 event notes must be anchored on DoqtriRegistry and 1 milestone submitted on chain inside the window (QDIT-54); an override needs a reason | Eligibility chips and reasons on the admin page |
| R-19 | Stellar RPC slow or down while grading | Chain reads retry uncounted (`chain_unavailable:*`), never make an entry ineligible; reads stop once each bar is met | `chain_unavailable` codes in 4.4; release only at 0 pending |
| R-17 | e2e and dry-run data written to production | Dedicated `e2e-` slug with teardown of rows and Storage objects; the seed script refuses hosted projects without `--allow-hosted` and has `--clean` | After an e2e run: `select count(*) from hackathons where slug like 'e2e-%'` is 0 |
| R-18 | The two CONTRACT.md copies had already drifted (line 470) | Fixed in v1.2.0; `cmp` check in both PRs | `cmp` the two copies before merging #19 and doqtri #113 |
