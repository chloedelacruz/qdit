-- ============================================================================
-- qdit — local development seed
--
-- Runs automatically after `supabase db reset` (see [db.seed] in config.toml).
-- Intended for the LOCAL stack only. Never point this at a hosted project.
--
-- Creating auth users from SQL is deliberate here: the local stack ships a
-- fixed JWT secret, so these accounts only exist on your machine. Password for
-- every seeded account is `qdit-local-dev`.
--
-- The public.profiles rows are created for us by the on_auth_user_created
-- trigger, and the `owner` membership rows by on_project_created, so this file
-- only inserts what those triggers cannot infer.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Auth users
-- ----------------------------------------------------------------------------

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated',
    'authenticated',
    'ada@qdit.test',
    extensions.crypt('qdit-local-dev', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Ada Builder"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated',
    'authenticated',
    'ben@qdit.test',
    extensions.crypt('qdit-local-dev', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Ben Reviewer"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-3333-3333-333333333333',
    'authenticated',
    'authenticated',
    'cleo@qdit.test',
    extensions.crypt('qdit-local-dev', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Cleo Observer"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do nothing;

-- Identities are what GoTrue actually matches an email/password login against.
insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.email in ('ada@qdit.test', 'ben@qdit.test', 'cleo@qdit.test')
on conflict do nothing;

-- Wallet addresses and usernames are not part of the auth metadata written
-- above, so patch the profiles the on_auth_user_created trigger just produced.
--
-- Re-running this file is safe despite profiles_freeze_wallet_address: the
-- trigger rejects a *change* to an address that is already set, and these
-- statements write the same constant every time, which is not a change.
update public.profiles
set wallet_address = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
    username = 'ada'
where id = '11111111-1111-1111-1111-111111111111';

update public.profiles
set wallet_address = 'GB6YPGW5JFMMP2QB2USQ33EUWTXVL4ZT5ITUNCY3YKVWOJPP57CANOF3',
    username = 'ben'
where id = '22222222-2222-2222-2222-222222222222';

-- No wallet: cleo is the fixture for an account that predates the wallet flow,
-- which is what keeps the one-time link in Settings covered by the seed.
update public.profiles
set username = 'cleo'
where id = '33333333-3333-3333-3333-333333333333';


-- ----------------------------------------------------------------------------
-- Project
-- ----------------------------------------------------------------------------

insert into public.projects (id, owner_id, name, slug, description, status, repo_url, demo_url, docs_url)
values (
  'aaaaaaaa-0000-4000-8000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'Milestone Proof Registry',
  'milestone-proof-registry',
  'Soroban contract + dashboard that records milestone proofs on Stellar.',
  'active',
  'https://github.com/qdit/milestone-proof',
  'https://milestone-proof.qdit.test',
  'https://docs.qdit.test/milestone-proof'
)
on conflict (id) do nothing;

-- Ada already has an `owner` row courtesy of on_project_created.
insert into public.project_members (project_id, user_id, role)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222', 'member'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-3333-3333-333333333333', 'viewer')
on conflict (project_id, user_id) do nothing;


-- ----------------------------------------------------------------------------
-- Milestones
-- ----------------------------------------------------------------------------

insert into public.milestones (id, project_id, title, description, status, due_date, order_index)
values
  (
    'bbbbbbbb-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'Contract scaffold + tests',
    'no_std Soroban contract with the Proposed -> Submitted -> Approved state machine.',
    'approved',
    current_date - 14,
    0
  ),
  (
    'bbbbbbbb-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'Testnet deployment',
    'Deploy to Testnet and capture the contract id and deploy transaction hash.',
    'submitted',
    current_date + 7,
    1
  ),
  (
    'bbbbbbbb-0000-4000-8000-000000000003',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'Dashboard MVP',
    'Board, milestone tracker and proof panel wired to Supabase.',
    'proposed',
    current_date + 21,
    2
  )
-- These already had a conflict target. `do update` for the same reason as the
-- tasks below: a milestone that has been advanced through the approval flow
-- since seeding is a row to repair, not one to skip.
on conflict (id) do update set
  title       = excluded.title,
  description = excluded.description,
  status      = excluded.status,
  due_date    = excluded.due_date,
  order_index = excluded.order_index;


-- ----------------------------------------------------------------------------
-- Tasks
-- ----------------------------------------------------------------------------

-- Explicit ids, like the milestones above, so `on conflict (id)` has a target.
-- With a bare `on conflict do nothing` and a generated primary key there is
-- nothing for a re-run to collide with, so applying this file twice inserted a
-- second copy of all five tasks rather than doing nothing.
--
-- `do update` rather than `do nothing`, because a seed that skips rows it
-- already sees cannot repair one that has been edited since — and `status` in
-- particular is one drag away from being wrong.
--
-- The priorities below spread across the enum so the board's P0–P3 chips have
-- something to show. They reach a local stack only — every task in the hosted
-- project the Playwright suite runs against holds the default, so do not write
-- an e2e that asserts a priority it did not set itself.
insert into public.tasks (id, project_id, milestone_id, title, description, status, priority, assignee_id, due_date, order_index)
values
  (
    'cccccccc-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    'Model the milestone state machine',
    'Proposed -> Submitted -> Approved | Rejected, with resubmission after reject.',
    'done',
    'medium',
    '11111111-1111-1111-1111-111111111111',
    current_date - 20,
    0
  ),
  (
    'cccccccc-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    'Write contract unit tests',
    'Cover the unauthorized and invalid-transition error paths.',
    'done',
    'low',
    '22222222-2222-2222-2222-222222222222',
    current_date - 16,
    1
  ),
  (
    'cccccccc-0000-4000-8000-000000000003',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000002',
    'Publish the WASM to Testnet',
    null,
    'in_progress',
    'urgent',
    '11111111-1111-1111-1111-111111111111',
    current_date + 2,
    0
  ),
  (
    'cccccccc-0000-4000-8000-000000000004',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000003',
    'Build the task board',
    'Three columns with drag-free status changes for the MVP.',
    'todo',
    'high',
    '22222222-2222-2222-2222-222222222222',
    current_date + 12,
    0
  ),
  (
    'cccccccc-0000-4000-8000-000000000005',
    'aaaaaaaa-0000-4000-8000-000000000001',
    null,
    'Draft the grant progress update',
    'Unlinked backlog item — not attached to any milestone.',
    'todo',
    'low',
    null,
    null,
    0
  )
on conflict (id) do update set
  milestone_id = excluded.milestone_id,
  title        = excluded.title,
  description  = excluded.description,
  status       = excluded.status,
  priority     = excluded.priority,
  assignee_id  = excluded.assignee_id,
  due_date     = excluded.due_date,
  order_index  = excluded.order_index;


-- ----------------------------------------------------------------------------
-- Stellar proofs
-- ----------------------------------------------------------------------------

-- Explicit ids for the same reason as the tasks above: the primary key is
-- generated, so a bare `on conflict do nothing` had nothing to match and a
-- re-run duplicated both rows.
insert into public.stellar_proofs (
  id, project_id, milestone_id, contract_id, tx_hash, network, wallet_address, proof_url, notes, created_by
)
values
  (
    'dddddddd-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    null,
    null,
    'testnet',
    'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
    'https://github.com/qdit/milestone-proof/releases/tag/v0.1.0',
    'Tagged release containing the audited contract source and test snapshots.',
    '11111111-1111-1111-1111-111111111111'
  ),
  (
    'dddddddd-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000002',
    'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K',
    'd8f4d1a7c9b3e5f20a6c1b8d4e7f3a95c2b0d6e1f8a4c7b3d9e5f1a2c8b4d6e0',
    'testnet',
    'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
    null,
    'Testnet deploy transaction. Awaiting reviewer approval.',
    '11111111-1111-1111-1111-111111111111'
  )
on conflict (id) do update set
  milestone_id   = excluded.milestone_id,
  contract_id    = excluded.contract_id,
  tx_hash        = excluded.tx_hash,
  network        = excluded.network,
  wallet_address = excluded.wallet_address,
  proof_url      = excluded.proof_url,
  notes          = excluded.notes;


-- ----------------------------------------------------------------------------
-- Deployment history
-- ----------------------------------------------------------------------------

-- The log is append-only in the app, which makes a duplicated seed row worse
-- here than elsewhere: there is no UI that can remove one again.
insert into public.deployments (
  id, project_id, status, network, contract_id, tx_hash, release_notes, deployed_by, deployed_at
)
values
  (
    'eeeeeeee-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'not_started',
    null,
    null,
    null,
    'Project created.',
    '11111111-1111-1111-1111-111111111111',
    now() - interval '30 days'
  ),
  (
    'eeeeeeee-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'testnet',
    'testnet',
    'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K',
    'd8f4d1a7c9b3e5f20a6c1b8d4e7f3a95c2b0d6e1f8a4c7b3d9e5f1a2c8b4d6e0',
    'v0.1.0 — initial Testnet deploy of milestone_proof.',
    '11111111-1111-1111-1111-111111111111',
    now() - interval '3 days'
  )
on conflict (id) do update set
  status        = excluded.status,
  network       = excluded.network,
  contract_id   = excluded.contract_id,
  tx_hash       = excluded.tx_hash,
  release_notes = excluded.release_notes,
  deployed_at   = excluded.deployed_at;

commit;
