import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

let _client: SupabaseClient<Database> | null = null;

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!_client) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    _client = createClient<Database>(supabaseUrl, supabaseAnonKey);
  }
  return _client;
}

export const supabase = getSupabaseClient();
