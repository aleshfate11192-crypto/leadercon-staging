"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/components/workspace-provider";
import { canPostFinancialRecords, downloadCsv, formatDate, formatINR } from "@/lib/financials";
import { supabase } from "@/lib/supabase";

type Option = { id: string; name: string };
type Project = Option;
type Site = Option & { project_id: string };
type Vendor = Option;
type Bill = { id: string; project_id: string | null; site_id: string | null; vendor_id: string | null; bill_number: string; bill_date: string; previous_amount: number | string; current_amount: number | string; deductions: number | string; tax_amount: number | string; net_payable: number | string; status: string; ledger_transaction_id: string | null; created_at: string };
type Invoice = { id: string; vendor_id: string; project_id: string | null; transaction_date: string; reference_number: string | null; description: string | null; amount: number | string; due_date: string | null };
type InvoiceBalance = { invoice_id: string; vendor_id: string; invoice_amount: number | string; paid_amount: number | string; outstanding_amount: number | string };
type BoqItem = { id: string; boq_id: string; project_id: string | null; item_number: string | null; description: string; unit: string | null; quantity: number | string | null; rate: number | string | null; source_ref: string | null };
type MeasurementEntry = { id: string; measurement_book_id: string; project_id: string | null; boq_item_id: string | null; item_number: string | null; description: string | null; quantity: number | string; unit: string | null; source_ref: string | null };
type Source = { key: string; label: string; boqItemId: string | null; measurementEntryId: string | null; itemNumber: string | null; description: string; quantity: number | null; rate: number | null; sourceRef: string | null };
type BillLine = { source: Source | null; description: string; quantity: string; rate: string; itemNumber: string; sourceRef: string };
const emptyLine = (): BillLine => ({ source: null, description: "", quantity: "", rate: "", itemNumber: "", sourceRef: "" });

