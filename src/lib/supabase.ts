import { createClient } from "@supabase/supabase-js";
import { createDemoSupabaseClient } from "@/lib/demo-supabase";

export const demoMode = process.env.NEXT_PUBLIC_LEADERCON_DEMO_MODE === "true";
const configuredUrl = demoMode ? undefined : process.env.NEXT_PUBLIC_SUPABASE_URL;
const configuredAnonKey = demoMode ? undefined : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseReady = demoMode || Boolean(configuredUrl && configuredAnonKey);

export const supabase = (demoMode
  ? createDemoSupabaseClient()
  : createClient(
      configuredUrl || "http://127.0.0.1:54321",
      configuredAnonKey || "public-anon-key-not-configured",
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      },
    )) as ReturnType<typeof createClient>;
