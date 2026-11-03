import { createClient } from "@supabase/supabase-js";

export function createAuthenticatedSupabaseClient(accessToken: string) {
  if (process.env.NEXT_PUBLIC_LEADERCON_DEMO_MODE === "true") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: "Bearer " + accessToken },
    },
  });
}

export async function authenticateRequest(request: Request) {
  if (process.env.NEXT_PUBLIC_LEADERCON_DEMO_MODE === "true") {
    return { error: "AI and cloud authentication are disabled in local demo mode.", status: 503 as const };
  }
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    return { error: "Sign in is required.", status: 401 as const };
  }

  const client = createAuthenticatedSupabaseClient(match[1]);
  if (!client) {
    return { error: "Supabase is not configured on the server.", status: 503 as const };
  }

  const { data, error } = await client.auth.getUser(match[1]);
  if (error || !data.user) {
    return { error: "Your session is invalid or expired. Sign in again.", status: 401 as const };
  }

  return { client, user: data.user };
}
