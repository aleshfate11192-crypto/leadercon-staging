"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseReady } from "@/lib/supabase";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(supabaseReady);
  const [allowed, setAllowed] = useState(false);
  const [configurationError] = useState(supabaseReady ? "" : "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart the app.");

  useEffect(() => {
    if (!supabaseReady) {
      return;
    }

    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session?.user) {
        setAllowed(true);
        setChecking(false);
      } else {
        setAllowed(false);
        router.replace("/login");
      }
    });

    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error || !data.user) {
        router.replace("/login");
        return;
      }
      setAllowed(true);
      setChecking(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  if (checking) {
    return <main className="auth-loading"><span className="spinner" /> Checking your sign-in…</main>;
  }
  if (configurationError) {
    return <main className="auth-loading"><section className="setup-card"><span className="brand-mark">LC</span><h1>Connect LeaderCon to Supabase</h1><p className="muted">{configurationError}</p><a className="button button-primary" href="/login">Open sign in</a></section></main>;
  }
  if (!allowed) return <main className="auth-loading"><span className="spinner" /> Redirecting to sign in…</main>;
  return <>{children}</>;
}
