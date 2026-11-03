"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { formatDate } from "@/lib/financials";
import { supabase, supabaseReady } from "@/lib/supabase";

type Member = { member_user_id: string; email: string; role: string; joined_at: string };
const roles = ["owner", "accountant", "project_manager", "site_engineer", "auditor"];

export default function SettingsPage() {
  const { organization, user, reload } = useWorkspace();
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("accountant");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isOwner = organization?.role === "owner";

  const loadMembers = useCallback(async () => {
    if (!organization) return;
    if (!isOwner) return;
    const { data, error: memberError } = await supabase.rpc("get_organization_members", { p_organization_id: organization.id });
    setError(memberError ? "Could not load members. Apply the workspace administration migration: " + memberError.message : "");
    setMembers((data ?? []) as Member[]); setLoading(false);
  }, [organization, isOwner]);

  useEffect(() => { const timer = window.setTimeout(() => void loadMembers(), 0); return () => window.clearTimeout(timer); }, [loadMembers]);

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!organization) return;
    const nextName = String(new FormData(event.currentTarget).get("name") || "").trim();
    setBusy(true); setError(""); setNotice("");
    const { error: updateError } = await supabase.rpc("rename_organization", { p_organization_id: organization.id, p_name: nextName });
    setBusy(false);
    if (updateError) setError("Could not update workspace name: " + updateError.message); else { setNotice("Workspace name updated."); await reload(); }
  }

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!organization) return;
    setBusy(true); setError(""); setNotice("");
    const { error: addError } = await supabase.rpc("add_organization_member", { p_organization_id: organization.id, p_email: email.trim(), p_role: role });
    setBusy(false);
    if (addError) setError(addError.message); else { setNotice("Member role assigned to the existing account."); setEmail(""); await loadMembers(); }
  }

  async function changeRole(member: Member, nextRole: string) {
    if (!organization) return; setBusy(true); setError("");
    const { error: updateError } = await supabase.rpc("set_organization_member_role", { p_organization_id: organization.id, p_user_id: member.member_user_id, p_role: nextRole });
    setBusy(false);
    if (updateError) setError("Could not change member role: " + updateError.message); else { setNotice("Member role updated."); await loadMembers(); await reload(); }
  }

  return <div>
    <div className="page-heading"><div><p className="eyebrow">Workspace administration</p><h1>Settings</h1><p>Manage this company workspace and the roles that control accounting and construction approvals.</p></div></div>
    {notice && <p className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</p>}{error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
    <div className="content-grid" style={{ gridTemplateColumns: "minmax(0, .9fr) minmax(0, 1.25fr)", alignItems: "start" }}>
      <div className="stack">
        <section className="panel"><div className="panel-header"><div><h2>Company workspace</h2><p>Workspace data is scoped by organization membership.</p></div></div><div className="panel-body stack">
          <div className="data-list-row"><span><strong>Workspace ID</strong><small>Use for admin support and controlled legacy data mapping</small></span><code style={{ fontSize: 9, wordBreak: "break-all" }}>{organization?.id}</code></div>
          <div className="data-list-row"><span><strong>Your role</strong><small>{user?.email}</small></span><span className="chip chip-success">{organization?.role.replaceAll("_", " ")}</span></div>
          {isOwner && <form className="form-stack" onSubmit={saveName}><label className="field">Company name<input className="input" name="name" required minLength={2} maxLength={120} defaultValue={organization?.name || ""} /></label><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save workspace name"}</button></form>}
          <div className="alert alert-info" style={{ margin: 0 }}><strong>Connection setup</strong><p style={{ margin: "5px 0 0" }}>{supabaseReady ? "Supabase URL and public anon key are configured. Data access depends on the project being reachable and the LeaderCon migrations being applied." : "Supabase URL and public anon key are not configured. Add them to the local server environment using .env.example."}</p></div>
        </div></section>
        <section className="panel"><div className="panel-header"><div><h2>Roles</h2><p>Roles control data entry and approval actions.</p></div></div><div className="panel-body data-list">
          {[["Owner", "Full workspace administration and financial posting"], ["Accountant", "Vendors, ledger posting, invoices, reports, approvals"], ["Project manager", "Projects, operational records, and construction approvals"], ["Site engineer", "Project and construction draft entry"], ["Auditor", "Workspace read access"]].map(([title, description]) => <div className="data-list-row" key={title}><span><strong>{title}</strong><small>{description}</small></span></div>)}
        </div></section>
      </div>
      <section className="panel"><div className="panel-header"><div><h2>Workspace members</h2><p>Only owners can see the member directory and change roles.</p></div>{isOwner && <span className="chip">{members.length} members</span>}</div>
        {isOwner ? <>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Email</th><th>Joined</th><th>Role</th></tr></thead><tbody>{members.map((member) => <tr key={member.member_user_id}><td><strong>{member.email}</strong>{member.member_user_id === user?.id && <div className="source-ref">You</div>}</td><td>{formatDate(member.joined_at.slice(0, 10))}</td><td><select className="select" value={member.role} disabled={busy} aria-label={"Role for " + member.email} onChange={(event) => void changeRole(member, event.target.value)}>{roles.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></td></tr>)}{!members.length && !loading && <tr><td colSpan={3} className="table-empty">No members found.</td></tr>}</tbody></table></div>
          {loading && <div className="loading-card"><span className="spinner" /> Loading members…</div>}
          <div className="panel-body" style={{ borderTop: "1px solid var(--line)" }}><h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Add an existing account</h3><p className="muted" style={{ marginTop: 0 }}>Create or invite the person in Supabase Authentication first, then assign their account here.</p><form onSubmit={addMember} className="field-grid"><label className="field">Account email<input className="input" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="field">Role<select className="select" value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><button className="button button-primary" style={{ gridColumn: "1 / -1" }} disabled={busy}>{busy ? "Saving…" : "Add member"}</button></form></div>
        </> : <div className="panel-body"><p className="muted">The member directory is available to workspace owners.</p></div>}
      </section>
    </div>
    <p className="credit-line">LeaderCon · Developed by Alesh</p>
  </div>;
}
