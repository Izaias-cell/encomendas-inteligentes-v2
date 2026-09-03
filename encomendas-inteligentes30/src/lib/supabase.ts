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

export function clearSupabaseStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('auth-token') || key.includes('supabase.auth'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => {
      try {
        localStorage.removeItem(k);
      } catch (_) {}
    });
  } catch (_) {}
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
      clearSupabaseStorage();
      supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    } else if (event === 'SIGNED_OUT') {
      clearSupabaseStorage();
    }
  });

  // Catch unhandled promise rejections specifically for invalid refresh tokens
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || event.reason?.error_description || event.reason?.error || String(event.reason || '');
    if (
      reason.includes('Invalid Refresh Token') ||
      reason.includes('Refresh Token Not Found') ||
      reason.includes('refresh_token_not_found') ||
      reason.includes('Invalid Refresh Token: Refresh Token Not Found')
    ) {
      console.warn('[Supabase Auth] Token de atualização inválido interceptado e limpo com segurança.');
      event.preventDefault();
      clearSupabaseStorage();
      supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  });

  // Catch general window errors related to invalid refresh tokens
  window.addEventListener('error', (event) => {
    const msg = event.message || '';
    if (
      msg.includes('Invalid Refresh Token') ||
      msg.includes('Refresh Token Not Found') ||
      msg.includes('refresh_token_not_found')
    ) {
      console.warn('[Supabase Auth] Erro de refresh token interceptado e limpo com segurança.');
      event.preventDefault();
      clearSupabaseStorage();
      supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  });
}
