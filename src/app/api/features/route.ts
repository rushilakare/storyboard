import { requireUser } from '@/lib/auth/require-user';
import { ilikeContainsPattern } from '@/lib/search/escapeIlike';
import { NextResponse, NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';

  let query = auth.supabase
    .from('features')
    .select('*')
    .order('updated_at', { ascending: false });

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  if (q) {
    const p = ilikeContainsPattern(q);
    query = query.or(`name.ilike.${p},purpose.ilike.${p},requirements.ilike.${p}`);
  }

  const limit = request.nextUrl.searchParams.get('limit');
  if (limit) {
    query = query.limit(parseInt(limit, 10));
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { name, purpose, requirements, workspace_id, status, priority } = body;

  if (!name || !workspace_id) {
    return NextResponse.json(
      { error: 'name and workspace_id are required' },
      { status: 400 }
    );
  }

  const { data, error } = await auth.supabase
    .from('features')
    .insert({
      name,
      purpose: purpose || null,
      requirements: requirements || null,
      workspace_id,
      status: status || 'draft',
      priority: priority || 'medium',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
