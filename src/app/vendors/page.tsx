"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DocumentUpload from "@/components/document-upload";
import { useWorkspace } from "@/components/workspace-provider";
import { downloadCsv, formatDate, formatINR, type LedgerEntry, canPostFinancialRecords } from "@/lib/financials";
import { supabase } from "@/lib/supabase";

type Vendor = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  category: string | null;
  opening_balance: number | string | null;
  bank_account_holder?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
  bank_branch?: string | null;
  bank_account_type?: string | null;
  notes: string | null;
  created_at: string | null;
};

type Transaction = LedgerEntry & {
  id: string;
  vendor_id: string;
  transaction_type: string | null;
  transaction_date: string | null;
  reference_number: string | null;
  description: string | null;
  amount: number | string | null;
  status: string | null;
};
type VendorBalance = { vendor_id: string; outstanding_balance: number | string };
type VendorBankDetails = Pick<Vendor, "bank_account_holder" | "bank_name" | "bank_account_number" | "bank_ifsc" | "bank_branch" | "bank_account_type">;

const LEGACY_KEY = "sumanik-vendors-prototype";
const BACKUP_KEY = "sumanik-vendors-prototype-migrated-backup";
const categories = ["Materials", "Transportation", "Machinery Rental", "Fuel", "Labour", "Services", "Other"];
const emptyForm = {
  name: "", contact_person: "", phone: "", email: "", address: "", category: "Materials",
  opening_balance: "0", bank_account_holder: "", bank_name: "", bank_account_number: "",
  bank_ifsc: "", bank_branch: "", bank_account_type: "", notes: "",
};

function transactionLabel(type: string | null) {
  return (type || "transaction").replaceAll("_", " ");
}

