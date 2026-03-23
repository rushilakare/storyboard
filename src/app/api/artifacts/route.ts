import { requireUser } from '@/lib/auth/require-user';
import { listArtifactsFlat } from '@/lib/search/artifactsFlatList';
import { NextRequest, NextResponse } from 'next/server';

const LIST_LIMIT = 200;

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';

  const { data: flat, error } = await listArtifactsFlat(auth.supabase, {
    q: q || null,
    maxRows: LIST_LIMIT,
  });

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json(flat);
}
