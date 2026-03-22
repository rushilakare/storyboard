import { requireUser } from '@/lib/auth/require-user';
import { KNOWLEDGE_BUCKET } from '@/lib/knowledge/constants';
import { NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const { data: doc, error: fetchErr } = await auth.supabase
    .from('knowledge_documents')
    .select('id, storage_path')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (doc.storage_path) {
    const { error: rmErr } = await auth.supabase.storage
      .from(KNOWLEDGE_BUCKET)
      .remove([doc.storage_path]);
    if (rmErr) {
      console.error('[knowledge] storage remove', rmErr);
    }
  }

  const { error: delErr } = await auth.supabase.from('knowledge_documents').delete().eq('id', id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
