import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton rows={3} className="mx-auto max-w-4xl" />;
}
