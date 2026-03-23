import { requireUser } from '@/lib/auth/require-user';
import { ilikeContainsPattern } from '@/lib/search/escapeIlike';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';

  let query = auth.supabase
    .from('workspaces')
    .select('*, features(count)')
    .order('updated_at', { ascending: false });

  if (q) {
    const p = ilikeContainsPattern(q);
    query = query.or(`name.ilike.${p},description.ilike.${p}`);
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
  const { name, description } = body;

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from('workspaces')
    .insert({
      name,
      description: description || null,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
