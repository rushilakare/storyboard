import { supabase } from '@/lib/supabase';
import { embedMessageAsync } from '@/lib/embeddings';
import { NextResponse, NextRequest } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: featureId } = await params;
  const cursor = request.nextUrl.searchParams.get('cursor');
  const limit = parseInt(
    request.nextUrl.searchParams.get('limit') || '100',
    10,
  );

  let query = supabase
    .from('feature_messages')
    .select('id, feature_id, role, content, sequence_num, agent_type, token_count, metadata, created_at')
    .eq('feature_id', featureId)
    .order('sequence_num', { ascending: true })
    .limit(limit);

  if (cursor) {
    query = query.gt('sequence_num', parseInt(cursor, 10));
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: featureId } = await params;
  const body = await request.json();
  const { role, content, agent_type, metadata } = body;

  if (!role || !content) {
    return NextResponse.json(
      { error: 'role and content are required' },
      { status: 400 },
    );
  }

  const { data: maxRow } = await supabase
    .from('feature_messages')
    .select('sequence_num')
    .eq('feature_id', featureId)
    .order('sequence_num', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSeq = (maxRow?.sequence_num ?? 0) + 1;
  const tokenCount = Math.ceil(content.length / 4);

  const { data, error } = await supabase
    .from('feature_messages')
    .insert({
      feature_id: featureId,
      role,
      content,
      sequence_num: nextSeq,
      agent_type: agent_type || null,
      token_count: tokenCount,
      metadata: metadata || {},
    })
    .select('id, feature_id, role, content, sequence_num, agent_type, token_count, metadata, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  embedMessageAsync(data.id, content).catch(() => {});

  return NextResponse.json(data, { status: 201 });
}
