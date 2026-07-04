import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
console.error(
'[Supabase] Variáveis VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não foram encontradas.'
);
}

export const supabase = createClient(
supabaseUrl || 'https://placeholder.supabase.co',
supabaseAnonKey || 'placeholder',
{
auth: {
persistSession: true,
autoRefreshToken: true,
},
}
);
