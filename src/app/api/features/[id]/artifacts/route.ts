import { listFeatureArtifacts } from '@/lib/artifact-persistence';
import { NextResponse, NextRequest } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: featureId } = await params;
  const kind = request.nextUrl.searchParams.get('kind') ?? undefined;

  try {
    const rows = await listFeatureArtifacts(featureId, kind ?? undefined);
    return NextResponse.json(rows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to list artifacts';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
