import { createClient } from '@supabase/supabase-js';

import type { Database } from '@app-data/database.types';

// 웹은 Vite env (VITE_*). 앱과 같은 프로젝트를 본다.
const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !anonKey) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 필요 (.env)');

export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: true }, // localStorage 기본
});
