import { notFound } from "next/navigation";

import { getProject } from "@/lib/queries";

/**
 * Guards every project-scoped route. Resolving the slug here means the child
 * pages can assume the project exists, and an unknown slug 404s once rather
 * than five times.
 */
export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const { slug } = await params;
  const project = await getProject(slug);

  if (!project) notFound();

  return <>{children}</>;
}
