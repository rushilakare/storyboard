import { requireUser } from '@/lib/auth/require-user';
import { markdownToDocxBuffer } from '@/lib/markdownToDocx';
import { NextResponse } from 'next/server';

function asciiFilename(stem: string): string {
  return (
    stem
      .trim()
      .replace(/[^\w\-._]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'export'
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId } = await params;

  const { data: feat, error: featErr } = await auth.supabase
    .from('features')
    .select('id')
    .eq('id', featureId)
    .maybeSingle();

  if (featErr) {
    return NextResponse.json({ error: featErr.message }, { status: 500 });
  }
  if (!feat) {
    return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
  }

  let body: { markdown?: unknown; filenameStem?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const markdown =
    typeof body.markdown === 'string' ? body.markdown : '';
  const stem =
    typeof body.filenameStem === 'string'
      ? asciiFilename(body.filenameStem)
      : 'export';

  try {
    const buffer = await markdownToDocxBuffer(markdown);
    const filename = `${stem}.docx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Export failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
