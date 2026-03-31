import { requireUser } from '@/lib/auth/require-user';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const patchSchema = z
  .object({
    full_name: z.string().max(200).trim().optional(),
    email: z.string().email().max(320).optional(),
  })
  .refine((d) => d.full_name !== undefined || d.email !== undefined, {
    message: 'Provide full_name and/or email',
  });

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: 'Could not load user' }, { status: 500 });
  }

  const u = data.user;
  const meta = u.user_metadata as Record<string, unknown> | undefined;
  const fullName =
    typeof meta?.full_name === 'string' ? meta.full_name : typeof meta?.name === 'string' ? meta.name : '';

  return NextResponse.json({
    email: u.email ?? '',
    full_name: fullName,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { full_name, email } = parsed.data;

  const { data: cur } = await auth.supabase.auth.getUser();
  if (!cur.user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const existingMeta = (cur.user.user_metadata ?? {}) as Record<string, unknown>;
  const nextData =
    full_name !== undefined
      ? { ...existingMeta, full_name: full_name === '' ? undefined : full_name }
      : undefined;

  const updatePayload: {
    email?: string;
    data?: Record<string, unknown>;
  } = {};
  if (email !== undefined) updatePayload.email = email;
  if (nextData !== undefined) updatePayload.data = nextData;

  const { data, error } = await auth.supabase.auth.updateUser(updatePayload);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const u = data.user;
  if (!u) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  const meta = u.user_metadata as Record<string, unknown> | undefined;
  const outName =
    typeof meta?.full_name === 'string' ? meta.full_name : typeof meta?.name === 'string' ? meta.name : '';

  return NextResponse.json({
    email: u.email ?? '',
    full_name: outName,
    email_pending: email !== undefined && email.toLowerCase() !== (cur.user.email ?? '').toLowerCase(),
  });
}
