import { createClient } from '@supabase/supabase-js';

// Lazily initialize the Supabase client using runtime attributes fetched from the server.
// This allows dynamic key rotation/configuration directly within AI Studio Settings,
// bypassing static Vite build-time environment variable bundling.
let actualClient: any = null;

export const supabase = new Proxy({} as any, {
  get(target, prop) {
    if (!actualClient) {
      const config = (window as any).__SUPABASE_CONFIG__ || {
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
      };
      
      const url = config.supabaseUrl || 'https://placeholder.supabase.co';
      const key = config.supabaseAnonKey || 'placeholder';
      
      actualClient = createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true
        }
      });
    }
    return actualClient[prop];
  }
});
