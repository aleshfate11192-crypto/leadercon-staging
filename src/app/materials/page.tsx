"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { downloadCsv, formatDate, formatINR } from "@/lib/financials";
import { supabase } from "@/lib/supabase";

type Option = { id: string; name: string };
type RecordRow = { id: string; project_id: string | null; site_id: string | null; vendor_id: string | null; material_name: string; category: string | null; quantity: number | string; unit: string | null; unit_rate: number | string; amount: number | string; order_date: string; reference_number: string | null; status: string; notes: string | null };
const statuses = ["requested", "ordered", "part_received", "received", "cancelled"];

export default function MaterialsPage() {
  const { organization } = useWorkspace();
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [sites, setSites] = useState<(Option & { project_id: string })[]>([]);
  const [vendors, setVendors] = useState<Option[]>([]);
  const [form, setForm] = useState({ project_id: "", site_id: "", vendor_id: "", material_name: "", category: "", quantity: "", unit: "", unit_rate: "", order_date: new Date().toISOString().slice(0, 10), reference_number: "", status: "requested", notes: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [r, p, s, v] = await Promise.all([
      supabase.from("procurement_records").select("id, project_id, site_id, vendor_id, material_name, category, quantity, unit, unit_rate, amount, order_date, reference_number, status, notes").eq("organization_id", organization.id).order("order_date", { ascending: false }).limit(1500),
      supabase.from("projects").select("id, name").eq("organization_id", organization.id).neq("status", "archived").order("name"),
      supabase.from("project_sites").select("id, name, project_id").eq("organization_id", organization.id).order("name"),
      supabase.from("vendors").select("id, name").eq("organization_id", organization.id).eq("is_archived", false).order("name"),
    ]);
    const loadError = r.error || p.error || s.error || v.error;
    setError(loadError ? "Could not load procurement records: " + loadError.message : "");
    setRecords((r.data ?? []) as RecordRow[]); setProjects((p.data ?? []) as Option[]); setSites((s.data ?? []) as (Option & { project_id: string })[]); setVendors((v.data ?? []) as Option[]); setLoading(false);
  }, [organization]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);
  const availableSites = sites.filter((site) => !form.project_id || site.project_id === form.project_id);
  const projectName = (id: string | null) => projects.find((row) => row.id === id)?.name || "—";
  const vendorName = (id: string | null) => vendors.find((row) => row.id === id)?.name || "—";
  const filtered = records.filter((row) => [row.material_name, row.category, row.reference_number, projectName(row.project_id), vendorName(row.vendor_id), row.status].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const total = filtered.filter((row) => row.status !== "cancelled").reduce((sum, row) => sum + Number(row.amount), 0);
  const canManage = ["owner", "accountant", "project_manager", "site_engineer"].includes(organization?.role || "");

  async function addRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!organization) return;
    const quantity = Number(form.quantity); const rate = Number(form.unit_rate);
    if (!form.material_name.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0) { setError("Enter a material name, positive quantity, and non-negative rate."); return; }
    setSaving(true); setError(""); setNotice("");
    const { error: insertError } = await supabase.from("procurement_records").insert({ organization_id: organization.id, project_id: form.project_id || null, site_id: form.site_id || null, vendor_id: form.vendor_id || null, material_name: form.material_name.trim(), category: form.category || null, quantity, unit: form.unit || null, unit_rate: rate, order_date: form.order_date, reference_number: form.reference_number || null, status: form.status, notes: form.notes || null });
    setSaving(false);
    if (insertError) setError("Could not add procurement record: " + insertError.message);
    else { setNotice("Procurement record added. Its amount is calculated from quantity × rate."); setForm({ ...form, site_id: "", vendor_id: "", material_name: "", category: "", quantity: "", unit: "", unit_rate: "", reference_number: "", status: "requested", notes: "" }); await loadData(); }
  }

  async function changeStatus(row: RecordRow, status: string) {
    if (!organization) return;
    const { error: updateError } = await supabase.from("procurement_records").update({ status }).eq("id", row.id).eq("organization_id", organization.id);
    if (updateError) setError("Could not update delivery status: " + updateError.message); else await loadData();
  }

  function exportCsv() { downloadCsv("leadercon-procurement.csv", [["Date", "Material", "Category", "Project", "Vendor", "Quantity", "Unit", "Rate INR", "Amount INR", "Reference", "Status"], ...filtered.map((row) => [row.order_date, row.material_name, row.category, projectName(row.project_id), vendorName(row.vendor_id), row.quantity, row.unit, row.unit_rate, row.amount, row.reference_number, row.status])]); }

  return <div>
    <div className="page-heading"><div><p className="eyebrow">Operations · Procurement</p><h1>Materials & Procurement</h1><p>Track material requests, purchase orders, supplier links, deliveries, and deterministically calculated order amounts.</p></div><div className="page-heading-actions"><button className="button button-secondary" onClick={exportCsv} disabled={!filtered.length}>Export records</button></div></div>
    {notice && <p className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</p>}{error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
    <div className="metrics-grid" style={{ marginBottom: 14 }}><div className="metric-card"><div className="metric-top">Records <span>▤</span></div><div className="metric-value">{filtered.length}</div><div className="metric-foot">Current filter</div></div><div className="metric-card"><div className="metric-top">Order value <span>₹</span></div><div className="metric-value" style={{ fontSize: 22 }}>{formatINR(total)}</div><div className="metric-foot">Excludes cancelled orders</div></div><div className="metric-card"><div className="metric-top">In transit <span>↗</span></div><div className="metric-value">{filtered.filter((row) => ["ordered", "part_received"].includes(row.status)).length}</div><div className="metric-foot">Ordered or partly received</div></div></div>
    <div className="content-grid" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(310px, .75fr)", alignItems: "start" }}>
      <section className="panel"><div className="panel-header"><div><h2>Purchase and delivery register</h2><p>Track request, ordered, partial delivery, receipt, or cancellation.</p></div></div><div className="toolbar"><input className="input" placeholder="Search material, project, supplier" aria-label="Search procurement" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        {loading ? <div className="loading-card"><span className="spinner" /> Loading procurement…</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Date / reference</th><th>Material</th><th>Project / supplier</th><th className="numeric">Qty × rate</th><th className="numeric">Amount</th><th>Delivery status</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td>{formatDate(row.order_date)}<div className="source-ref">{row.reference_number || "—"}</div></td><td><strong>{row.material_name}</strong><div className="source-ref">{row.category || ""}</div></td><td>{projectName(row.project_id)}<div className="source-ref">{vendorName(row.vendor_id)}</div></td><td className="numeric">{Number(row.quantity).toLocaleString("en-IN")} {row.unit} × {formatINR(row.unit_rate)}</td><td className="numeric">{formatINR(row.amount)}</td><td>{canManage ? <select className="select" aria-label={"Delivery status for " + row.material_name} value={row.status} onChange={(event) => void changeStatus(row, event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select> : <span className="chip chip-neutral">{row.status.replaceAll("_", " ")}</span>}</td></tr>)}{!filtered.length && <tr><td colSpan={6} className="table-empty">{records.length ? "No records match your search." : "No purchase records yet."}</td></tr>}</tbody></table></div>}
      </section>
      {canManage ? <section className="panel"><div className="panel-header"><div><h2>Add a procurement record</h2><p>Database calculates quantity × unit rate.</p></div></div><form onSubmit={addRecord} className="panel-body form-stack">
        <label className="field">Material or item<input className="input" required maxLength={180} value={form.material_name} onChange={(event) => setForm({ ...form, material_name: event.target.value })} /></label>
        <div className="field-grid"><label className="field">Category<input className="input" maxLength={80} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Cement, steel…" /></label><label className="field">Unit<input className="input" maxLength={30} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="bags, tonnes…" /></label></div>
        <div className="field-grid"><label className="field">Quantity<input className="input" required type="number" min="0.0001" step="0.0001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><label className="field">Unit rate (INR)<input className="input" required type="number" min="0" step="0.01" value={form.unit_rate} onChange={(event) => setForm({ ...form, unit_rate: event.target.value })} /></label></div>
        <label className="field">Project<select className="select" value={form.project_id} onChange={(event) => setForm({ ...form, project_id: event.target.value, site_id: "" })}><option value="">Not linked</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">Site<select className="select" value={form.site_id} onChange={(event) => setForm({ ...form, site_id: event.target.value })}><option value="">Not linked</option>{availableSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label className="field">Supplier<select className="select" value={form.vendor_id} onChange={(event) => setForm({ ...form, vendor_id: event.target.value })}><option value="">Not linked</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <div className="field-grid"><label className="field">Order date<input className="input" type="date" value={form.order_date} onChange={(event) => setForm({ ...form, order_date: event.target.value })} /></label><label className="field">Reference / PO<input className="input" maxLength={100} value={form.reference_number} onChange={(event) => setForm({ ...form, reference_number: event.target.value })} /></label></div>
        <label className="field">Status<select className="select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
        <label className="field">Notes<textarea className="textarea" rows={2} maxLength={500} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        <button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Add procurement record"}</button>
      </form></section> : <section className="panel"><div className="panel-body muted">Your workspace role can view procurement but cannot add or update records.</div></section>}
    </div>
  </div>;
}
