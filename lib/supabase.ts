import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

// ✅ Server client — created fresh each call (safe, server-only)
export const createServerClient = (): SupabaseClient => {
  if (typeof window !== "undefined") {
    throw new Error("createServerClient must not be called from the browser.");
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!supabaseUrl) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};

// ✅ Browser client — single instance, never recreated (fixes the warning)
let browserClient: SupabaseClient | null = null;

export const createBrowserClient = (): SupabaseClient => {
  if (typeof window === "undefined") {
    throw new Error("createBrowserClient must not be called from the server.");
  }
  if (browserClient) return browserClient; // reuse existing instance

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!supabaseUrl) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY");

  browserClient = createClient(supabaseUrl, anonKey);
  return browserClient;
};