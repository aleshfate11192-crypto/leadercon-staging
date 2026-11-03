"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/components/workspace-provider";
import { formatDate, formatINR } from "@/lib/financials";
import { supabase } from "@/lib/supabase";

type VendorBalance = { vendor_id: string; vendor_name: string; outstanding_balance: number | string };
type InvoiceBalance = { invoice_id: string; vendor_id: string; invoice_amount: number | string; outstanding_amount: number | string };
type Transaction = { id: string; vendor_id: string; transaction_type: string; transaction_date: string; reference_number: string | null; amount: number | string; status: string; due_date: string | null; description: string | null };
type Project = { id: string; name: string; project_code: string | null; status: string; budget: number | string; contract_value: number | string };

export default function DashboardPage() {
  const { organization } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vendorBalances, setVendorBalances] = useState<VendorBalance[]>([]);
  const [invoiceBalances, setInvoiceBalances] = useState<InvoiceBalance[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pendingReviews, setPendingReviews] = useState(0);

  const loadDashboard = useCallback(async () => {
    if (!organization) return;
    setError("");
    const [vendorResult, invoiceResult, transactionResult, projectResult, boqResult, mbResult, documentResult] = await Promise.all([
      supabase.rpc("get_vendor_balances", { p_organization_id: organization.id }),
      supabase.rpc("get_invoice_balances", { p_organization_id: organization.id }),
      supabase.from("vendor_transactions").select("id, vendor_id, transaction_type, transaction_date, reference_number, amount, status, due_date, description").eq("organization_id", organization.id).order("transaction_date", { ascending: false }).limit(300),
      supabase.from("projects").select("id, name, project_code, status, budget, contract_value").eq("organization_id", organization.id).neq("status", "archived").order("created_at", { ascending: false }).limit(100),
      supabase.from("boqs").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).in("status", ["draft", "review"]),
      supabase.from("measurement_books").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).in("status", ["draft", "review"]),
      supabase.from("documents").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).eq("status", "review"),
    ]);
    const firstError = vendorResult.error || invoiceResult.error || transactionResult.error || projectResult.error;
    if (firstError) setError("Some dashboard records could not be loaded. Check the LeaderCon migrations and workspace policies: " + firstError.message);
    setVendorBalances((vendorResult.data ?? []) as VendorBalance[]);
    setInvoiceBalances((invoiceResult.data ?? []) as InvoiceBalance[]);
    setTransactions((transactionResult.data ?? []) as Transaction[]);
    setProjects((projectResult.data ?? []) as Project[]);
    setPendingReviews((boqResult.count ?? 0) + (mbResult.count ?? 0) + (documentResult.count ?? 0));
    setLoading(false);
  }, [organization]);

  useEffect(() => { const timer = window.setTimeout(() => void loadDashboard(), 0); return () => window.clearTimeout(timer); }, [loadDashboard]);

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const totalOutstanding = vendorBalances.reduce((sum, item) => sum + Number(item.outstanding_balance || 0), 0);
  const totalInvoiceValue = invoiceBalances.reduce((sum, item) => sum + Number(item.invoice_amount || 0), 0);
  const openInvoiceValue = invoiceBalances.reduce((sum, item) => sum + Number(item.outstanding_amount || 0), 0);
  const overdueCount = transactions.filter((item) => item.transaction_type === "invoice" && item.status === "posted" && item.due_date && item.due_date < todayKey && invoiceBalances.some((balance) => balance.invoice_id === item.id && Number(balance.outstanding_amount) > 0)).length;
  const paidThisMonth = transactions.filter((item) => item.transaction_type === "payment" && item.status === "posted" && item.transaction_date >= monthStart).reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0);
  const recentTransactions = transactions.slice(0, 6);
  const vendorName = new Map(vendorBalances.map((item) => [item.vendor_id, item.vendor_name]));

  const briefing = [
    overdueCount ? overdueCount + " overdue invoice(s) still have an unpaid balance." : "No overdue invoices with an open balance were found.",
    pendingReviews ? pendingReviews + " BOQ, measurement, or document review(s) are waiting." : "No BOQ, measurement, or document reviews are waiting.",
    projects.filter((project) => project.status === "active").length + " active project(s) are in this workspace.",
  ];

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">Accounts overview</p><h1>Good day</h1><p>Here is the current activity for {organization?.name || "your workspace"}.</p></div>
        <div className="page-heading-actions"><button className="button button-secondary" onClick={() => void loadDashboard()}>↻ Refresh</button><Link href="/transactions" className="button button-primary">＋ New transaction</Link></div>
      </div>

      {error && <p className="alert alert-error" role="alert" style={{ marginBottom: 14 }}>{error}</p>}
      <section className="dashboard-banner">
        <div><h2>Today’s accounts briefing</h2><p>Summary from posted ledger entries and records in your workspace. Draft entries are excluded from balances.</p></div>
        <Link className="button button-secondary" href="/notifications">View follow-ups</Link>
      </section>

      {loading ? <div className="loading-card"><span className="spinner" /> Calculating workspace summary…</div> : <>
        <div className="metrics-grid">
          <div className="metric-card"><div className="metric-top"><span>Vendor outstanding</span><span className="metric-icon">₹</span></div><p className="metric-value">{formatINR(totalOutstanding)}</p><span className="metric-note">Opening balances plus posted ledger</span></div>
          <div className="metric-card"><div className="metric-top"><span>Open invoices</span><span className="metric-icon">▤</span></div><p className="metric-value">{formatINR(openInvoiceValue)}</p><span className="metric-note">{invoiceBalances.filter((item) => Number(item.outstanding_amount) > 0).length} invoice(s) with balance</span></div>
          <div className="metric-card"><div className="metric-top"><span>Payments this month</span><span className="metric-icon">↗</span></div><p className="metric-value">{formatINR(paidThisMonth)}</p><span className="metric-note">Posted payments from {formatDate(monthStart)}</span></div>
          <div className="metric-card"><div className="metric-top"><span>Overdue invoices</span><span className="metric-icon">◷</span></div><p className="metric-value">{overdueCount}</p><span className="metric-note">Require a payment follow-up</span></div>
        </div>

        <div className="content-grid">
          <div className="stack">
            <section className="panel">
              <div className="panel-header"><div><h2>Recent ledger activity</h2><p>Latest vendor invoices, payments, and adjustments.</p></div><Link href="/transactions" className="text-button">Open ledger →</Link></div>
              <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Vendor</th><th>Type</th><th>Reference</th><th className="numeric">Amount</th><th>Status</th></tr></thead><tbody>
                {recentTransactions.map((item) => <tr key={item.id}><td>{formatDate(item.transaction_date)}</td><td className="primary-cell">{vendorName.get(item.vendor_id) || "Vendor"}</td><td style={{ textTransform: "capitalize" }}>{item.transaction_type?.replaceAll("_", " ")}</td><td>{item.reference_number || "—"}</td><td className="numeric">{formatINR(item.amount)}</td><td><span className={"chip " + (item.status === "posted" ? "chip-success" : "chip-warning")}>{item.status}</span></td></tr>)}
                {!recentTransactions.length && <tr><td className="table-empty" colSpan={6}>No transactions recorded in this workspace yet.</td></tr>}
              </tbody></table></div>
              <div className="summary-strip"><span>Posted invoices: <strong>{formatINR(totalInvoiceValue)}</strong></span><span>·</span><span>Open invoice value: <strong>{formatINR(openInvoiceValue)}</strong></span></div>
            </section>
            <section className="panel">
              <div className="panel-header"><div><h2>Projects & sites</h2><p>Current construction work and contract budgets.</p></div><Link href="/projects" className="text-button">Manage projects →</Link></div>
              <div className="table-wrap"><table className="data-table"><thead><tr><th>Project</th><th>Status</th><th className="numeric">Budget</th><th className="numeric">Contract value</th></tr></thead><tbody>
                {projects.slice(0, 5).map((project) => <tr key={project.id}><td className="primary-cell">{project.name}<div className="source-ref">{project.project_code || "No project code"}</div></td><td><span className="chip chip-neutral">{project.status.replaceAll("_", " ")}</span></td><td className="numeric">{formatINR(project.budget)}</td><td className="numeric">{formatINR(project.contract_value)}</td></tr>)}
                {!projects.length && <tr><td className="table-empty" colSpan={4}>No projects recorded yet.</td></tr>}
              </tbody></table></div>
            </section>
          </div>
          <div className="stack">
            <section className="panel"><div className="panel-header"><div><h2>Daily briefing</h2><p>Follow-ups derived from current records.</p></div><span className="chip chip-warning">{overdueCount + pendingReviews} items</span></div><div className="panel-body briefing-list">{briefing.map((item, index) => <div className="briefing-item" key={index}><span className="briefing-dot" />{item}</div>)}</div></section>
            <section className="panel"><div className="panel-header"><div><h2>Quick actions</h2><p>Continue a common workflow.</p></div></div><div className="panel-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
              <Link className="quick-link" href="/vendors"><span className="quick-link-icon">♙</span>Add or review vendors<span>→</span></Link>
              <Link className="quick-link" href="/transactions"><span className="quick-link-icon">↕</span>Record invoice or payment<span>→</span></Link>
              <Link className="quick-link" href="/boq"><span className="quick-link-icon">◈</span>Review a BOQ<span>→</span></Link>
              <Link className="quick-link" href="/measurements"><span className="quick-link-icon">⌗</span>Enter site measurements<span>→</span></Link>
              <Link className="quick-link" href="/assistant"><span className="quick-link-icon">✦</span>Ask the accounts assistant<span>→</span></Link>
            </div></section>
          </div>
        </div>
      </>}
      <p className="credit-line">All amounts are calculated from records in this workspace. Drafts and void entries do not affect balances.</p>
    </div>
  );
}
