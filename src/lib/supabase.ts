import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

let _client: SupabaseClient<Database> | null = null;

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!_client) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
      );
    }
    _client = createClient<Database>(supabaseUrl, supabaseAnonKey);
  }
  return _client;
}

/** Lazy singleton so `next build` can load API route modules without Supabase env (Vercel sets them at runtime). */
export const supabase: SupabaseClient<Database> = new Proxy(
  {} as SupabaseClient<Database>,
  {
    get(_target, prop, _receiver) {
      const client = getSupabaseClient();
      const value = Reflect.get(client, prop, client);
      if (typeof value === 'function') {
        return value.bind(client);
      }
      return value;
    },
  },
);