export default function InvoicesPage() {
  const { organization } = useWorkspace();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [balances, setBalances] = useState<InvoiceBalance[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [measurements, setMeasurements] = useState<MeasurementEntry[]>([]);
  const [billProjectId, setBillProjectId] = useState("");
  const [billSiteId, setBillSiteId] = useState("");
  const [billVendorId, setBillVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [previousAmount, setPreviousAmount] = useState("0");
  const [deductions, setDeductions] = useState("0");
  const [taxAmount, setTaxAmount] = useState("0");
  const [billLines, setBillLines] = useState<BillLine[]>([emptyLine()]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const canWrite = canPostFinancialRecords(organization?.role);
  const canApprove = ["owner", "accountant", "project_manager"].includes(organization?.role || "");

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [p, s, v, b, billLinks, t, ib, q, m] = await Promise.all([
      supabase.from("projects").select("id, name").eq("organization_id", organization.id).neq("status", "archived").order("name"),
      supabase.from("project_sites").select("id, name, project_id").eq("organization_id", organization.id).order("name"),
      supabase.from("vendors").select("id, name").eq("organization_id", organization.id).eq("is_archived", false).order("name"),
      supabase.from("contractor_bills").select("id, project_id, site_id, vendor_id, bill_number, bill_date, previous_amount, current_amount, deductions, tax_amount, net_payable, status, created_at").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(1000),
      supabase.from("contractor_bill_ledger_links").select("contractor_bill_id, transaction_id").eq("organization_id", organization.id),
      supabase.from("vendor_transactions").select("id, vendor_id, project_id, transaction_date, reference_number, description, amount, due_date").eq("organization_id", organization.id).eq("transaction_type", "invoice").eq("status", "posted").order("transaction_date", { ascending: false }).limit(1500),
      supabase.rpc("get_invoice_balances", { p_organization_id: organization.id }),
      supabase.from("boq_items").select("id, boq_id, item_number, description, unit, quantity, rate, source_ref, boq:boqs!inner(id, project_id, status)").eq("organization_id", organization.id).eq("boq.status", "approved"),
      supabase.from("measurement_entries").select("id, measurement_book_id, boq_item_id, item_number, description, quantity, unit, source_ref, book:measurement_books!inner(id, project_id, status)").eq("organization_id", organization.id).eq("book.status", "approved"),
    ]);
    const loadError = p.error || s.error || v.error || b.error || billLinks.error || t.error || ib.error || q.error || m.error;
    setError(loadError ? "Could not load invoice and contractor bill records. Confirm the workflow migrations: " + loadError.message : "");
    const linkedTransactions = new Map((billLinks.data ?? []).map((row) => [row.contractor_bill_id, row.transaction_id]));
    setProjects((p.data ?? []) as Project[]); setSites((s.data ?? []) as Site[]); setVendors((v.data ?? []) as Vendor[]); setBills(((b.data ?? []) as Omit<Bill, "ledger_transaction_id">[]).map((row) => ({ ...row, ledger_transaction_id: linkedTransactions.get(row.id) ?? null })));
    setInvoices((t.data ?? []) as Invoice[]); setBalances((ib.data ?? []) as InvoiceBalance[]);
    const boqRows = (q.data ?? []) as unknown as Array<BoqItem & { boq: { project_id: string | null } | Array<{ project_id: string | null }> }>;
    const measurementRows = (m.data ?? []) as unknown as Array<MeasurementEntry & { book: { project_id: string | null } | Array<{ project_id: string | null }> }>;
    setBoqItems(boqRows.map((row) => ({ ...row, project_id: Array.isArray(row.boq) ? row.boq[0]?.project_id ?? null : row.boq?.project_id ?? null })));
    setMeasurements(measurementRows.map((row) => ({ ...row, project_id: Array.isArray(row.book) ? row.book[0]?.project_id ?? null : row.book?.project_id ?? null })));
    setLoading(false);
  }, [organization]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);
  const vendorName = (id: string | null) => vendors.find((row) => row.id === id)?.name || "—";
  const projectName = (id: string | null) => projects.find((row) => row.id === id)?.name || "—";
  const billSites = sites.filter((site) => !billProjectId || site.project_id === billProjectId);
  const invoiceBalances = new Map(balances.map((row) => [row.invoice_id, row]));
  const visibleInvoices = invoices.filter((row) => [vendorName(row.vendor_id), row.reference_number, row.description].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const visibleBills = bills.filter((row) => [row.bill_number, vendorName(row.vendor_id), projectName(row.project_id), row.status].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const totalOutstanding = balances.reduce((sum, row) => sum + Number(row.outstanding_amount), 0);
  const pendingBillsAmount = bills.filter((row) => row.status !== "rejected").reduce((sum, row) => sum + Number(row.net_payable), 0);

  const sources = useMemo(() => {
    const projectBoqItems = boqItems.filter((item) => !billProjectId || item.project_id === billProjectId);
    const projectMeasurements = measurements.filter((entry) => !billProjectId || entry.project_id === billProjectId);
    const boq: Source[] = projectBoqItems.map((item) => ({ key: "boq/" + item.id, label: `BOQ ${item.item_number || ""} · ${item.description}`.slice(0, 110), boqItemId: item.id, measurementEntryId: null, itemNumber: item.item_number, description: item.description, quantity: item.quantity === null ? null : Number(item.quantity), rate: item.rate === null ? null : Number(item.rate), sourceRef: item.source_ref }));
    const measured: Source[] = projectMeasurements.map((entry) => {
      const linked = boqItems.find((item) => item.id === entry.boq_item_id);
      return { key: "measurement/" + entry.id, label: `MB ${entry.item_number || ""} · ${entry.description || linked?.description || "Measurement"}`.slice(0, 110), boqItemId: entry.boq_item_id, measurementEntryId: entry.id, itemNumber: entry.item_number || linked?.item_number || null, description: entry.description || linked?.description || "", quantity: Number(entry.quantity), rate: linked?.rate === null || linked?.rate === undefined ? null : Number(linked.rate), sourceRef: entry.source_ref };
    });
    return [...boq, ...measured];
  }, [boqItems, measurements, billProjectId]);

  function selectSource(index: number, key: string) {
    const source = sources.find((item) => item.key === key) ?? null;
    setBillLines((current) => current.map((line, lineIndex) => lineIndex === index && source ? { ...line, source, description: source.description, itemNumber: source.itemNumber || "", quantity: source.quantity === null ? line.quantity : String(source.quantity), rate: source.rate === null ? line.rate : String(source.rate), sourceRef: source.sourceRef || "" } : lineIndex === index ? { ...line, source: null } : line));
  }

  const billCurrentAmount = billLines.reduce((sum, line) => sum + Math.round((Number(line.quantity || 0) * Number(line.rate || 0) + Number.EPSILON) * 100) / 100, 0);
  const billNetAmount = Number(previousAmount || 0) + billCurrentAmount - Number(deductions || 0) + Number(taxAmount || 0);

  async function saveBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!organization || !billNumber.trim() || !billVendorId) { setError("Add a bill number and select the contractor vendor."); return; }
    if (billLines.some((line) => !line.description.trim() || !line.source || Number(line.quantity) <= 0 || Number(line.rate) < 0)) { setError("Each bill line needs a reviewed source, description, positive quantity, and non-negative rate."); return; }
    setBusy(true); setError(""); setNotice("");
    const items = billLines.map((line) => ({ boqItemId: line.source?.boqItemId, measurementEntryId: line.source?.measurementEntryId, itemNumber: line.itemNumber || null, description: line.description.trim(), quantity: Number(line.quantity), rate: Number(line.rate), sourceRef: line.sourceRef || line.source?.sourceRef || null }));
    const { error: saveError } = await supabase.rpc("save_contractor_bill_review", { p_organization_id: organization.id, p_project_id: billProjectId || null, p_site_id: billSiteId || null, p_vendor_id: billVendorId || null, p_bill_number: billNumber.trim(), p_bill_date: billDate, p_previous_amount: Number(previousAmount || 0), p_deductions: Number(deductions || 0), p_tax_amount: Number(taxAmount || 0), p_items: items });
    setBusy(false);
    if (saveError) setError("Bill draft was not saved: " + saveError.message);
    else { setNotice("Contractor bill saved as a draft; its line values were calculated from reviewed quantities and rates."); setBillNumber(""); setBillLines([emptyLine()]); setBillSiteId(""); setPreviousAmount("0"); setDeductions("0"); setTaxAmount("0"); await loadData(); }
  }

  async function approveBill(bill: Bill) {
    if (!organization) return; setBusy(true); setError("");
    const { error: approveError } = await supabase.rpc("approve_contractor_bill", { p_organization_id: organization.id, p_bill_id: bill.id });
    setBusy(false);
    if (approveError) setError("Bill approval failed: " + approveError.message); else { setNotice("Contractor bill approved. An owner or accountant can now post its payable to the vendor ledger."); await loadData(); }
  }

  async function postPayable(bill: Bill) {
    if (!organization) return; setBusy(true); setError("");
    const { error: postError } = await supabase.rpc("post_contractor_bill_to_ledger", { p_organization_id: organization.id, p_bill_id: bill.id });
    setBusy(false);
    if (postError) setError("Could not post contractor payable: " + postError.message); else { setNotice("Approved contractor bill posted once to the vendor payable ledger. Record its payment in Transactions."); await loadData(); }
  }

  function exportInvoices() { downloadCsv("leadercon-invoice-register.csv", [["Date", "Vendor", "Reference", "Project", "Invoice INR", "Paid INR", "Outstanding INR", "Due date"], ...invoices.map((row) => { const balance = invoiceBalances.get(row.id); return [row.transaction_date, vendorName(row.vendor_id), row.reference_number, projectName(row.project_id), row.amount, balance?.paid_amount, balance?.outstanding_amount, row.due_date]; })]); }

  return <div>
    <div className="page-heading"><div><p className="eyebrow">Accounts · Payables</p><h1>Invoices & Contractor Bills</h1><p>Track posted supplier invoices and review contractor claims against approved BOQ and Measurement Book quantities.</p></div><div className="page-heading-actions"><button className="button button-secondary" onClick={exportInvoices} disabled={!invoices.length}>Export invoices</button><Link href="/transactions?type=invoice" className="button button-primary">Record supplier invoice</Link></div></div>
    {notice && <p className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</p>}{error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
    <div className="metrics-grid" style={{ marginBottom: 14 }}><div className="metric-card"><div className="metric-top">Open supplier invoices <span>▤</span></div><div className="metric-value" style={{ fontSize: 21 }}>{formatINR(totalOutstanding)}</div><div className="metric-foot">Database-calculated outstanding</div></div><div className="metric-card"><div className="metric-top">Contractor bill register <span>◈</span></div><div className="metric-value">{bills.length}</div><div className="metric-foot">Draft through approved records</div></div><div className="metric-card"><div className="metric-top">Recorded bill value <span>₹</span></div><div className="metric-value" style={{ fontSize: 21 }}>{formatINR(pendingBillsAmount)}</div><div className="metric-foot">Net amount before rejection</div></div></div>
    <div className="toolbar"><input className="input" placeholder="Search invoice, bill, vendor or project" aria-label="Search invoices and bills" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className="content-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
      <section className="panel"><div className="panel-header"><div><h2>Supplier invoice register</h2><p>Outstanding values are calculated from posted payment allocations.</p></div><span className="chip">{visibleInvoices.length} invoices</span></div>
        {loading ? <div className="loading-card"><span className="spinner" /> Loading invoices…</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Date / reference</th><th>Vendor / project</th><th className="numeric">Invoice</th><th className="numeric">Paid</th><th className="numeric">Outstanding</th><th>Due</th><th>Status</th></tr></thead><tbody>{visibleInvoices.map((invoice) => { const balance = invoiceBalances.get(invoice.id); const outstanding = Number(balance?.outstanding_amount ?? invoice.amount); const overdue = Boolean(invoice.due_date && invoice.due_date < new Date().toISOString().slice(0, 10) && outstanding > 0); return <tr key={invoice.id}><td><strong>{invoice.reference_number || "Invoice"}</strong><div className="source-ref">{formatDate(invoice.transaction_date)}</div></td><td>{vendorName(invoice.vendor_id)}<div className="source-ref">{projectName(invoice.project_id)}</div></td><td className="numeric">{formatINR(invoice.amount)}</td><td className="numeric">{formatINR(balance?.paid_amount)}</td><td className="numeric">{formatINR(balance?.outstanding_amount)}</td><td>{formatDate(invoice.due_date)}</td><td><span className={"chip " + (outstanding <= 0 ? "chip-success" : overdue ? "chip-danger" : "chip-warning")}>{outstanding <= 0 ? "paid" : overdue ? "overdue" : "open"}</span></td></tr>; })}{!visibleInvoices.length && <tr><td colSpan={7} className="table-empty">{invoices.length ? "No invoices match your search." : "No supplier invoices posted yet."}</td></tr>}</tbody></table></div>}
      </section>
      <section className="panel"><div className="panel-header"><div><h2>Contractor bills</h2><p>Approval is separate from posting the payable. A bill can be linked to the ledger only once.</p></div><span className="chip">{visibleBills.length} bills</span></div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Bill</th><th>Vendor / project</th><th className="numeric">Current work</th><th className="numeric">Net payable</th><th>Status / ledger</th><th>Actions</th></tr></thead><tbody>{visibleBills.map((bill) => <tr key={bill.id}><td><strong>{bill.bill_number}</strong><div className="source-ref">{formatDate(bill.bill_date)}</div></td><td>{vendorName(bill.vendor_id)}<div className="source-ref">{projectName(bill.project_id)}</div></td><td className="numeric">{formatINR(bill.current_amount)}</td><td className="numeric">{formatINR(bill.net_payable)}</td><td><span className={"chip " + (bill.status === "approved" ? "chip-success" : "chip-warning")}>{bill.status}</span><div className="source-ref">{bill.ledger_transaction_id ? "Payable posted" : "Not in ledger"}</div></td><td>{canApprove && ["draft", "review"].includes(bill.status) && <button className="text-button" disabled={busy} onClick={() => void approveBill(bill)}>Approve</button>}{canWrite && bill.status === "approved" && !bill.ledger_transaction_id && <button className="text-button" disabled={busy} onClick={() => void postPayable(bill)}>Post payable</button>}{bill.ledger_transaction_id && <span className="source-ref">Linked</span>}</td></tr>)}{!visibleBills.length && <tr><td colSpan={6} className="table-empty">{bills.length ? "No bills match your search." : "No contractor bills yet."}</td></tr>}</tbody></table></div>
      </section>
    </div>
    {canWrite && <section className="panel" style={{ marginTop: 16 }}><div className="panel-header"><div><h2>Review a contractor bill draft</h2><p>Use approved BOQ or Measurement Book lines. Save, approve, then post a linked payable when ready.</p></div><span className="chip">Deterministic line totals</span></div>
      <form onSubmit={saveBill} className="panel-body stack">
        <div className="field-grid field-grid-3"><label className="field">Bill number<input className="input" required maxLength={100} value={billNumber} onChange={(event) => setBillNumber(event.target.value)} /></label><label className="field">Bill date<input className="input" type="date" required value={billDate} onChange={(event) => setBillDate(event.target.value)} /></label><label className="field">Vendor<select className="select" required value={billVendorId} onChange={(event) => setBillVendorId(event.target.value)}><option value="">Select contractor</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label><label className="field">Project<select className="select" value={billProjectId} onChange={(event) => { setBillProjectId(event.target.value); setBillSiteId(""); }}><option value="">Not linked</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="field">Site<select className="select" value={billSiteId} onChange={(event) => setBillSiteId(event.target.value)}><option value="">Not linked</option>{billSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label></div>
        {billLines.map((line, index) => <div className="field-grid" key={index} style={{ alignItems: "end", padding: 12, border: "1px solid var(--line)", borderRadius: 10 }}>
          <label className="field field-span-2">Approved source<select className="select" value={line.source?.key || ""} onChange={(event) => selectSource(index, event.target.value)}><option value="">Choose approved BOQ or MB line</option>{sources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}</select></label>
          <label className="field">Item number<input className="input" value={line.itemNumber} onChange={(event) => setBillLines((rows) => rows.map((row, i) => i === index ? { ...row, itemNumber: event.target.value } : row))} /></label>
          <label className="field field-span-2">Description<input className="input" required value={line.description} onChange={(event) => setBillLines((rows) => rows.map((row, i) => i === index ? { ...row, description: event.target.value } : row))} /></label>
          <label className="field">Quantity<input className="input" required type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => setBillLines((rows) => rows.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row))} /></label>
          <label className="field">Rate (INR)<input className="input" required type="number" min="0" step="0.01" value={line.rate} onChange={(event) => setBillLines((rows) => rows.map((row, i) => i === index ? { ...row, rate: event.target.value } : row))} /></label>
          <label className="field">Source page / row<input className="input" value={line.sourceRef} onChange={(event) => setBillLines((rows) => rows.map((row, i) => i === index ? { ...row, sourceRef: event.target.value } : row))} /></label>
          <div className="field"><span className="field-label">Line amount</span><strong>{formatINR(Number(line.quantity || 0) * Number(line.rate || 0))}</strong></div>
          <button type="button" className="text-button" onClick={() => setBillLines((rows) => rows.filter((_, i) => i !== index))} disabled={billLines.length <= 1}>Remove line</button>
        </div>)}
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setBillLines((rows) => [...rows, emptyLine()])}>＋ Add bill line</button><span className="chip">Current work {formatINR(billCurrentAmount)}</span></div>
        <div className="field-grid field-grid-3"><label className="field">Previous amount (INR)<input className="input" type="number" min="0" step="0.01" value={previousAmount} onChange={(event) => setPreviousAmount(event.target.value)} /></label><label className="field">Deductions (INR)<input className="input" type="number" min="0" step="0.01" value={deductions} onChange={(event) => setDeductions(event.target.value)} /></label><label className="field">Tax amount (INR)<input className="input" type="number" min="0" step="0.01" value={taxAmount} onChange={(event) => setTaxAmount(event.target.value)} /></label></div>
        <div className="pagination-row"><span>Net = previous + current − deductions + tax</span><strong>{formatINR(billNetAmount)}</strong></div>
        <button className="button button-primary" disabled={busy || !sources.length}>{busy ? "Saving…" : "Save bill review draft"}</button>
      </form>
    </section>}
  </div>;
}
