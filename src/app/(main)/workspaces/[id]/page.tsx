import { Suspense } from "react";
import WorkspaceDetailClient from "./WorkspaceDetailClient";

export default function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 48, color: "var(--text-muted)", fontSize: 14 }}>
          Loading…
        </div>
      }
    >
      <WorkspaceDetailClient params={params} />
    </Suspense>
  );
}
