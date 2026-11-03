"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { downloadCsv, formatDate, formatINR } from "@/lib/financials";
import { supabase } from "@/lib/supabase";

type VendorBalance = { vendor_id: string; vendor_name: string; opening_balance: number | string; ledger_total: number | string; outstanding_balance: number | string };
type InvoiceBalance = { invoice_id: string; vendor_id: string; invoice_amount: number | string; paid_amount: number | string; outstanding_amount: number | string };
type Transaction = { id: string; vendor_id: string; project_id: string | null; transaction_type: string; transaction_date: string; reference_number: string | null; amount: number | string; due_date: string | null; status: string };
type Project = { id: string; name: string; project_code: string | null; status: string; budget: number | string; contract_value: number | string };
type Material = { id: string; project_id: string | null; material_name: string; quantity: number | string; unit: string | null; amount: number | string; order_date: string; status: string };
type Labour = { id: string; project_id: string | null; category: string; work_date: string; workers_count: number; days: number | string; amount: number | string; payment_status: string };

export default function ReportsPage() {
  const { organization } = useWorkspace();
  const [vendors, setVendors] = useState<VendorBalance[]>([]);
  const [invoices, setInvoices] = useState<InvoiceBalance[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [labour, setLabour] = useState<Labour[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [v, i, t, p, m, l] = await Promise.all([
      supabase.rpc("get_vendor_balances", { p_organization_id: organization.id }),
      supabase.rpc("get_invoice_balances", { p_organization_id: organization.id }),
      supabase.from("vendor_transactions").select("id, vendor_id, project_id, transaction_type, transaction_date, reference_number, amount, due_date, status").eq("organization_id", organization.id).order("transaction_date", { ascending: false }).limit(3000),
      supabase.from("projects").select("id, name, project_code, status, budget, contract_value").eq("organization_id", organization.id).order("name"),
      supabase.from("procurement_records").select("id, project_id, material_name, quantity, unit, amount, order_date, status").eq("organization_id", organization.id).neq("status", "cancelled").order("order_date", { ascending: false }).limit(3000),
      supabase.from("labour_records").select("id, project_id, category, work_date, workers_count, days, amount, payment_status").eq("organization_id", organization.id).order("work_date", { ascending: false }).limit(3000),
    ]);
    const loadError = v.error || i.error || t.error || p.error || m.error || l.error;
    setError(loadError ? "Could not load report data: " + loadError.message : "");
    setVendors((v.data ?? []) as VendorBalance[]); setInvoices((i.data ?? []) as InvoiceBalance[]); setTransactions((t.data ?? []) as Transaction[]); setProjects((p.data ?? []) as Project[]); setMaterials((m.data ?? []) as Material[]); setLabour((l.data ?? []) as Labour[]); setLoading(false);
  }, [organization]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);

  const selectedProject = (id: string | null) => !id || projectFilter === "all" || projectFilter === id;
  const inRange = (date: string | null) => (!fromDate || (date || "") >= fromDate) && (!toDate || (date || "") <= toDate);
  const filteredTransactions = transactions.filter((row) => inRange(row.transaction_date) && selectedProject(row.project_id));
  const filteredMaterials = materials.filter((row) => inRange(row.order_date) && selectedProject(row.project_id));
  const filteredLabour = labour.filter((row) => inRange(row.work_date) && selectedProject(row.project_id));
  const filteredInvoices = invoices.filter((row) => filteredTransactions.some((transaction) => transaction.id === row.invoice_id));
  const vendorById = new Map(vendors.map((row) => [row.vendor_id, row.vendor_name]));
  const invoiceOutstanding = filteredInvoices.reduce((sum, row) => sum + Number(row.outstanding_amount), 0);
  const materialCost = filteredMaterials.reduce((sum, row) => sum + Number(row.amount), 0);
  const labourCost = filteredLabour.reduce((sum, row) => sum + Number(row.amount), 0);
  const projectRows = projects.filter((project) => projectFilter === "all" || project.id === projectFilter).map((project) => {
    const projectMaterials = filteredMaterials.filter((row) => row.project_id === project.id).reduce((sum, row) => sum + Number(row.amount), 0);
    const projectLabour = filteredLabour.filter((row) => row.project_id === project.id).reduce((sum, row) => sum + Number(row.amount), 0);
    const projectInvoices = filteredTransactions.filter((row) => row.project_id === project.id && row.transaction_type === "invoice" && row.status === "posted").reduce((sum, row) => sum + Number(row.amount), 0);
    return { ...project, projectMaterials, projectLabour, projectInvoices, totalTrackedCost: projectMaterials + projectLabour };
  });

  function exportTransactions() { downloadCsv("leadercon-financial-ledger-report.csv", [["Date", "Vendor", "Project", "Type", "Reference", "Amount INR", "Due date", "Status"], ...filteredTransactions.map((row) => [row.transaction_date, vendorById.get(row.vendor_id), projects.find((project) => project.id === row.project_id)?.name, row.transaction_type, row.reference_number, row.amount, row.due_date, row.status])]); }
  function exportProjects() { downloadCsv("leadercon-project-cost-report.csv", [["Project", "Code", "Status", "Budget INR", "Contract INR", "Supplier invoices INR", "Materials INR", "Labour INR", "Tracked materials + labour INR"], ...projectRows.map((row) => [row.name, row.project_code, row.status, row.budget, row.contract_value, row.projectInvoices, row.projectMaterials, row.projectLabour, row.totalTrackedCost])]); }
  function exportVendors() { downloadCsv("leadercon-vendor-balance-report.csv", [["Vendor", "Opening INR", "Posted ledger total INR", "Outstanding INR"], ...vendors.map((row) => [row.vendor_name, row.opening_balance, row.ledger_total, row.outstanding_balance])]); }

  return <div>
    <div className="page-heading"><div><p className="eyebrow">Insights · Financial reports</p><h1>Reports</h1><p>Review actual workspace balances, posted invoices, procurement, labour costs, and project budgets.</p></div><div className="page-heading-actions"><button className="button button-secondary" onClick={() => void loadData()}>↻ Refresh</button></div></div>
    {error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
    <section className="panel" style={{ marginBottom: 14 }}><div className="panel-header"><div><h2>Report scope</h2><p>Date and project filters apply to transaction, material, and labour activity.</p></div></div><div className="panel-body field-grid field-grid-3"><label className="field">From date<input className="input" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label className="field">To date<input className="input" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label><label className="field">Project<select className="select" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div></section>
    {loading ? <div className="loading-card"><span className="spinner" /> Compiling reports…</div> : <>
      <div className="metrics-grid" style={{ marginBottom: 14 }}><div className="metric-card"><div className="metric-top">Vendor outstanding <span>₹</span></div><div className="metric-value" style={{ fontSize: 22 }}>{formatINR(vendors.reduce((sum, row) => sum + Number(row.outstanding_balance), 0))}</div><div className="metric-foot">Full posted ledger, all dates</div></div><div className="metric-card"><div className="metric-top">Open invoice balances <span>▤</span></div><div className="metric-value" style={{ fontSize: 22 }}>{formatINR(invoiceOutstanding)}</div><div className="metric-foot">In filtered period / project</div></div><div className="metric-card"><div className="metric-top">Material orders <span>⬡</span></div><div className="metric-value" style={{ fontSize: 22 }}>{formatINR(materialCost)}</div><div className="metric-foot">Cancelled orders excluded</div></div><div className="metric-card"><div className="metric-top">Labour records <span>♧</span></div><div className="metric-value" style={{ fontSize: 22 }}>{formatINR(labourCost)}</div><div className="metric-foot">Attendance × days × rate</div></div></div>
      <div className="content-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <section className="panel"><div className="panel-header"><div><h2>Vendor balances</h2><p>Opening balance plus complete posted invoice, payment, credit, and adjustment ledger.</p></div><button className="button button-secondary" onClick={exportVendors}>Export balances</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Vendor</th><th className="numeric">Opening</th><th className="numeric">Ledger movement</th><th className="numeric">Outstanding</th></tr></thead><tbody>{vendors.map((row) => <tr key={row.vendor_id}><td><strong>{row.vendor_name}</strong></td><td className="numeric">{formatINR(row.opening_balance)}</td><td className="numeric">{formatINR(row.ledger_total)}</td><td className="numeric"><strong>{formatINR(row.outstanding_balance)}</strong></td></tr>)}{!vendors.length && <tr><td colSpan={4} className="table-empty">No vendor balances available.</td></tr>}</tbody></table></div></section>
        <section className="panel"><div className="panel-header"><div><h2>Project cost summary</h2><p>Tracked materials and labour are compared to the project budget. Supplier invoice values are shown separately.</p></div><button className="button button-secondary" onClick={exportProjects}>Export project report</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Project</th><th>Status</th><th className="numeric">Budget</th><th className="numeric">Invoices</th><th className="numeric">Materials</th><th className="numeric">Labour</th><th className="numeric">Tracked cost</th></tr></thead><tbody>{projectRows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><div className="source-ref">{row.project_code || "No code"}</div></td><td>{row.status.replaceAll("_", " ")}</td><td className="numeric">{formatINR(row.budget)}</td><td className="numeric">{formatINR(row.projectInvoices)}</td><td className="numeric">{formatINR(row.projectMaterials)}</td><td className="numeric">{formatINR(row.projectLabour)}</td><td className="numeric"><strong>{formatINR(row.totalTrackedCost)}</strong></td></tr>)}{!projectRows.length && <tr><td colSpan={7} className="table-empty">No project records available.</td></tr>}</tbody></table></div></section>
        <section className="panel"><div className="panel-header"><div><h2>Financial ledger activity</h2><p>{filteredTransactions.length} transactions in selected scope. Draft entries are shown and marked.</p></div><button className="button button-secondary" onClick={exportTransactions}>Export ledger</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Vendor / reference</th><th>Project</th><th>Type</th><th className="numeric">Amount</th><th>Due</th><th>Status</th></tr></thead><tbody>{filteredTransactions.slice(0, 1000).map((row) => <tr key={row.id}><td>{formatDate(row.transaction_date)}</td><td>{vendorById.get(row.vendor_id) || "Vendor"}<div className="source-ref">{row.reference_number || "—"}</div></td><td>{projects.find((project) => project.id === row.project_id)?.name || "—"}</td><td style={{ textTransform: "capitalize" }}>{row.transaction_type.replaceAll("_", " ")}</td><td className="numeric">{formatINR(row.amount)}</td><td>{formatDate(row.due_date)}</td><td><span className={"chip " + (row.status === "posted" ? "chip-success" : "chip-warning")}>{row.status}</span></td></tr>)}{!filteredTransactions.length && <tr><td colSpan={7} className="table-empty">No transactions in the selected scope.</td></tr>}</tbody></table></div></section>
      </div>
      <p className="credit-line">Invoices and open balances are scoped to posted entries. Tracked project cost shown here includes procurement and labour records; it is not a project profit calculation.</p>
    </>}
  </div>;
}