export default function VendorsPage() {
  const { organization, user } = useWorkspace();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [vendorBalances, setVendorBalances] = useState<VendorBalance[]>([]);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [selected, setSelected] = useState<Vendor | null>(null);
  const [bankDetails, setBankDetails] = useState<VendorBankDetails | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [legacyCount, setLegacyCount] = useState(0);
  const [importing, setImporting] = useState(false);

  const canEdit = canPostFinancialRecords(organization?.role);
  const canSeeBank = canEdit;

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [vendorResult, transactionResult, balanceResult] = await Promise.all([
      supabase.from("vendors").select("id, organization_id, created_by, name, contact_person, phone, email, address, category, opening_balance, notes, is_archived, created_at").eq("organization_id", organization.id).eq("is_archived", false).order("created_at", { ascending: false }),
      supabase.from("vendor_transactions").select("id, vendor_id, transaction_type, transaction_date, reference_number, description, amount, status").eq("organization_id", organization.id).eq("status", "posted").order("transaction_date", { ascending: false }).limit(1500),
      supabase.rpc("get_vendor_balances", { p_organization_id: organization.id }),
    ]);

    if (vendorResult.error) {
      setError("Could not load vendors. Check your Supabase schema and row-level security: " + vendorResult.error.message);
      setReady(true);
      return;
    }
    if (transactionResult.error) {
      setError("Could not load the vendor ledger. Apply the LeaderCon foundation migration: " + transactionResult.error.message);
      setReady(true);
      return;
    }
    if (balanceResult.error) {
      setError("Could not calculate official vendor balances. Apply the deterministic balance migration: " + balanceResult.error.message);
      setReady(true);
      return;
    }
    setVendors((vendorResult.data ?? []) as Vendor[]);
    setTransactions((transactionResult.data ?? []) as Transaction[]);
    setVendorBalances((balanceResult.data ?? []) as VendorBalance[]);
    setReady(true);
  }, [organization]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
      try {
        const raw = window.localStorage.getItem(LEGACY_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        setLegacyCount(Array.isArray(parsed) ? parsed.length : 0);
      } catch {
        setNotice("A legacy browser vendor backup exists but could not be read. The data was left untouched.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const visibleVendors = useMemo(() => {
    const term = search.trim().toLowerCase();
    return vendors.filter((vendor) => {
      const text = [vendor.name, vendor.contact_person, vendor.phone, vendor.email, vendor.address, vendor.category].join(" ").toLowerCase();
      return text.includes(term) && (categoryFilter === "All" || vendor.category === categoryFilter);
    });
  }, [vendors, search, categoryFilter]);

  const ledgerByVendor = useMemo(() => {
    const grouped = new Map<string, Transaction[]>();
    for (const entry of transactions) {
      const current = grouped.get(entry.vendor_id) ?? [];
      current.push(entry);
      grouped.set(entry.vendor_id, current);
    }
    return grouped;
  }, [transactions]);

  const balanceByVendor = new Map(vendorBalances.map((row) => [row.vendor_id, Number(row.outstanding_balance)]));
  const totalOutstanding = vendorBalances.reduce((sum, row) => sum + Number(row.outstanding_balance), 0);
  const balanceFor = (vendorId: string) => balanceByVendor.get(vendorId) ?? 0;

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setNotice("");
    setShowForm(true);
  }

  async function openEdit(vendor: Vendor) {
    if (!organization || !canSeeBank) return;
    setSaving(true);
    const { data: bankRows, error: bankError } = await supabase.rpc("get_vendor_bank_details", { p_organization_id: organization.id, p_vendor_id: vendor.id });
    setSaving(false);
    if (bankError) { setError("Could not load restricted bank details: " + bankError.message); return; }
    const bank = ((bankRows ?? []) as VendorBankDetails[])[0] ?? null;
    setEditing(vendor);
    setForm({
      name: vendor.name ?? "", contact_person: vendor.contact_person ?? "", phone: vendor.phone ?? "", email: vendor.email ?? "",
      address: vendor.address ?? "", category: vendor.category ?? "Materials", opening_balance: String(vendor.opening_balance ?? 0),
      bank_account_holder: bank?.bank_account_holder ?? "", bank_name: bank?.bank_name ?? "", bank_account_number: bank?.bank_account_number ?? "",
      bank_ifsc: bank?.bank_ifsc ?? "", bank_branch: bank?.bank_branch ?? "", bank_account_type: bank?.bank_account_type ?? "", notes: vendor.notes ?? "",
    });
    setError("");
    setNotice("");
    setShowForm(true);
  }

  async function openVendor(vendor: Vendor) {
    setSelected(vendor);
    setBankDetails(null);
    if (!organization || !canSeeBank) return;
    const { data, error: bankError } = await supabase.rpc("get_vendor_bank_details", { p_organization_id: organization.id, p_vendor_id: vendor.id });
    if (bankError) { setError("Could not load restricted bank details: " + bankError.message); return; }
    setBankDetails(((data ?? []) as VendorBankDetails[])[0] ?? null);
  }

  async function saveVendor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !user || !canEdit) return;
    setError("");
    setSaving(true);
    const balance = Number(form.opening_balance);
    if (!Number.isFinite(balance)) {
      setError("Opening balance must be a valid amount.");
      setSaving(false);
      return;
    }
    const payload = {
      name: form.name.trim(), contact_person: form.contact_person.trim() || null,
      phone: form.phone.trim() || null, email: form.email.trim() || null, address: form.address.trim() || null,
      category: form.category, opening_balance: balance, bank_account_holder: form.bank_account_holder.trim() || null,
      bank_name: form.bank_name.trim() || null, bank_account_number: form.bank_account_number.trim() || null,
      bank_ifsc: form.bank_ifsc.trim().toUpperCase() || null, bank_branch: form.bank_branch.trim() || null,
      bank_account_type: form.bank_account_type.trim() || null, notes: form.notes.trim() || null,
      organization_id: organization.id,
    };
    const result = editing
      ? await supabase.from("vendors").update(payload).eq("id", editing.id).eq("organization_id", organization.id).select("id, name").single()
      : await supabase.from("vendors").insert({ ...payload, created_by: user.id }).select("id, name").single();
    setSaving(false);
    if (result.error) {
      setError("Could not save vendor: " + result.error.message);
      return;
    }
    await supabase.from("audit_logs").insert({
      organization_id: organization.id, actor_id: user.id, action: editing ? "vendor.updated" : "vendor.created",
      entity_type: "vendor", entity_id: result.data.id,
      metadata: { name: result.data.name },
    });
    setShowForm(false);
    setNotice(editing ? "Vendor updated." : "Vendor added.");
    await loadData();
  }

  async function archiveVendor(vendor: Vendor) {
    if (!organization || !canEdit) return;
    if (!window.confirm("Archive " + vendor.name + "? Its records will be preserved and the vendor can be restored later.")) return;
    const { error: archiveError } = await supabase.from("vendors").update({ is_archived: true }).eq("id", vendor.id).eq("organization_id", organization.id);
    if (archiveError) setError("Could not archive vendor: " + archiveError.message);
    else {
      setNotice(vendor.name + " archived. Financial history remains in the ledger.");
      setSelected(null);
      await loadData();
    }
  }

  function exportVendors() {
    downloadCsv("leadercon-vendors.csv", [
      ["Name", "Contact person", "Phone", "Email", "Category", "Opening balance INR", "Outstanding INR"],
      ...visibleVendors.map((vendor) => [vendor.name, vendor.contact_person, vendor.phone, vendor.email, vendor.category, vendor.opening_balance, balanceFor(vendor.id)]),
    ]);
  }

  async function importLegacy() {
    if (!organization || !user || !canEdit) return;
    setImporting(true);
    setError("");
    setNotice("");
    try {
      const raw = window.localStorage.getItem(LEGACY_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) throw new Error("The saved vendor data is not a list.");
      const existingNames = new Set(vendors.map((item) => item.name.trim().toLowerCase()));
      const toImport = parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && typeof (row as { name?: unknown }).name === "string")
        .filter((row) => !existingNames.has(String(row.name).trim().toLowerCase()))
        .map((row) => ({
          organization_id: organization.id, created_by: user.id, name: String(row.name).trim(),
          phone: typeof row.phone === "string" ? row.phone : null, email: typeof row.email === "string" ? row.email : null,
          address: typeof row.address === "string" ? row.address : null, category: typeof row.category === "string" ? row.category : "Other",
          opening_balance: Number.isFinite(Number(row.openingBalance)) ? Number(row.openingBalance) : 0,
          notes: typeof row.notes === "string" ? row.notes : null, is_archived: false,
        }));
      if (!toImport.length) {
        setNotice("All legacy vendors already exist or the backup contains no valid records. The browser backup was preserved.");
        return;
      }
      const { error: importError } = await supabase.from("vendors").insert(toImport);
      if (importError) throw importError;
      if (raw) window.localStorage.setItem(BACKUP_KEY, raw);
      window.localStorage.removeItem(LEGACY_KEY);
      setLegacyCount(0);
      setNotice(toImport.length + " vendor record(s) imported. A copy of the original browser backup was retained.");
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? "Import failed: " + cause.message : "Import failed. The source backup was left untouched.");
    } finally {
      setImporting(false);
    }
  }

  if (!ready) return <div className="loading-card"><span className="spinner" /> Loading vendors and ledger…</div>;

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">Supplier accounts</p><h1>Vendors</h1><p>Manage supplier profiles, private documents, and ledger balances.</p></div>
        <div className="page-heading-actions">
          <button className="button button-secondary" onClick={exportVendors} disabled={!visibleVendors.length}>Export CSV</button>
          {canEdit && <button className="button button-primary" onClick={openNew}>＋ Add vendor</button>}
        </div>
      </div>

      {notice && <p className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</p>}
      {error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      {legacyCount > 0 && canEdit && (
        <div className="dashboard-banner">
          <div><h2>{legacyCount} local vendor record(s) found</h2><p>Review and import the old browser backup into this workspace. A separate copy is retained after a successful import.</p></div>
          <button className="button button-gold" onClick={importLegacy} disabled={importing}>{importing ? "Importing…" : "Import legacy vendors"}</button>
        </div>
      )}

      <div className="metrics-grid" style={{ marginBottom: 15 }}>
        <div className="metric-card"><div className="metric-top"><span>Active vendors</span><span className="metric-icon">♙</span></div><p className="metric-value">{vendors.length}</p><span className="metric-note">In this organization</span></div>
        <div className="metric-card"><div className="metric-top"><span>Total outstanding</span><span className="metric-icon">₹</span></div><p className="metric-value">{formatINR(totalOutstanding)}</p><span className="metric-note">Opening balance plus posted ledger entries</span></div>
        <div className="metric-card"><div className="metric-top"><span>Supplier categories</span><span className="metric-icon">◈</span></div><p className="metric-value">{new Set(vendors.map((item) => item.category).filter(Boolean)).size}</p><span className="metric-note">Across active vendor profiles</span></div>
        <div className="metric-card"><div className="metric-top"><span>Ledger records</span><span className="metric-icon">↕</span></div><p className="metric-value">{transactions.length}</p><span className="metric-note">Posted transactions loaded</span></div>
      </div>

      <section className="panel">
        <div className="panel-header"><div><h2>Vendor directory</h2><p>Click a supplier to review its profile and transaction history.</p></div><span className="chip">{visibleVendors.length} shown</span></div>
        <div className="toolbar">
          <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, contact or email" aria-label="Search vendors" />
          <select className="select" style={{ width: "auto", minWidth: 150 }} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category">
            <option>All</option>{categories.map((category) => <option key={category}>{category}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Vendor</th><th>Contact</th><th>Category</th><th>Created</th><th className="numeric">Outstanding</th><th className="numeric">Actions</th></tr></thead>
            <tbody>
              {visibleVendors.map((vendor) => {
                const balance = balanceFor(vendor.id);
                return <tr key={vendor.id}>
                  <td><button className="text-button primary-cell" onClick={() => void openVendor(vendor)}>{vendor.name}</button><div className="source-ref">{vendor.contact_person || vendor.address || "Supplier profile"}</div></td>
                  <td>{vendor.phone || "—"}<div className="source-ref">{vendor.email || ""}</div></td>
                  <td><span className="chip chip-neutral">{vendor.category || "Other"}</span></td>
                  <td>{formatDate(vendor.created_at)}</td>
                  <td className="numeric primary-cell">{formatINR(balance)}</td>
                  <td><div className="table-actions"><button className="text-button" onClick={() => void openVendor(vendor)}>View</button>{canEdit && <button className="text-button" onClick={() => void openEdit(vendor)}>Edit</button>}</div></td>
                </tr>;
              })}
              {!visibleVendors.length && <tr><td colSpan={6} className="table-empty">{vendors.length ? "No vendors match this search." : "No vendors in this workspace yet. Add a supplier to begin the ledger."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pagination-row"><span>Balances exclude drafts and void transactions.</span><span>{vendors.length} active vendor(s)</span></div>
      </section>

      {showForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="vendor-form-title">
          <div className="modal-header"><div><h2 id="vendor-form-title">{editing ? "Edit vendor" : "Add vendor"}</h2><p>Bank details are visible to owners and accountants only.</p></div><button className="close-button" aria-label="Close" onClick={() => setShowForm(false)}>×</button></div>
          <form onSubmit={saveVendor} className="modal-content">
            <div className="field-grid field-grid-3">
              <label className="field">Vendor name<input className="input" required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label className="field">Contact person<input className="input" maxLength={160} value={form.contact_person} onChange={(event) => setForm({ ...form, contact_person: event.target.value })} /></label>
              <label className="field">Category<select className="select" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label className="field">Phone<input className="input" maxLength={40} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
              <label className="field">Email<input className="input" type="email" maxLength={160} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
              <label className="field">Opening balance (INR)<input className="input" type="number" step="0.01" value={form.opening_balance} disabled={Boolean(editing)} onChange={(event) => setForm({ ...form, opening_balance: event.target.value })} /><small className="source-ref">{editing ? "Use a ledger adjustment to correct an opening balance." : "Set once when creating the vendor."}</small></label>
              <label className="field field-span-3">Address<input className="input" maxLength={500} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
            </div>
            {canSeeBank && <>
              <p className="form-section-title">Bank details · restricted</p>
              <div className="field-grid field-grid-3">
                <label className="field">Account holder<input className="input" maxLength={160} value={form.bank_account_holder} onChange={(event) => setForm({ ...form, bank_account_holder: event.target.value })} /></label>
                <label className="field">Bank name<input className="input" maxLength={160} value={form.bank_name} onChange={(event) => setForm({ ...form, bank_name: event.target.value })} /></label>
                <label className="field">Account number<input className="input" maxLength={80} value={form.bank_account_number} onChange={(event) => setForm({ ...form, bank_account_number: event.target.value })} /></label>
                <label className="field">IFSC<input className="input" maxLength={20} value={form.bank_ifsc} onChange={(event) => setForm({ ...form, bank_ifsc: event.target.value })} /></label>
                <label className="field">Branch<input className="input" maxLength={160} value={form.bank_branch} onChange={(event) => setForm({ ...form, bank_branch: event.target.value })} /></label>
                <label className="field">Account type<input className="input" maxLength={40} value={form.bank_account_type} onChange={(event) => setForm({ ...form, bank_account_type: event.target.value })} /></label>
              </div>
            </>}
            <label className="field" style={{ marginTop: 12 }}>Notes<textarea className="textarea" maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            {error && <p className="alert alert-error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
            <div className="form-actions"><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save vendor"}</button><button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Cancel</button></div>
          </form>
        </section>
      </div>}

      {selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="vendor-detail-title">
          <div className="modal-header"><div><p className="eyebrow">Vendor profile</p><h2 id="vendor-detail-title">{selected.name}</h2><p>{selected.category || "Other"} · {selected.contact_person || "No contact person"}</p></div><button className="close-button" aria-label="Close" onClick={() => setSelected(null)}>×</button></div>
          <div className="modal-content stack">
            <div className="metrics-grid" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
              <div className="metric-card"><div className="metric-top">Opening balance</div><p className="metric-value">{formatINR(selected.opening_balance)}</p></div>
              <div className="metric-card"><div className="metric-top">Current outstanding</div><p className="metric-value">{formatINR(balanceFor(selected.id))}</p></div>
            </div>
            <div className="content-grid" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))", marginTop: 0 }}>
              <div className="panel"><div className="panel-header"><h2>Contact</h2></div><div className="panel-body muted">{selected.phone || "No phone"}<br />{selected.email || "No email"}<br />{selected.address || "No address"}</div></div>
              {canSeeBank ? <div className="panel"><div className="panel-header"><h2>Bank details</h2></div><div className="panel-body muted">{bankDetails?.bank_name || "Bank not provided"}<br />{bankDetails?.bank_account_holder || ""}<br />{bankDetails?.bank_account_number || ""}<br />{bankDetails?.bank_ifsc || ""}</div></div> : <div className="alert alert-info">Bank details are restricted to owners and accountants.</div>}
            </div>
            <DocumentUpload vendorId={selected.id} documentType="other" />
            <section className="panel"><div className="panel-header"><div><h2>Recent ledger entries</h2><p>Posted records only</p></div><a className="text-button" href="/transactions">Open ledger</a></div>
              <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="numeric">Amount</th></tr></thead><tbody>
                {(ledgerByVendor.get(selected.id) ?? []).slice(0, 8).map((entry) => <tr key={entry.id}><td>{formatDate(entry.transaction_date)}</td><td>{transactionLabel(entry.transaction_type)}</td><td>{entry.reference_number || "—"}</td><td className="numeric">{formatINR(entry.amount)}</td></tr>)}
                {!(ledgerByVendor.get(selected.id) ?? []).length && <tr><td className="table-empty" colSpan={4}>No posted transactions.</td></tr>}
              </tbody></table></div>
            </section>
            {canEdit && <div className="form-actions"><button className="button button-secondary" onClick={() => { setSelected(null); void openEdit(selected); }}>Edit vendor</button><button className="button button-danger" onClick={() => archiveVendor(selected)}>Archive vendor</button></div>}
          </div>
        </section>
      </div>}
    </div>
  );
}
