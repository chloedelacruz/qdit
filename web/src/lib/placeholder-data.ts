/**
 * SCAFFOLD ONLY — replace with Supabase queries.
 *
 * These fixtures exist so the shell renders something real-shaped before the
 * data layer is wired up. Every export here should disappear once the
 * corresponding query lands; nothing in the app should grow a dependency on
 * this module beyond the page it is rendered in.
 */

import type {
  DeploymentStatus,
  MilestoneStatus,
  ProjectStatus,
  TaskStatus,
} from "@/lib/constants";
import type { StellarNetwork } from "@/lib/stellar";

export type DemoProject = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: ProjectStatus;
  network: StellarNetwork;
  deployment: DeploymentStatus;
  contractId: string | null;
  taskCount: number;
  doneCount: number;
  milestoneCount: number;
  updatedAt: string;
};

export type DemoTask = {
  id: string;
  title: string;
  status: TaskStatus;
  assignee: string | null;
  dueDate: string | null;
  milestone: string | null;
};

export type DemoMilestone = {
  id: string;
  title: string;
  status: MilestoneStatus;
  project: string;
  taskCount: number;
  doneCount: number;
  txHash: string | null;
  network: StellarNetwork;
};

export const DEMO_PROJECTS: DemoProject[] = [
  {
    id: "p1",
    slug: "atlas-escrow",
    name: "Atlas Escrow",
    description: "Milestone-based escrow contract for ecosystem grants.",
    status: "active",
    network: "testnet",
    deployment: "testnet",
    contractId: "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K",
    taskCount: 24,
    doneCount: 15,
    milestoneCount: 4,
    updatedAt: "2026-07-29T10:12:00Z",
  },
  {
    id: "p2",
    slug: "proof-registry",
    name: "Proof Registry",
    description: "On-chain record of milestone completion and deployment hashes.",
    status: "active",
    network: "mainnet",
    deployment: "mainnet_live",
    contractId: "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
    taskCount: 18,
    doneCount: 18,
    milestoneCount: 3,
    updatedAt: "2026-07-30T16:40:00Z",
  },
  {
    id: "p3",
    slug: "builder-onboarding",
    name: "Builder Onboarding",
    description: "Docs, examples and a starter template for new Soroban teams.",
    status: "paused",
    network: "testnet",
    deployment: "not_started",
    contractId: null,
    taskCount: 9,
    doneCount: 2,
    milestoneCount: 2,
    updatedAt: "2026-07-21T08:05:00Z",
  },
];

export const DEMO_TASKS: DemoTask[] = [
  {
    id: "t1",
    title: "Define milestone approval state machine",
    status: "done",
    assignee: "Ana",
    dueDate: "2026-07-18",
    milestone: "Contract v1",
  },
  {
    id: "t2",
    title: "Write escrow release tests",
    status: "in_progress",
    assignee: "Ravi",
    dueDate: "2026-08-04",
    milestone: "Contract v1",
  },
  {
    id: "t3",
    title: "Wire proof fields into milestone form",
    status: "in_progress",
    assignee: "Ana",
    dueDate: "2026-08-06",
    milestone: "Dashboard MVP",
  },
  {
    id: "t4",
    title: "Deploy to Testnet and record tx hash",
    status: "todo",
    assignee: null,
    dueDate: "2026-08-11",
    milestone: "Contract v1",
  },
  {
    id: "t5",
    title: "Explorer link helper for contract IDs",
    status: "todo",
    assignee: "Ravi",
    dueDate: null,
    milestone: "Dashboard MVP",
  },
  {
    id: "t6",
    title: "Grant report — attach proof links",
    status: "todo",
    assignee: null,
    dueDate: "2026-08-20",
    milestone: null,
  },
];

export const DEMO_MILESTONES: DemoMilestone[] = [
  {
    id: "m1",
    title: "Contract v1",
    status: "submitted",
    project: "Atlas Escrow",
    taskCount: 8,
    doneCount: 5,
    txHash: "3f2a91d0c4b7e6158a0d9c2f7b4e18d63a5c0e9f2b7d4a16c8e35f907b1d2a4c",
    network: "testnet",
  },
  {
    id: "m2",
    title: "Dashboard MVP",
    status: "proposed",
    project: "Atlas Escrow",
    taskCount: 11,
    doneCount: 4,
    txHash: null,
    network: "testnet",
  },
  {
    id: "m3",
    title: "Mainnet launch",
    status: "approved",
    project: "Proof Registry",
    taskCount: 6,
    doneCount: 6,
    txHash: "a71c3e05d92f4b8617c0e5a3d4f96b2801e7c5a9d3b60f4e28c1a97d5b306e4f",
    network: "mainnet",
  },
];
