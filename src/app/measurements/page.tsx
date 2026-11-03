"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { leaderConFileMimeType, validateLeaderConFile } from "@/lib/document-files";
import { areUnitsComparable, downloadCsv, formatDate } from "@/lib/financials";
import { demoMode, supabase } from "@/lib/supabase";

type Project = { id: string; name: string };
type Site = { id: string; project_id: string; name: string };
type Boq = { id: string; name: string; project_id: string | null; status: string };
type BoqItem = { id: string; boq_id: string; item_number: string | null; description: string; unit: string | null; quantity: number | string | null; rate: number | string | null; amount: number | string | null; source_ref: string | null };
type Book = { id: string; number: string; project_id: string | null; site_id: string | null; measured_on: string | null; status: string; created_at: string };
type Entry = { id: string; boq_item_id: string | null; item_number: string | null; description: string | null; length: number | string | null; width: number | string | null; height_depth: number | string | null; units_count: number | string | null; quantity: number | string; unit: string | null; source_ref: string | null };
type ReviewEntry = { itemNumber: string | null; description: string; unit: string | null; length: number | null; width: number | null; heightDepth: number | null; unitsCount: number | null; quantity: number | null; boqItemId: string | null; boqItemNumber: string | null; sourceRef: string | null; confidence: number };
type Extraction = { title: string | null; documentDate: string | null; items: ReviewEntry[]; notes: string[] };
const accepted = ".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.doc,.docx,.csv,.txt";

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return window.btoa(binary);
}

function blankEntry(): ReviewEntry {
  return { itemNumber: "", description: "", unit: "", length: null, width: null, heightDepth: null, unitsCount: 1, quantity: null, boqItemId: null, boqItemNumber: null, sourceRef: "", confidence: 1 };
}

