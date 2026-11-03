"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseReady } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!supabaseReady) {
      setError("Supabase configuration is missing. Add the public project URL and anon key to .env.local.");
      return;
    }
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function sendResetLink() {
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    if (!supabaseReady) {
      setError("Supabase configuration is missing.");
      return;
    }
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + "/login",
    });
    setLoading(false);
    if (resetError) setError(resetError.message);
    else setNotice("Password reset instructions were requested for " + email.trim() + ".");
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="login-brand"><span className="brand-mark">LC</span><div><strong>LeaderCon</strong><small>Construction accounts</small></div></div>
        <p className="eyebrow">Welcome back</p>
        <h1>Sign in to your workspace</h1>
        <p className="muted">Projects, supplier accounts, and site records in one place.</p>

        <form onSubmit={handleLogin} className="form-stack login-form">
          <label className="field-label" htmlFor="email">Email address</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="input" placeholder="you@company.com" />
          <div className="field-row"><label className="field-label" htmlFor="password">Password</label><button className="text-button" type="button" onClick={sendResetLink} disabled={loading}>Forgot password?</button></div>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="input" placeholder="Enter your password" />
          {error && <p role="alert" className="alert alert-error">{error}</p>}
          {notice && <p role="status" className="alert alert-success">{notice}</p>}
          <button className="button button-primary button-full" type="submit" disabled={loading}>{loading ? "Please wait…" : "Sign in"}</button>
        </form>
        <div className="login-footnote"><span className="security-dot" /> Sign in is protected by your Supabase authentication settings.</div>
        <p className="login-credit">Developed by Alesh</p>
      </section>
    </main>
  );
}
