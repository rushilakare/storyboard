import { requireUser } from '@/lib/auth/require-user';
import { NextRequest, NextResponse } from 'next/server';

type UsageRow = {
  source: string;
  model_id: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
};

function sumTokens(rows: UsageRow[]) {
  let input = 0;
  let output = 0;
  let total = 0;
  let rowsWithAny = 0;
  for (const r of rows) {
    const has =
      r.input_tokens != null || r.output_tokens != null || r.total_tokens != null;
    if (has) rowsWithAny += 1;
    input += r.input_tokens ?? 0;
    output += r.output_tokens ?? 0;
    total += r.total_tokens ?? 0;
  }
  return { input, output, total, rowsWithAny, rowCount: rows.length };
}

function aggregate(rows: UsageRow[]) {
  const totals = sumTokens(rows);
  const byModel = new Map<string, UsageRow[]>();
  const bySource = new Map<string, UsageRow[]>();
  for (const r of rows) {
    const m = r.model_id || 'unknown';
    const s = r.source || 'unknown';
    if (!byModel.has(m)) byModel.set(m, []);
    if (!bySource.has(s)) bySource.set(s, []);
    byModel.get(m)!.push(r);
    bySource.get(s)!.push(r);
  }
  return {
    totals,
    byModel: [...byModel.entries()].map(([model_id, list]) => ({
      model_id,
      ...sumTokens(list),
    })),
    bySource: [...bySource.entries()].map(([source, list]) => ({
      source,
      ...sumTokens(list),
    })),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const sp = request.nextUrl.searchParams;
  const range = sp.get('range') ?? '30d';
  const fromParam = sp.get('from');
  const toParam = sp.get('to');

  const now = new Date();
  let fromIso: string | null = null;
  let toIso: string | null = null;

  if (fromParam) {
    const t = new Date(fromParam);
    if (!Number.isNaN(t.getTime())) fromIso = t.toISOString();
  }
  if (toParam) {
    const t = new Date(toParam);
    if (!Number.isNaN(t.getTime())) toIso = t.toISOString();
  }

  if (!fromIso && !toIso) {
    if (range === '7d') {
      fromIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (range === '30d') {
      fromIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }
    /* range === 'all' → no from */
  }

  let query = auth.supabase
    .from('ai_usage_events')
    .select('source, model_id, input_tokens, output_tokens, total_tokens');

  if (fromIso) query = query.gte('created_at', fromIso);
  if (toIso) query = query.lte('created_at', toIso);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as UsageRow[];

  return NextResponse.json({
    range: { preset: range, from: fromIso, to: toIso },
    ...aggregate(rows),
  });
}
