"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { downloadCsv, formatDate, formatINR } from "@/lib/financials";
import { calculateLabourOutstanding, deriveLabourPaymentStatus } from "@/lib/labour";
import { supabase } from "@/lib/supabase";

type Option = { id: string; name: string };
type LabourRow = { id: string; project_id: string | null; site_id: string | null; vendor_id: string | null; category: string; work_date: string; workers_count: number; days: number | string; rate: number | string; amount: number | string; work_description: string | null; payment_status: string };
type LabourPayment = { labour_record_id: string; amount: number | string };

export default function LabourPage() {
  const { organization } = useWorkspace();
  const [rows, setRows] = useState<LabourRow[]>([]);
  const [payments, setPayments] = useState<LabourPayment[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [sites, setSites] = useState<(Option & { project_id: string })[]>([]);
  const [vendors, setVendors] = useState<Option[]>([]);
  const [form, setForm] = useState({ project_id: "", site_id: "", vendor_id: "", category: "", work_date: new Date().toISOString().slice(0, 10), workers_count: "", days: "1", rate: "", work_description: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedPayment, setSelectedPayment] = useState<LabourRow | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [savingPayment, setSavingPayment] = useState(false);
  const paymentRetryRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [l, p, s, v, pl] = await Promise.all([
      supabase.from("labour_records").select("id, project_id, site_id, vendor_id, category, work_date, workers_count, days, rate, amount, work_description, payment_status").eq("organization_id", organization.id).order("work_date", { ascending: false }).limit(1500),
      supabase.from("projects").select("id, name").eq("organization_id", organization.id).neq("status", "archived").order("name"),
      supabase.from("project_sites").select("id, name, project_id").eq("organization_id", organization.id).order("name"),
      supabase.from("vendors").select("id, name").eq("organization_id", organization.id).eq("is_archived", false).order("name"),
      supabase.from("labour_payment_links").select("labour_record_id, amount").eq("organization_id", organization.id),
    ]);
    const loadError = l.error || p.error || s.error || v.error || pl.error;
    setError(loadError ? "Could not load labour records: " + loadError.message : "");
    setRows((l.data ?? []) as LabourRow[]); setPayments((pl.data ?? []) as LabourPayment[]); setProjects((p.data ?? []) as Option[]); setSites((s.data ?? []) as (Option & { project_id: string })[]); setVendors((v.data ?? []) as Option[]); setLoading(false);
  }, [organization]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);
  const availableSites = sites.filter((site) => !form.project_id || site.project_id === form.project_id);
  const projectName = (id: string | null) => projects.find((row) => row.id === id)?.name || "—";
  const vendorName = (id: string | null) => vendors.find((row) => row.id === id)?.name || "—";
  const paidFor = (id: string) => payments.filter((payment) => payment.labour_record_id === id).reduce((sum, payment) => sum + Number(payment.amount), 0);
  const hasUnlinkedLegacyStatus = (row: LabourRow) => paidFor(row.id) === 0 && row.payment_status !== "unpaid";
  const remainingFor = (row: LabourRow) => calculateLabourOutstanding(row.amount, paidFor(row.id));
  const paymentStatusFor = (row: LabourRow) => hasUnlinkedLegacyStatus(row) ? "needs review" : deriveLabourPaymentStatus(row.amount, paidFor(row.id));
  const filtered = rows.filter((row) => [row.category, row.work_description, projectName(row.project_id), vendorName(row.vendor_id), row.payment_status].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const totalCost = filtered.reduce((sum, row) => sum + Number(row.amount), 0);
  const unpaidCost = filtered.filter((row) => !hasUnlinkedLegacyStatus(row)).reduce((sum, row) => sum + remainingFor(row), 0);
  const legacyStatusCount = filtered.filter(hasUnlinkedLegacyStatus).length;
  const canManage = ["owner", "accountant", "project_manager", "site_engineer"].includes(organization?.role || "");
  const canPostPayments = ["owner", "accountant"].includes(organization?.role || "");

  async function addRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!organization) return;
    const workers = Number(form.workers_count); const days = Number(form.days); const rate = Number(form.rate);
    if (!form.category.trim() || !Number.isInteger(workers) || workers <= 0 || !Number.isFinite(days) || days <= 0 || !Number.isFinite(rate) || rate < 0) { setError("Enter a category, positive worker count and days, and a non-negative rate."); return; }
    setSaving(true); setError(""); setNotice("");
    const { error: insertError } = await supabase.from("labour_records").insert({ organization_id: organization.id, project_id: form.project_id || null, site_id: form.site_id || null, vendor_id: form.vendor_id || null, category: form.category.trim(), work_date: form.work_date, workers_count: workers, days, rate, work_description: form.work_description || null, payment_status: "unpaid" });
    setSaving(false);
    if (insertError) setError("Could not add labour record: " + insertError.message);
    else { setNotice("Labour attendance recorded. Amount is calculated as workers × days × rate."); setForm({ ...form, site_id: "", category: "", workers_count: "", days: "1", rate: "", work_description: "" }); await loadData(); }
  }

  async function recordPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !selectedPayment) return;
    const amount = Number(paymentAmount);
    const remaining = remainingFor(selectedPayment);
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining || Math.round(amount * 100) !== amount * 100) {
      setError("Enter a positive payment amount to the nearest paise, no greater than the remaining labour amount.");
      return;
    }
    if (!selectedPayment.vendor_id) {
      setError("Link a labour supplier before posting this payment to the vendor ledger.");
      return;
    }
    const fingerprint = JSON.stringify({ labourRecordId: selectedPayment.id, paymentDate, amount });
    let retry = paymentRetryRef.current;
    if (!retry || retry.fingerprint !== fingerprint) {
      const storageKey = `leadercon:labour-payment:${organization.id}`;
      const stored = window.sessionStorage.getItem(storageKey);
      try {
        const parsed = stored ? JSON.parse(stored) as { fingerprint?: string; key?: string } : null;
        retry = parsed?.fingerprint === fingerprint && parsed.key ? { fingerprint, key: parsed.key } : null;
      } catch { retry = null; }
      if (!retry) retry = { fingerprint, key: crypto.randomUUID() };
      paymentRetryRef.current = retry;
      window.sessionStorage.setItem(storageKey, JSON.stringify(retry));
    }

    setSavingPayment(true); setError(""); setNotice("");
    const { error: paymentError } = await supabase.rpc("record_labour_payment", {
      p_idempotency_key: retry.key,
      p_organization_id: organization.id,
      p_labour_record_id: selectedPayment.id,
      p_payment_date: paymentDate,
      p_amount: amount,
    });
    setSavingPayment(false);
    if (paymentError) {
      setError("Could not post labour payment: " + paymentError.message);
      return;
    }
    window.sessionStorage.removeItem(`leadercon:labour-payment:${organization.id}`);
    paymentRetryRef.current = null;
    setNotice("Payment posted to the vendor ledger and linked to this labour record.");
    setSelectedPayment(null); setPaymentAmount("");
    await loadData();
  }

  function exportCsv() { downloadCsv("leadercon-labour-register.csv", [["Date", "Project", "Site", "Trade", "Workers", "Days", "Rate INR", "Amount INR", "Paid INR", "Outstanding INR", "Vendor", "Payment status"], ...filtered.map((row) => [row.work_date, projectName(row.project_id), sites.find((site) => site.id === row.site_id)?.name, row.category, row.workers_count, row.days, row.rate, row.amount, paidFor(row.id), hasUnlinkedLegacyStatus(row) ? "Review legacy status" : remainingFor(row), vendorName(row.vendor_id), paymentStatusFor(row)])]); }

  return <div>
    <div className="page-heading"><div><p className="eyebrow">Operations · Workforce</p><h1>Labour</h1><p>Record work attendance and track labour costs by project, site, trade, and supplier.</p></div><div className="page-heading-actions"><button className="button button-secondary" onClick={exportCsv} disabled={!filtered.length}>Export register</button></div></div>
    {notice && <p className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</p>}{error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
    <div className="metrics-grid" style={{ marginBottom: 14 }}><div className="metric-card"><div className="metric-top">Attendance records <span>♧</span></div><div className="metric-value">{filtered.length}</div><div className="metric-foot">Current filter</div></div><div className="metric-card"><div className="metric-top">Recorded labour cost <span>₹</span></div><div className="metric-value" style={{ fontSize: 22 }}>{formatINR(totalCost)}</div><div className="metric-foot">Workers × days × rate</div></div><div className="metric-card"><div className="metric-top">Ledger-linked outstanding <span>◷</span></div><div className="metric-value" style={{ fontSize: 22 }}>{formatINR(unpaidCost)}</div><div className="metric-foot">{legacyStatusCount ? `${legacyStatusCount} legacy status${legacyStatusCount === 1 ? "" : "es"} need review` : "Calculated from posted linked payments"}</div></div></div>
    <div className="content-grid" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(310px, .75fr)", alignItems: "start" }}>
      <section className="panel"><div className="panel-header"><div><h2>Attendance and cost register</h2><p>Payments are posted to the linked supplier ledger and cannot exceed the remaining labour cost.</p></div></div><div className="toolbar"><input className="input" placeholder="Search trade, project, supplier" aria-label="Search labour records" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        {loading ? <div className="loading-card"><span className="spinner" /> Loading labour records…</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Date / project</th><th>Trade / site</th><th className="numeric">Workers</th><th className="numeric">Days</th><th className="numeric">Rate</th><th className="numeric">Amount</th><th className="numeric">Paid / due</th><th>Payment</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td>{formatDate(row.work_date)}<div className="source-ref">{projectName(row.project_id)}</div></td><td><strong>{row.category}</strong><div className="source-ref">{row.work_description || sites.find((site) => site.id === row.site_id)?.name || vendorName(row.vendor_id)}</div></td><td className="numeric">{row.workers_count}</td><td className="numeric">{Number(row.days).toLocaleString("en-IN")}</td><td className="numeric">{formatINR(row.rate)}</td><td className="numeric">{formatINR(row.amount)}</td><td className="numeric">{hasUnlinkedLegacyStatus(row) ? "—" : formatINR(paidFor(row.id))}<div className="source-ref">{hasUnlinkedLegacyStatus(row) ? "Verify existing status" : `Due ${formatINR(remainingFor(row))}`}</div></td><td>{canPostPayments && !hasUnlinkedLegacyStatus(row) && remainingFor(row) > 0 ? row.vendor_id ? <button className="text-button" onClick={() => { setSelectedPayment(row); setPaymentAmount(remainingFor(row).toFixed(2)); setPaymentDate(new Date().toISOString().slice(0, 10)); setError(""); }}>Record payment</button> : <span className="source-ref">Link supplier first</span> : <span className="chip chip-neutral">{paymentStatusFor(row)}</span>}</td></tr>)}{!filtered.length && <tr><td colSpan={8} className="table-empty">{rows.length ? "No records match your search." : "No labour entries yet."}</td></tr>}</tbody></table></div>}
      </section>
      {canManage ? <section className="panel"><div className="panel-header"><div><h2>Record labour attendance</h2><p>Each record calculates total cost deterministically.</p></div></div><form onSubmit={addRecord} className="panel-body form-stack">
        <label className="field">Trade / worker category<input className="input" required maxLength={100} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Mason, carpenter, helper…" /></label>
        <div className="field-grid"><label className="field">Workers<input className="input" required type="number" min="1" step="1" value={form.workers_count} onChange={(event) => setForm({ ...form, workers_count: event.target.value })} /></label><label className="field">Days per worker<input className="input" required type="number" min="0.01" step="0.01" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} /></label></div>
        <label className="field">Rate per worker-day (INR)<input className="input" required type="number" min="0" step="0.01" value={form.rate} onChange={(event) => setForm({ ...form, rate: event.target.value })} /></label>
        <label className="field">Project<select className="select" value={form.project_id} onChange={(event) => setForm({ ...form, project_id: event.target.value, site_id: "" })}><option value="">Not linked</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">Site<select className="select" value={form.site_id} onChange={(event) => setForm({ ...form, site_id: event.target.value })}><option value="">Not linked</option>{availableSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label className="field">Supplier / labour contractor<select className="select" value={form.vendor_id} onChange={(event) => setForm({ ...form, vendor_id: event.target.value })}><option value="">Not linked</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="field">Work date<input className="input" type="date" value={form.work_date} onChange={(event) => setForm({ ...form, work_date: event.target.value })} /></label><label className="field">Work description<textarea className="textarea" rows={3} maxLength={500} value={form.work_description} onChange={(event) => setForm({ ...form, work_description: event.target.value })} /></label>
        <button className="button button-primary" disabled={saving}>{saving ? "Saving…" : "Record attendance"}</button>
      </form></section> : <section className="panel"><div className="panel-body muted">Your workspace role can view labour records but cannot add or update them.</div></section>}
    </div>
    {selectedPayment && canPostPayments && <section className="panel" style={{ marginTop: 14, maxWidth: 640 }}>
      <div className="panel-header"><div><h2>Post labour payment</h2><p>{selectedPayment.category} · {vendorName(selectedPayment.vendor_id)} · Remaining {formatINR(remainingFor(selectedPayment))}</p></div></div>
      <form onSubmit={recordPayment} className="panel-body form-stack">
        <label className="field">Payment amount (INR)<input className="input" required type="number" min="0.01" max={remainingFor(selectedPayment).toFixed(2)} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
        <label className="field">Payment date<input className="input" required type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
        <p className="source-ref">This creates a posted supplier payment and reduces the vendor’s outstanding balance.</p>
        <div className="page-heading-actions"><button type="button" className="button button-secondary" onClick={() => setSelectedPayment(null)} disabled={savingPayment}>Cancel</button><button className="button button-primary" disabled={savingPayment}>{savingPayment ? "Posting…" : "Post payment"}</button></div>
      </form>
    </section>}
  </div>;
}
