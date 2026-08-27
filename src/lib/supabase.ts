import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || 
  process.env.VITE_SUPABASE_URL || 
  'https://placeholder-project.supabase.co';

const supabaseAnonKey = 
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || 
  process.env.VITE_SUPABASE_ANON_KEY || 
  'placeholder-anon-key';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Configuração do Supabase ausente. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY na Vercel.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Gracefully handle stale or invalid refresh tokens without breaking the UI
if (typeof window !== 'undefined') {
  // Listen for auth state changes to detect token refresh errors
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' && !session) {
      supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  });

  // Catch unhandled promise rejections specifically for invalid refresh tokens
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || event.reason?.error_description || String(event.reason || '');
    if (
      reason.includes('Invalid Refresh Token') ||
      reason.includes('Refresh Token Not Found') ||
      reason.includes('refresh_token_not_found') ||
      reason.includes('Invalid Refresh Token: Refresh Token Not Found')
    ) {
      console.warn('[Supabase Auth] Token de atualização inválido detectado. Limpando sessão local...');
      event.preventDefault();
      supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  });
}
