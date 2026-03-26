import {
  listFeatureArtifacts,
  listFeatureArtifactsSummary,
} from '@/lib/artifact-persistence';
import { requireUser } from '@/lib/auth/require-user';
import { NextResponse, NextRequest } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId } = await params;
  const kind = request.nextUrl.searchParams.get('kind') ?? undefined;
  const summary = request.nextUrl.searchParams.get('summary') === '1';

  try {
    const rows = summary
      ? await listFeatureArtifactsSummary(
          auth.supabase,
          featureId,
          kind ?? undefined,
        )
      : await listFeatureArtifacts(
          auth.supabase,
          featureId,
          kind ?? undefined,
        );
    return NextResponse.json(rows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to list artifacts';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