export default function MeasurementsPage() {
  const { organization, user } = useWorkspace();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [boqs, setBoqs] = useState<Boq[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [selected, setSelected] = useState<Book | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [number, setNumber] = useState("");
  const [projectId, setProjectId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [measuredOn, setMeasuredOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canDraft = ["owner", "accountant", "project_manager", "site_engineer"].includes(organization?.role || "");
  const canApprove = ["owner", "accountant", "project_manager"].includes(organization?.role || "");

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [p, s, b, items, m] = await Promise.all([
      supabase.from("projects").select("id, name").eq("organization_id", organization.id).neq("status", "archived").order("name"),
      supabase.from("project_sites").select("id, project_id, name").eq("organization_id", organization.id).order("name"),
      supabase.from("boqs").select("id, name, project_id, status").eq("organization_id", organization.id).eq("status", "approved").order("created_at", { ascending: false }),
      supabase.from("boq_items").select("id, boq_id, item_number, description, unit, quantity, rate, amount, source_ref").eq("organization_id", organization.id).order("item_number"),
      supabase.from("measurement_books").select("id, number, project_id, site_id, measured_on, status, created_at").eq("organization_id", organization.id).order("created_at", { ascending: false }),
    ]);
    const loadError = p.error || s.error || b.error || items.error || m.error;
    setError(loadError ? "Could not load Measurement Books. Confirm the construction migrations: " + loadError.message : "");
    setProjects((p.data ?? []) as Project[]); setSites((s.data ?? []) as Site[]); setBoqs((b.data ?? []) as Boq[]);
    setBoqItems((items.data ?? []) as BoqItem[]); setBooks((m.data ?? []) as Book[]); setLoading(false);
  }, [organization]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);

  const availableSites = sites.filter((site) => !projectId || site.project_id === projectId);
  const availableItems = useMemo(() => boqItems.filter((item) => boqs.some((boq) => boq.id === item.boq_id && (!projectId || boq.project_id === projectId))), [boqItems, boqs, projectId]);
  const siteName = (id: string | null) => sites.find((site) => site.id === id)?.name ?? "—";
  const projectName = (id: string | null) => projects.find((project) => project.id === id)?.name ?? "—";

  async function analyze() {
    if (!file || !organization) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const validationError = validateLeaderConFile(file);
      const mimeType = leaderConFileMimeType(file);
      if (validationError || !mimeType) throw new Error(validationError || "Unsupported file type.");
      if (file.size > 10 * 1024 * 1024) throw new Error("AI analysis supports files up to 10 MB.");
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + data.session.access_token }, body: JSON.stringify({ task: "extract_mb", organizationId: organization.id, file: { name: file.name, mimeType, base64: encodeBase64(new Uint8Array(await file.arrayBuffer())) } }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Measurement extraction failed.");
      const result = payload.result as Extraction;
      const items = result.items.map((item) => {
        const match = availableItems.find((boq) => (item.boqItemNumber && boq.item_number?.toLowerCase() === item.boqItemNumber.toLowerCase()) || (item.itemNumber && boq.item_number?.toLowerCase() === item.itemNumber.toLowerCase()));
        return { ...blankEntry(), ...item, boqItemId: match?.id ?? null, boqItemNumber: match?.item_number ?? item.boqItemNumber ?? null };
      });
      setExtraction({ ...result, items }); setNumber((current) => current || result.title || file.name.replace(/\.[^.]+$/, ""));
      setMeasuredOn(result.documentDate || measuredOn); setNotice("AI suggestions are ready. Confirm each dimension, unit, BOQ link, and source before saving.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Measurement extraction failed."); }
    finally { setBusy(false); }
  }

  function updateEntry(index: number, patch: Partial<ReviewEntry>) {
    setExtraction((current) => current ? { ...current, items: current.items.map((entry, row) => row === index ? { ...entry, ...patch } : entry) } : null);
  }

  function quantityFor(entry: ReviewEntry) {
    const dims = [entry.length, entry.width, entry.heightDepth];
    if (dims.every((value) => value !== null && Number.isFinite(value))) return Math.round(Number(entry.length) * Number(entry.width) * Number(entry.heightDepth) * Number(entry.unitsCount || 1) * 10000) / 10000;
    return Number(entry.quantity || 0);
  }

  async function saveReview() {
    if (!organization || !user || !file || !extraction || !canDraft) { setError("Your workspace role cannot save this draft, or the source file and reviewed rows are missing."); return; }
    const validationError = validateLeaderConFile(file);
    const mimeType = leaderConFileMimeType(file);
    if (validationError || !mimeType) { setError(validationError || "Unsupported file type."); return; }
    if (!number.trim() || !extraction.items.length || extraction.items.some((entry) => !entry.description.trim())) { setError("Add a Measurement Book number and description for each row."); return; }
    setBusy(true); setError(""); setNotice("");
    const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const storagePath = organization.id + "/" + user.id + "/" + crypto.randomUUID() + "-" + safeName;
    try {
      const { error: uploadError } = await supabase.storage.from("sumanik-documents").upload(storagePath, file, { contentType: mimeType, upsert: false });
      if (uploadError) throw uploadError;
      const rows = extraction.items.map((entry) => ({ itemNumber: entry.itemNumber, description: entry.description.trim(), unit: entry.unit, length: entry.length, width: entry.width, heightDepth: entry.heightDepth, unitsCount: entry.unitsCount || 1, quantity: quantityFor(entry), boqItemId: entry.boqItemId, sourceRef: entry.sourceRef }));
      const { error: saveError } = await supabase.rpc("save_measurement_review", { p_organization_id: organization.id, p_number: number.trim(), p_project_id: projectId || null, p_site_id: siteId || null, p_measured_on: measuredOn || null, p_storage_path: storagePath, p_file_name: file.name, p_mime_type: mimeType, p_file_size_bytes: file.size, p_entries: rows, p_notes: extraction.notes ?? [] });
      if (saveError) { await supabase.storage.from("sumanik-documents").remove([storagePath]); throw saveError; }
      setNotice("Measurement Book saved as a review draft. Quantities use the recorded dimensions where available.");
      setFile(null); setExtraction(null); setNumber(""); setSiteId(""); await loadData();
    } catch (cause) { setError(cause instanceof Error ? "Could not save Measurement Book: " + cause.message : "Could not save Measurement Book."); }
    finally { setBusy(false); }
  }

  async function openBook(book: Book) {
    setSelected(book); setEntries([]); setError("");
    const { data, error: entryError } = await supabase.from("measurement_entries").select("id, boq_item_id, item_number, description, length, width, height_depth, units_count, quantity, unit, source_ref").eq("organization_id", organization?.id).eq("measurement_book_id", book.id).order("item_number");
    if (entryError) setError("Could not load measurement entries: " + entryError.message);
    else setEntries((data ?? []) as Entry[]);
  }

  async function approveBook(book: Book) {
    if (!organization) return;
    setBusy(true); setError("");
    const { error: approveError } = await supabase.rpc("approve_measurement_book", { p_organization_id: organization.id, p_book_id: book.id });
    setBusy(false);
    if (approveError) setError("Approval failed: " + approveError.message);
    else { setNotice("Measurement Book approved and locked for use in bill review."); setSelected(null); await loadData(); }
  }

  const comparison = useMemo(() => {
    const grouped = new Map<string, { measured: number; unitMismatch: boolean; sourceRefs: string[] }>();
    for (const entry of entries) {
      if (!entry.boq_item_id) continue;
      const current = grouped.get(entry.boq_item_id) ?? { measured: 0, unitMismatch: false, sourceRefs: [] };
      const item = boqItems.find((row) => row.id === entry.boq_item_id);
      if (!item || !areUnitsComparable(item.unit, entry.unit)) current.unitMismatch = true;
      else current.measured += Number(entry.quantity);
      if (entry.source_ref) current.sourceRefs.push(entry.source_ref);
      grouped.set(entry.boq_item_id, current);
    }
    return Array.from(grouped, ([id, record]) => {
      const item = boqItems.find((row) => row.id === id);
      const planned = Number(item?.quantity ?? 0);
      return { item, measured: record.measured, planned, variance: record.unitMismatch ? null : record.measured - planned, unitMismatch: record.unitMismatch, sourceRefs: record.sourceRefs };
    });
  }, [entries, boqItems]);

  function exportComparison() {
    downloadCsv("leadercon-measurement-comparison.csv", [["BOQ item", "Description", "BOQ quantity", "Comparable measured quantity", "Variance", "Unit", "Status", "BOQ source", "Measurement sources"], ...comparison.map((row) => [row.item?.item_number, row.item?.description, row.planned, row.unitMismatch ? "" : row.measured, row.variance, row.item?.unit, row.unitMismatch ? "Unit mismatch or missing unit; review required" : "Comparable", row.item?.source_ref, row.sourceRefs.join("; ")])]);
  }

  return <div>
    <div className="page-heading"><div><p className="eyebrow">Construction records</p><h1>Measurement Books</h1><p>Extract measurements, verify dimensions and BOQ links, then compare quantities before approval.</p></div></div>
    {notice && <p className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</p>}{error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
    <div className="content-grid" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(300px, .8fr)", alignItems: "start" }}>
      <section className="panel"><div className="panel-header"><div><h2>Measurement Book register</h2><p>Approved records are locked. Drafts can be reviewed by an approver.</p></div><span className="chip">{books.length} books</span></div>
        {loading ? <div className="loading-card"><span className="spinner" /> Loading records…</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Number</th><th>Project / site</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>
          {books.map((book) => <tr key={book.id}><td><strong>{book.number}</strong></td><td>{projectName(book.project_id)}<div className="source-ref">{siteName(book.site_id)}</div></td><td>{formatDate(book.measured_on)}</td><td><span className={"chip " + (book.status === "approved" ? "chip-success" : "chip-warning")}>{book.status}</span></td><td><button className="text-button" onClick={() => void openBook(book)}>Review</button>{canApprove && ["draft", "review"].includes(book.status) && <button className="text-button" style={{ marginLeft: 10 }} disabled={busy} onClick={() => void approveBook(book)}>Approve</button>}</td></tr>)}
          {!books.length && <tr><td colSpan={5} className="table-empty">No Measurement Books recorded yet.</td></tr>}
        </tbody></table></div>}
      </section>
      {selected && <section className="panel"><div className="panel-header"><div><h2>{selected.number}</h2><p>{projectName(selected.project_id)} · {formatDate(selected.measured_on)} · {selected.status}</p></div><button className="close-button" onClick={() => setSelected(null)} aria-label="Close review">×</button></div>
        <div className="panel-body stack"><div className="table-wrap"><table className="data-table comparison-table"><thead><tr><th>Item</th><th>Description</th><th className="numeric">Measured</th><th className="numeric">BOQ</th><th className="numeric">Variance</th></tr></thead><tbody>
          {entries.map((entry) => { const boq = boqItems.find((item) => item.id === entry.boq_item_id); const comparable = Boolean(boq && areUnitsComparable(boq.unit, entry.unit)); const variance = comparable ? Number(entry.quantity) - Number(boq?.quantity ?? 0) : null; const repeatedSource = Boolean(entry.source_ref && entries.some((other) => other.id !== entry.id && other.boq_item_id === entry.boq_item_id && other.source_ref === entry.source_ref)); return <tr key={entry.id}><td>{entry.item_number || boq?.item_number || "—"}</td><td>{entry.description || boq?.description}<div className="source-ref">{entry.length && entry.width && entry.height_depth ? `${entry.length} × ${entry.width} × ${entry.height_depth} × ${entry.units_count || 1} ${entry.unit || ""}` : entry.source_ref}</div>{repeatedSource && <span className="chip chip-warning">Repeated source ref</span>}</td><td className="numeric">{Number(entry.quantity).toLocaleString("en-IN")} {entry.unit}</td><td className="numeric">{boq ? `${Number(boq.quantity ?? 0).toLocaleString("en-IN")} ${boq.unit || ""}` : "—"}</td><td className={"numeric " + (variance !== null && variance > 0 ? "over" : "")}>{variance === null ? <span className="chip chip-warning">{boq ? (entry.unit && boq.unit ? "Unit mismatch" : "Unit missing") : "Not linked"}</span> : `${variance > 0 ? "+" : ""}${variance.toLocaleString("en-IN")}`}</td></tr>; })}
          {!entries.length && <tr><td colSpan={5} className="table-empty">No entries found for this book.</td></tr>}
        </tbody></table></div><button className="button button-secondary" onClick={exportComparison} disabled={!comparison.length}>Export BOQ comparison</button></div>
      </section>}
    </div>

    <section className="panel" style={{ marginTop: 16 }}><div className="panel-header"><div><h2>Create a Measurement Book draft</h2><p>AI can read the source; dimensions and BOQ links require human review.</p></div><span className="chip">Review first</span></div>
      <div className="panel-body stack">
        <label className="field">Source file<input className="input" type="file" accept={accepted} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setExtraction(null); setError(""); }} /><small className="source-ref">PDF, image, Excel, Word, CSV, or text. Private source file is required.</small></label>
        {file && <div className="upload-box"><strong>{file.name}</strong><p>{(file.size / (1024 * 1024)).toFixed(2)} MB. {demoMode ? "AI calls are disabled in this local preview; you can still enter measurements manually." : "AI analysis limit 10 MB; private storage limit 20 MB."}</p><button className="button button-gold" disabled={demoMode || busy || !canDraft} onClick={() => void analyze()}>{demoMode ? "AI unavailable in demo" : busy ? "Analyzing…" : "Analyze with AI"}</button>{!canDraft && <span className="source-ref">Your workspace role is read-only for Measurement Book drafts.</span>}</div>}
        <div className="field-grid field-grid-3"><label className="field">Book number<input className="input" value={number} onChange={(event) => setNumber(event.target.value)} maxLength={100} /></label><label className="field">Measured on<input className="input" type="date" value={measuredOn} onChange={(event) => setMeasuredOn(event.target.value)} /></label><label className="field">Project<select className="select" value={projectId} onChange={(event) => { setProjectId(event.target.value); setSiteId(""); }}><option value="">Not linked</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="field">Site<select className="select" value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Not linked</option>{availableSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label></div>
        {extraction && <>
          {extraction.notes?.length > 0 && <div className="alert alert-info"><strong>AI notes</strong><ul>{extraction.notes.map((note, i) => <li key={i}>{note}</li>)}</ul></div>}
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>Description</th><th>BOQ item</th><th>L × W × H / D</th><th className="numeric">Units</th><th>Unit</th><th>Quantity</th><th>Source</th><th></th></tr></thead><tbody>{extraction.items.map((entry, index) => <tr key={index}>
            <td><input className="input" style={{ width: 70 }} aria-label="Measurement item number" value={entry.itemNumber || ""} onChange={(event) => updateEntry(index, { itemNumber: event.target.value })} />{entry.confidence < .7 && <span className="chip chip-warning">Check</span>}</td>
            <td><input className="input" style={{ minWidth: 150 }} aria-label="Measurement description" value={entry.description} onChange={(event) => updateEntry(index, { description: event.target.value })} /></td>
            <td><select className="select" style={{ minWidth: 150 }} value={entry.boqItemId || ""} onChange={(event) => { const item = availableItems.find((row) => row.id === event.target.value); updateEntry(index, { boqItemId: item?.id ?? null, boqItemNumber: item?.item_number ?? null }); }}><option value="">Not linked</option>{availableItems.map((item) => <option key={item.id} value={item.id}>{item.item_number || "Item"} · {item.description.slice(0, 50)}</option>)}</select></td>
            <td><div style={{ display: "flex", gap: 3 }}>{(["length", "width", "heightDepth"] as const).map((key) => <input key={key} className="input" style={{ width: 68 }} type="number" step="0.0001" aria-label={key} placeholder={key === "heightDepth" ? "H/D" : key === "length" ? "L" : "W"} value={entry[key] ?? ""} onChange={(event) => updateEntry(index, { [key]: event.target.value === "" ? null : Number(event.target.value) })} />)}</div></td>
            <td className="numeric"><input className="input" style={{ width: 70 }} type="number" step="0.01" aria-label="Units count" value={entry.unitsCount ?? 1} onChange={(event) => updateEntry(index, { unitsCount: event.target.value === "" ? null : Number(event.target.value) })} /></td>
            <td><input className="input" style={{ width: 65 }} aria-label="Unit" value={entry.unit || ""} onChange={(event) => updateEntry(index, { unit: event.target.value })} /></td>
            <td>{quantityFor(entry).toLocaleString("en-IN")}</td><td><input className="input" style={{ width: 85 }} aria-label="Source page or row" value={entry.sourceRef || ""} onChange={(event) => updateEntry(index, { sourceRef: event.target.value })} /></td>
            <td><button className="text-button" onClick={() => setExtraction({ ...extraction, items: extraction.items.filter((_, row) => row !== index) })}>Remove</button></td>
          </tr>)}</tbody></table></div>
          <div className="form-actions"><button className="button button-secondary" disabled={!canDraft} onClick={() => setExtraction({ ...extraction, items: [...extraction.items, blankEntry()] })}>＋ Add row</button><button className="button button-primary" disabled={busy || !canDraft || !extraction.items.length} onClick={() => void saveReview()}>{busy ? "Saving…" : "Save review draft"}</button></div>
        </>}
      </div>
    </section>
    <p className="credit-line">Financial quantity comparisons are deterministic; AI extraction is an unapproved suggestion until reviewed.</p>
  </div>;
}
