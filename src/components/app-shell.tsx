"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { demoMode, supabase } from "@/lib/supabase";
import { useWorkspace } from "@/components/workspace-provider";

const navigation = [
  { label: "Dashboard", href: "/", icon: "▦", group: "Overview" },
  { label: "Projects & Sites", href: "/projects", icon: "⌂", group: "Workspace" },
  { label: "Vendors", href: "/vendors", icon: "♙", group: "Workspace" },
  { label: "Transactions", href: "/transactions", icon: "↕", group: "Accounts" },
  { label: "Invoices & Bills", href: "/invoices", icon: "▤", group: "Accounts" },
  { label: "BOQ Intelligence", href: "/boq", icon: "◈", group: "Construction" },
  { label: "Measurement Books", href: "/measurements", icon: "⌗", group: "Construction" },
  { label: "Documents", href: "/documents", icon: "▧", group: "Construction" },
  { label: "Materials & Procurement", href: "/materials", icon: "⬡", group: "Operations" },
  { label: "Labour", href: "/labour", icon: "♧", group: "Operations" },
  { label: "Reports", href: "/reports", icon: "▥", group: "Insights" },
  { label: "AI Assistant", href: "/assistant", icon: "✦", group: "Insights" },
  { label: "Notifications", href: "/notifications", icon: "◌", group: "Insights" },
  { label: "Settings", href: "/settings", icon: "⚙", group: "Manage" },
];

function navTitle(pathname: string) {
  return navigation.find((item) => item.href === pathname)?.label ?? "Workspace";
}

export function OrganizationSetup() {
  const { error, reload } = useWorkspace();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function createOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    const { error: createError } = await supabase.rpc("create_my_organization", {
      p_name: name.trim(),
    });
    setSaving(false);
    if (createError) {
      setFormError(createError.message);
      return;
    }
    await reload();
  }

  return (
    <section className="setup-card">
      <div className="setup-mark">LC</div>
      <p className="eyebrow">Workspace setup</p>
      <h1>Set up your company workspace</h1>
      <p className="muted">
        Create the organization that will own your projects, vendors, accounts, and documents.
        Your user becomes its owner.
      </p>
      {(error || formError) && (
        <p className="alert alert-error" role="alert">
          {formError || error}
          {error.includes("organization_memberships") || error.includes("create_my_organization")
            ? " Apply the LeaderCon foundation migration first."
            : ""}
        </p>
      )}
      <form onSubmit={createOrganization} className="form-stack">
        <label className="field-label" htmlFor="organization-name">Company name</label>
        <input
          id="organization-name"
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={120}
          required
          placeholder="For example, Sumanik Stone Crusher"
        />
        <button className="button button-primary" disabled={saving}>
          {saving ? "Creating workspace…" : "Create workspace"}
        </button>
      </form>
      <p className="setup-note">Legacy vendor records are kept separate until an administrator maps them to this workspace.</p>
    </section>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, organizations, organization, setOrganizationId, loading } = useWorkspace();
  const groups = Array.from(new Set(navigation.map((item) => item.group)));

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="app-frame">
      {mobileOpen && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={"sidebar" + (mobileOpen ? " sidebar-open" : "")}>
        <Link href="/" className="brand-lockup" onClick={() => setMobileOpen(false)}>
          <span className="brand-mark">LC</span>
          <span><strong>LeaderCon</strong><small>Construction accounts</small></span>
        </Link>

        <div className="workspace-switcher">
          <span className="workspace-avatar">{organization?.name.slice(0, 1).toUpperCase() || "W"}</span>
          <span className="workspace-name"><strong>{organization?.name || "Workspace"}</strong><small>{organization?.role?.replaceAll("_", " ") || "Setup required"}</small></span>
          {organizations.length > 1 && (
            <select aria-label="Choose workspace" value={organization?.id || ""} onChange={(event) => setOrganizationId(event.target.value)}>
              {organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-heading">{group}</p>
              {navigation.filter((item) => item.group === group).map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={"nav-link" + (active ? " nav-link-active" : "")}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="security-note"><span className="security-dot" /> Private company workspace</div>
          <button className="profile-button" onClick={signOut} title="Sign out">
            <span className="profile-avatar">{user?.email?.slice(0, 1).toUpperCase() || "A"}</span>
            <span className="profile-copy"><strong>{user?.email || "Account"}</strong><small>Sign out</small></span>
            <span className="profile-arrow">↗</span>
          </button>
        </div>
      </aside>

      <div className="main-column">
        {demoMode && <div className="alert alert-info" role="status" style={{ borderRadius: 0, margin: 0 }}><strong>Local demo mode</strong> · Fictitious sample data only. Changes stay in memory; Supabase, file storage, and AI provider calls are disabled.</div>}
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>☰</button>
          <div className="topbar-title"><span>LeaderCon</span><b>/</b><strong>{navTitle(pathname)}</strong></div>
          <div className="topbar-actions">
            <Link href="/notifications" className="icon-button" aria-label="Notifications">◌</Link>
            <span className="topbar-divider" />
            <span className="topbar-user">{user?.email?.split("@")[0] || "Account"}</span>
            <span className="profile-avatar profile-avatar-small">{user?.email?.slice(0, 1).toUpperCase() || "A"}</span>
          </div>
        </header>
        <main className="page-content">
          {loading ? (
            <div className="loading-card"><span className="spinner" /> Loading your workspace…</div>
          ) : organization ? children : <OrganizationSetup />}
        </main>
        <footer className="app-footer"><span>LeaderCon</span><span>Developed by Alesh</span></footer>
      </div>
    </div>
  );
}
