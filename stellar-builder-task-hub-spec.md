# Stellar Builder Task Hub

**A lightweight Jira/Trello-style workspace tailored for Stellar builders, combining task tracking with deployment and milestone proof management.**

---

## Overview

A lightweight project and milestone tracking tool for Stellar builders. It helps teams organize tasks, track progress, and attach Stellar-specific proof of work — contract IDs, transaction hashes, repo links, demo links, and Testnet/Mainnet deployment status.

**Core capabilities:**
- Manage projects, tasks, and milestones
- Track build progress in a simple board or dashboard
- Store technical proof of work
- Organize Soroban deployment and release status
- Keep grant, hackathon, or builder progress in one place

## Why It Matters

Generic tools like Jira or Trello help manage work, but they aren't designed for blockchain development workflows. Stellar teams often need to show:

- What was built
- Where the code is
- What contract was deployed
- What transaction proves it
- What milestone is complete

This tool makes that workflow easier and more structured.

## What Makes It Different

Not just a task manager — a **builder operations dashboard** tailored for Stellar teams, especially those working on Soroban apps, grants, hackathons, and ecosystem projects.

---

## MVP Version

A simple web app where users can:

- Create a project
- Add tasks and milestones
- Update status
- Attach repo/demo/proof links
- Save contract IDs and tx hashes
- View progress in one dashboard

---

## MVP Features to Ship

Keep it small and clearly Stellar-specific.

### 1. Project Management
- Create project
- Edit project
- Project overview page
- Project status

### 2. Task Board
- Create tasks
- Edit tasks
- Move tasks across statuses: **Todo → In Progress → Done**
- Assign task owner
- Due date (optional)

### 3. Milestone Tracking
- Create milestones
- Link tasks to milestones
- Mark milestone progress
- Milestone completion status

### 4. Stellar-Specific Proof Fields
*(One of the main differentiators.)* For each project or milestone:

- Contract ID
- Transaction hash
- Network (Testnet/Mainnet)
- Wallet address
- Repo URL
- Demo URL
- Documentation/proof link

### 5. Deployment Tracking
- Deployment status: **Not Started → Deployed to Testnet → Ready for Mainnet → Mainnet Live**
- Release notes field
- Deployment history log

### 6. Dashboard
A simple dashboard showing:
- Total tasks
- Completed tasks
- Active milestones
- Deployment status
- Linked Stellar proof

### 7. Search / Filter
- Filter by status
- Filter by network
- Filter by milestone
- Filter by assignee

---

## Nice-to-Have Features
*(Only if time allows.)*

### 8. Transaction Verification
- Paste tx hash
- Verify it exists
- Show basic transaction info

### 9. Contract Link Helper
- Auto-generate explorer links for contract IDs and tx hashes

### 10. Team Workspace
- Simple members list
- Assign tasks to team members

---

## Features to Avoid in MVP

Do **not** build these first:

- Chat/comments
- Notifications
- Complex permissions
- Full DAO governance
- On-chain task creation
- Token rewards
- Advanced analytics
- Mobile app

---

## Smart Contract Design

### Good Candidates for a Smart Contract

**1. Milestone Approval State**
Store milestone status on-chain: `proposed → submitted → approved → rejected`
> Creates tamper-resistant proof — useful if multiple stakeholders need shared trust.

**2. Proof Registry**
Register: contract IDs, tx hashes, milestone completion records, timestamps, submitter wallet.
> Gives verifiable proof that a milestone or deployment was recorded.

**3. Multi-Party Approval**
If a milestone needs approval from a project lead, reviewer, and grant manager, a contract can track approvals transparently.

**4. Escrow / Release Logic**
If you later want milestone-based fund release, this is a strong smart contract use case.

### Features That Should Stay Off-Chain

Do **not** put these on-chain — they belong in a normal database:

- Task descriptions
- Comments
- Assignees
- Due dates
- UI preferences
- Board layout
- Internal notes
- Attachments
- General CRUD project management

---

## Best Architecture

| Layer | Handles |
|---|---|
| **Off-chain** (database) | Projects, tasks, users, milestones, content, links, notes, dashboard data |
| **On-chain** (smart contract) | Milestone proof records, approval status, signer/approver actions, optional escrow logic |

---

## Best MVP Contract Scope

If you want a realistic first version, build **one very small contract**:

### Milestone Proof Contract

**Functions:**
- `create_project_ref`
- `submit_milestone_proof`
- `approve_milestone`
- `reject_milestone`
- `get_milestone_status`

**Stored data:**
- Project ID
- Milestone ID
- Submitter
- Proof hash / tx hash
- Status
- Timestamp
