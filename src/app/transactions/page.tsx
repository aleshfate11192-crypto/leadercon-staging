"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import DocumentUpload from "@/components/document-upload";
import { useWorkspace } from "@/components/workspace-provider";
import { canPostFinancialRecords, downloadCsv, formatDate, formatINR } from "@/lib/financials";
import { supabase } from "@/lib/supabase";

type Vendor = { id: string; name: string; opening_balance: number | string | null };
type Project = { id: string; name: string };
type InvoiceBalance = { invoice_id: string; vendor_id: string; invoice_amount: number | string; paid_amount: number | string; outstanding_amount: number | string };
type Transaction = { id: string; vendor_id: string; project_id: string | null; transaction_type: string; transaction_date: string; reference_number: string | null; description: string | null; amount: number | string; due_date: string | null; status: string };
const types = ["invoice", "payment", "credit_note", "advance", "adjustment"];

export default function TransactionsPage() {
  const { organization, user } = useWorkspace();
  const query = useSearchParams();
  const requestedType = query.get("type") || "invoice";
  const defaultType = types.includes(requestedType) ? requestedType : "invoice";
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [invoiceBalances, setInvoiceBalances] = useState<InvoiceBalance[]>([]);
  const [form, setForm] = useState({ vendor_id: "", project_id: "", transaction_type: defaultType, transaction_date: new Date().toISOString().slice(0, 10), amount: "", reference_number: "", description: "", due_date: "", status: "posted" });
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [pendingRetry, setPendingRetry] = useState(false);
  const pendingRequest = useRef<{ key: string; fingerprint: string } | null>(null);
  const canWrite = canPostFinancialRecords(organization?.role);

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [vendorResult, projectResult, transactionResult, balanceResult] = await Promise.all([
      supabase.from("vendors").select("id, name, opening_balance").eq("organization_id", organization.id).eq("is_archived", false).order("name"),
      supabase.from("projects").select("id, name").eq("organization_id", organization.id).neq("status", "archived").order("name"),
      supabase.from("vendor_transactions").select("id, vendor_id, project_id, transaction_type, transaction_date, reference_number, description, amount, due_date, status").eq("organization_id", organization.id).order("transaction_date", { ascending: false }).limit(1500),
      supabase.rpc("get_invoice_balances", { p_organization_id: organization.id }),
    ]);
    const errorResult = vendorResult.error || projectResult.error || transactionResult.error || balanceResult.error;
    if (errorResult) setError("Could not load ledger data. Confirm the database migrations and workspace setup: " + errorResult.message);
    setVendors((vendorResult.data ?? []) as Vendor[]);
    setProjects((projectResult.data ?? []) as Project[]);
    setTransactions((transactionResult.data ?? []) as Transaction[]);
    setInvoiceBalances((balanceResult.data ?? []) as InvoiceBalance[]);
    setLoading(false);
  }, [organization]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);

  useEffect(() => {
    if (!organization || !user) return;
    const storageKey = `leadercon-transaction-retry:${organization.id}:${user.id}`;
    const timer = window.setTimeout(() => {
      try {
        const saved = window.sessionStorage.getItem(storageKey);
        if (!saved) return;
        const parsed = JSON.parse(saved) as { key?: unknown; fingerprint?: unknown };
        if (typeof parsed.key === "string" && typeof parsed.fingerprint === "string") {
          pendingRequest.current = { key: parsed.key, fingerprint: parsed.fingerprint };
          setPendingRetry(true);
        } else {
          window.sessionStorage.removeItem(storageKey);
        }
      } catch {
        // The in-memory retry key still protects retries during this page visit.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [organization, user]);

  const vendorNames = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor.name])), [vendors]);
  const invoiceRows = useMemo(() => {
    const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    return invoiceBalances.map((balance) => ({ ...balance, transaction: byId.get(balance.invoice_id) })).filter((row) => row.transaction && Number(row.outstanding_amount) > 0);
  }, [invoiceBalances, transactions]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return transactions.filter((row) => {
      const text = [vendorNames.get(row.vendor_id), row.reference_number, row.description, row.transaction_type].join(" ").toLowerCase();
      return text.includes(term) && (typeFilter === "all" || row.transaction_type === typeFilter);
    });
  }, [transactions, search, typeFilter, vendorNames]);

  async function postTransaction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !user || !canWrite) return;
    setError("");
    setNotice("");
    const amount = Number(form.amount);
    if (!form.vendor_id || !Number.isFinite(amount) || amount === 0 || (form.transaction_type !== "adjustment" && amount < 0)) {
      setError("Choose a vendor and enter a valid amount. Adjustments may be positive or negative.");
      return;
    }
    if (form.transaction_type === "invoice" && !form.due_date) {
      setError("Add a due date for the invoice.");
      return;
    }
    const parsedAllocations = form.transaction_type === "payment" && form.status === "posted"
      ? Object.entries(allocations).filter(([, value]) => Number(value) > 0).map(([invoice_id, value]) => ({ invoice_id, amount: Number(value) }))
      : [];
    const allocationTotal = parsedAllocations.reduce((sum, item) => sum + item.amount, 0);
    if (allocationTotal > Math.abs(amount)) {
      setError("Invoice allocations cannot exceed this payment amount.");
      return;
    }

    const request = {
      p_organization_id: organization.id,
      p_vendor_id: form.vendor_id,
      p_transaction_type: form.transaction_type,
      p_transaction_date: form.transaction_date,
      p_amount: amount,
      p_reference_number: form.reference_number.trim() || null,
      p_description: form.description.trim() || null,
      p_due_date: form.transaction_type === "invoice" ? form.due_date : null,
      p_project_id: form.project_id || null,
      p_status: form.status,
      p_allocations: parsedAllocations,
    };
    const fingerprint = JSON.stringify(request);
    if (pendingRequest.current && pendingRequest.current.fingerprint !== fingerprint) {
      setError("A previous transaction attempt may have reached the ledger. Refresh and check the ledger, then retry with the same details or confirm below that you checked for a duplicate.");
      return;
    }
    if (!pendingRequest.current) {
      pendingRequest.current = { key: crypto.randomUUID(), fingerprint };
      setPendingRetry(true);
      try {
        window.sessionStorage.setItem(
          `leadercon-transaction-retry:${organization.id}:${user.id}`,
          JSON.stringify(pendingRequest.current),
        );
      } catch {
        // The database idempotency key remains active for this page visit.
      }
    }

    setSaving(true);
    const { error: createError } = await supabase.rpc("create_vendor_transaction_idempotent", {
      p_idempotency_key: pendingRequest.current.key,
      ...request,
    });
    setSaving(false);
    if (createError) {
      setError("The transaction was not saved: " + createError.message);
      return;
    }
    pendingRequest.current = null;
    setPendingRetry(false);
    try { window.sessionStorage.removeItem(`leadercon-transaction-retry:${organization.id}:${user.id}`); } catch { /* ignore unavailable session storage */ }
    setNotice(form.status === "posted" ? "Transaction posted to the ledger." : "Draft transaction saved. It does not affect balances.");
    setForm({ vendor_id: "", project_id: "", transaction_type: "invoice", transaction_date: new Date().toISOString().slice(0, 10), amount: "", reference_number: "", description: "", due_date: "", status: "posted" });
    setAllocations({});
    await loadData();
  }

  function exportLedger() {
    downloadCsv("leadercon-vendor-ledger.csv", [
      ["Date", "Vendor", "Project ID", "Type", "Reference", "Description", "Amount INR", "Due date", "Status"],
      ...filtered.map((row) => [row.transaction_date, vendorNames.get(row.vendor_id), row.project_id, row.transaction_type, row.reference_number, row.description, row.amount, row.due_date, row.status]),
    ]);
  }

  const selectedVendorInvoices = invoiceRows.filter((row) => row.vendor_id === form.vendor_id);
  const totalAmount = Number(form.amount || 0);
  const currentAllocationTotal = Object.values(allocations).reduce((sum, value) => sum + (Number(value) || 0), 0);

  return (
    <div>
      <div className="page-heading"><div><p className="eyebrow">Accounts · Vendor ledger</p><h1>Transactions</h1><p>Post invoices, payments, credits, advances, and adjustments through one auditable ledger.</p></div><div className="page-heading-actions"><button className="button button-secondary" onClick={exportLedger} disabled={!filtered.length}>Export ledger</button><Link href="/invoices" className="button button-secondary">Invoices & bills</Link></div></div>
      {notice && <p className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</p>}
      {error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      {pendingRetry && organization && user && <div className="alert alert-warning" role="status" style={{ marginBottom: 12 }}><strong>Transaction retry protection is active.</strong><p>If the last request timed out, resubmit the same details. LeaderCon will return the same ledger transaction instead of posting it twice. Refresh and check the ledger before starting a different transaction.</p><div className="form-actions"><button className="button button-secondary" type="button" onClick={() => void loadData()}>Refresh ledger</button><button className="text-button" type="button" onClick={() => { if (!window.confirm("Only continue if you checked the ledger and confirmed the previous transaction was not saved.")) return; pendingRequest.current = null; setPendingRetry(false); try { window.sessionStorage.removeItem(`leadercon-transaction-retry:${organization.id}:${user.id}`); } catch { /* ignore unavailable session storage */ } setError(""); }}>I checked; start a new transaction</button></div></div>}
      <div className="content-grid" style={{ gridTemplateColumns: canWrite ? "minmax(0, 1.35fr) minmax(310px, .9fr)" : "1fr", alignItems: "start" }}>
        <section className="panel">
          <div className="panel-header"><div><h2>Vendor ledger</h2><p>Drafts are listed for review but do not affect official balances.</p></div><span className="chip">{transactions.length} records</span></div>
          <div className="toolbar"><input className="input" placeholder="Search vendor or reference" aria-label="Search transactions" value={search} onChange={(event) => setSearch(event.target.value)} /><select className="select" style={{ width: "auto", minWidth: 145 }} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All types</option>{types.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></div>
          {loading ? <div className="loading-card"><span className="spinner" /> Loading transactions…</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Vendor / reference</th><th>Type</th><th className="numeric">Amount</th><th>Due</th><th>Status</th></tr></thead><tbody>
            {filtered.map((row) => <tr key={row.id}><td>{formatDate(row.transaction_date)}</td><td><button className="text-button primary-cell" onClick={() => setSelected(row)}>{vendorNames.get(row.vendor_id) || "Vendor"}</button><div className="source-ref">{row.reference_number || row.description || "—"}</div></td><td style={{ textTransform: "capitalize" }}>{row.transaction_type.replaceAll("_", " ")}</td><td className="numeric">{formatINR(row.amount)}</td><td>{formatDate(row.due_date)}</td><td><span className={"chip " + (row.status === "posted" ? "chip-success" : "chip-warning")}>{row.status}</span></td></tr>)}
            {!filtered.length && <tr><td colSpan={6} className="table-empty">{transactions.length ? "No transactions match your filters." : "No transactions recorded yet."}</td></tr>}
          </tbody></table></div>}
          <div className="pagination-row"><span>Balances are calculated in the database from posted entries.</span><span>{filtered.length} shown</span></div>
        </section>

        {canWrite && <section className="panel">
          <div className="panel-header"><div><h2>Record a transaction</h2><p>Financial records are created atomically with an audit entry.</p></div></div>
          <form onSubmit={postTransaction} className="panel-body form-stack">
            <label className="field">Transaction type<select className="select" value={form.transaction_type} onChange={(event) => { setForm({ ...form, transaction_type: event.target.value }); setAllocations({}); }}>
              {types.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
            </select></label>
            <label className="field">Vendor<select className="select" required value={form.vendor_id} onChange={(event) => { setForm({ ...form, vendor_id: event.target.value }); setAllocations({}); }}><option value="">Select a vendor</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
            <div className="field-grid"><label className="field">Date<input className="input" type="date" required value={form.transaction_date} onChange={(event) => setForm({ ...form, transaction_date: event.target.value })} /></label><label className="field">Amount (INR)<input className="input" type="number" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder={form.transaction_type === "adjustment" ? "Positive or negative" : "0.00"} /></label></div>
            <label className="field">Project / site<select className="select" value={form.project_id} onChange={(event) => setForm({ ...form, project_id: event.target.value })}><option value="">Not project-linked</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <div className="field-grid"><label className="field">Reference<input className="input" maxLength={100} value={form.reference_number} onChange={(event) => setForm({ ...form, reference_number: event.target.value })} /></label><label className="field">Status<select className="select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="posted">Post to ledger</option><option value="draft">Save as draft</option></select></label></div>
            {form.transaction_type === "invoice" && <label className="field">Due date<input className="input" type="date" required value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></label>}
            <label className="field">Description<textarea className="textarea" rows={3} maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What is this transaction for?" /></label>
            {form.transaction_type === "payment" && form.status === "posted" && selectedVendorInvoices.length > 0 && <div className="panel" style={{ boxShadow: "none" }}>
              <div className="panel-header"><div><h2>Allocate to invoices</h2><p>{formatINR(currentAllocationTotal)} allocated of {formatINR(totalAmount)} payment</p></div></div>
              <div className="panel-body data-list">{selectedVendorInvoices.map((row) => <label key={row.invoice_id} className="data-list-row"><span><strong>{row.transaction?.reference_number || "Invoice"}</strong><small>Due {formatDate(row.transaction?.due_date)} · Open {formatINR(row.outstanding_amount)}</small></span><input aria-label={"Amount allocated to invoice " + (row.transaction?.reference_number || "")} className="input" style={{ width: 115 }} type="number" min="0" max={Number(row.outstanding_amount)} step="0.01" value={allocations[row.invoice_id] || ""} onChange={(event) => setAllocations({ ...allocations, [row.invoice_id]: event.target.value })} /></label>)}</div>
            </div>}
            <p className="alert alert-info">Payments, advances, and credit notes reduce the vendor balance. Only posted records change the official balance.</p>
            <button className="button button-primary button-full" disabled={saving || !vendors.length}>{saving ? "Saving securely…" : form.status === "draft" ? "Save draft" : "Post transaction"}</button>
          </form>
        </section>}
      </div>

      {selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <section className="modal modal-narrow" role="dialog" aria-modal="true" aria-labelledby="transaction-detail-title">
          <div className="modal-header"><div><p className="eyebrow">{selected.transaction_type.replaceAll("_", " ")}</p><h2 id="transaction-detail-title">{selected.reference_number || "Transaction"}</h2><p>{vendorNames.get(selected.vendor_id) || "Vendor"} · {formatDate(selected.transaction_date)}</p></div><button className="close-button" aria-label="Close" onClick={() => setSelected(null)}>×</button></div>
          <div className="modal-content stack"><div className="metric-card"><div className="metric-top">Transaction amount <span className={"chip " + (selected.status === "posted" ? "chip-success" : "chip-warning")}>{selected.status}</span></div><p className="metric-value">{formatINR(selected.amount)}</p><span className="metric-note">Due date: {formatDate(selected.due_date)}</span></div><p className="muted">{selected.description || "No description provided."}</p><DocumentUpload vendorId={selected.vendor_id} transactionId={selected.id} documentType={selected.transaction_type === "payment" ? "payment_proof" : selected.transaction_type === "invoice" ? "invoice" : "other"} /></div>
        </section>
      </div>}
    </div>
  );
}
