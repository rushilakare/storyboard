import { getLatestCompletedPrdRow } from '@/lib/artifact-persistence';
import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data, error } = await supabase.from('features').select('*').eq('id', id).single();

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const artifact = await getLatestCompletedPrdRow(id);
  let prd_documents: Record<string, unknown> | null = null;

  if (artifact) {
    prd_documents = {
      id: artifact.id,
      content: artifact.body ?? '',
      feature_id: id,
      created_at: artifact.created_at,
      updated_at: artifact.updated_at,
      version: artifact.version,
    };
  } else {
    const { data: legacy } = await supabase
      .from('prd_documents')
      .select('*')
      .eq('feature_id', id)
      .maybeSingle();
    if (legacy) prd_documents = legacy as Record<string, unknown>;
  }

  return NextResponse.json({ ...data, prd_documents });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { name, purpose, requirements, status, priority, inference_clarifications } = body;

  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = name;
  if (purpose !== undefined) update.purpose = purpose;
  if (requirements !== undefined) update.requirements = requirements;
  if (status !== undefined) update.status = status;
  if (priority !== undefined) update.priority = priority;
  if (inference_clarifications !== undefined) update.inference_clarifications = inference_clarifications;

  const { data, error } = await supabase
    .from('features')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { error } = await supabase.from('features').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
