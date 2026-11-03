"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/components/workspace-provider";
import { formatDate, formatINR } from "@/lib/financials";
import { supabase } from "@/lib/supabase";

type Invoice = { id: string; vendor_id: string; transaction_date: string; reference_number: string | null; amount: number | string; due_date: string | null };
type Balance = { invoice_id: string; outstanding_amount: number | string };
type Review = { id: string; name?: string; number?: string; bill_number?: string; created_at: string; status: string };
type Procurement = { id: string; material_name: string; status: string; order_date: string };
type Option = { id: string; name: string };

export default function NotificationsPage() {
  const { organization } = useWorkspace();
  const [vendors, setVendors] = useState<Option[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [boqs, setBoqs] = useState<Review[]>([]);
  const [books, setBooks] = useState<Review[]>([]);
  const [bills, setBills] = useState<Review[]>([]);
  const [documents, setDocuments] = useState<Review[]>([]);
  const [procurement, setProcurement] = useState<Procurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [v, i, ib, b, m, cb, d, pr] = await Promise.all([
      supabase.from("vendors").select("id, name").eq("organization_id", organization.id).order("name"),
      supabase.from("vendor_transactions").select("id, vendor_id, transaction_date, reference_number, amount, due_date").eq("organization_id", organization.id).eq("transaction_type", "invoice").eq("status", "posted").order("due_date"),
      supabase.rpc("get_invoice_balances", { p_organization_id: organization.id }),
      supabase.from("boqs").select("id, name, created_at, status").eq("organization_id", organization.id).in("status", ["draft", "review"]).order("created_at"),
      supabase.from("measurement_books").select("id, number, created_at, status").eq("organization_id", organization.id).in("status", ["draft", "review"]).order("created_at"),
      supabase.from("contractor_bills").select("id, bill_number, created_at, status").eq("organization_id", organization.id).in("status", ["draft", "review"]).order("created_at"),
      supabase.from("documents").select("id, file_name, created_at, status").eq("organization_id", organization.id).eq("status", "review").order("created_at"),
      supabase.from("procurement_records").select("id, material_name, status, order_date").eq("organization_id", organization.id).in("status", ["ordered", "part_received"]).order("order_date"),
    ]);
    const loadError = v.error || i.error || ib.error || b.error || m.error || cb.error || d.error || pr.error;
    setError(loadError ? "Could not load follow-ups: " + loadError.message : "");
    setVendors((v.data ?? []) as Option[]); setInvoices((i.data ?? []) as Invoice[]); setBalances((ib.data ?? []) as Balance[]);
    setBoqs((b.data ?? []) as Review[]); setBooks((m.data ?? []) as Review[]); setBills((cb.data ?? []) as Review[]); setDocuments((d.data ?? []) as Review[]); setProcurement((pr.data ?? []) as Procurement[]); setLoading(false);
  }, [organization]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);
  const vendorName = (id: string) => vendors.find((vendor) => vendor.id === id)?.name || "Vendor";
  const balanceById = new Map(balances.map((row) => [row.invoice_id, Number(row.outstanding_amount)]));
  const today = new Date().toISOString().slice(0, 10);
  const sevenDayBoundary = new Date();
  sevenDayBoundary.setDate(sevenDayBoundary.getDate() + 7);
  const inSevenDays = sevenDayBoundary.toISOString().slice(0, 10);
  const openInvoices = invoices.filter((invoice) => (balanceById.get(invoice.id) ?? 0) > 0);
  const overdue = openInvoices.filter((invoice) => invoice.due_date && invoice.due_date < today);
  const dueSoon = openInvoices.filter((invoice) => invoice.due_date && invoice.due_date >= today && invoice.due_date <= inSevenDays);
  const reviewCount = boqs.length + books.length + bills.length + documents.length;

  return <div>
    <div className="page-heading"><div><p className="eyebrow">Insights · In-app follow-ups</p><h1>Notifications</h1><p>Follow-ups are generated from current workspace records. They update when those records change.</p></div><div className="page-heading-actions"><button className="button button-secondary" onClick={() => void loadData()}>↻ Refresh</button></div></div>
    {error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
    {loading ? <div className="loading-card"><span className="spinner" /> Checking workspace follow-ups…</div> : <>
      <div className="metrics-grid" style={{ marginBottom: 14 }}><div className="metric-card"><div className="metric-top">Overdue invoices <span>◷</span></div><div className="metric-value">{overdue.length}</div><div className="metric-foot">Open balance past due</div></div><div className="metric-card"><div className="metric-top">Due in 7 days <span>⌁</span></div><div className="metric-value">{dueSoon.length}</div><div className="metric-foot">Open posted invoices</div></div><div className="metric-card"><div className="metric-top">Review queue <span>◈</span></div><div className="metric-value">{reviewCount}</div><div className="metric-foot">BOQ, MB, bills, documents</div></div><div className="metric-card"><div className="metric-top">Deliveries in progress <span>⬡</span></div><div className="metric-value">{procurement.length}</div><div className="metric-foot">Ordered or partial receipt</div></div></div>
      <div className="content-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(280px, .8fr)", alignItems: "start" }}>
        <div className="stack">
          <section className="panel"><div className="panel-header"><div><h2>Overdue supplier invoices</h2><p>Only posted invoices with an open allocated balance.</p></div><Link href="/invoices" className="text-button">Open invoices →</Link></div><div className="panel-body data-list">{overdue.map((invoice) => <div className="data-list-row" key={invoice.id}><span><strong>{vendorName(invoice.vendor_id)} · {invoice.reference_number || "Invoice"}</strong><small>Due {formatDate(invoice.due_date)} · Invoice date {formatDate(invoice.transaction_date)}</small></span><span className="chip chip-danger">{formatINR(balanceById.get(invoice.id))}</span></div>)}{!overdue.length && <p className="muted">No overdue open invoices.</p>}</div></section>
          <section className="panel"><div className="panel-header"><div><h2>Due soon</h2><p>Invoices due by {formatDate(inSevenDays)} with a remaining balance.</p></div></div><div className="panel-body data-list">{dueSoon.map((invoice) => <div className="data-list-row" key={invoice.id}><span><strong>{vendorName(invoice.vendor_id)} · {invoice.reference_number || "Invoice"}</strong><small>Due {formatDate(invoice.due_date)}</small></span><span className="chip chip-warning">{formatINR(balanceById.get(invoice.id))}</span></div>)}{!dueSoon.length && <p className="muted">No invoices due in the next seven days.</p>}</div></section>
          <section className="panel"><div className="panel-header"><div><h2>Delivery follow-up</h2><p>Procurement marked ordered or partly received.</p></div><Link href="/materials" className="text-button">Open procurement →</Link></div><div className="panel-body data-list">{procurement.map((row) => <div className="data-list-row" key={row.id}><span><strong>{row.material_name}</strong><small>{row.status.replaceAll("_", " ")} · Ordered {formatDate(row.order_date)}</small></span><span className="chip chip-neutral">{row.status === "ordered" ? "In transit" : "Partial"}</span></div>)}{!procurement.length && <p className="muted">No deliveries are currently marked in progress.</p>}</div></section>
        </div>
        <section className="panel"><div className="panel-header"><div><h2>Approval queue</h2><p>Draft and review records awaiting a decision.</p></div></div><div className="panel-body data-list">
          {boqs.map((row) => <Link className="data-list-row" href="/boq" key={row.id}><span><strong>BOQ · {row.name}</strong><small>{row.status} · {formatDate(row.created_at.slice(0, 10))}</small></span><span className="chip chip-warning">Review</span></Link>)}
          {books.map((row) => <Link className="data-list-row" href="/measurements" key={row.id}><span><strong>Measurement Book · {row.number}</strong><small>{row.status} · {formatDate(row.created_at.slice(0, 10))}</small></span><span className="chip chip-warning">Review</span></Link>)}
          {bills.map((row) => <Link className="data-list-row" href="/invoices" key={row.id}><span><strong>Contractor bill · {row.bill_number}</strong><small>{row.status} · {formatDate(row.created_at.slice(0, 10))}</small></span><span className="chip chip-warning">Review</span></Link>)}
          {documents.map((row) => <Link className="data-list-row" href="/documents" key={row.id}><span><strong>Document · {row.name}</strong><small>Uploaded {formatDate(row.created_at.slice(0, 10))}</small></span><span className="chip chip-warning">Review</span></Link>)}
          {!reviewCount && <p className="muted">Nothing is waiting in the review queue.</p>}
        </div></section>
      </div>
      <p className="credit-line">These are in-app reminders based on records. No emails, messages, or push notifications are sent.</p>
    </>}
  </div>;
}
