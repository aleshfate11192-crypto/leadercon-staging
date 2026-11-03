"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { leaderConFileMimeType, validateLeaderConFile } from "@/lib/document-files";
import { canApproveConstructionRecords, formatDate, formatINR } from "@/lib/financials";
import { demoMode, supabase } from "@/lib/supabase";

type Project = { id: string; name: string };
type Site = { id: string; project_id: string; name: string };
type Boq = { id: string; name: string; project_id: string | null; site_id: string | null; version_number: number; revision_date: string | null; status: string; total_amount: number | string; created_at: string };
type BoqItem = { id?: string; itemNumber: string | null; description: string; unit: string | null; quantity: number | null; rate: number | null; amount: number | null; specification: string | null; sourceRef: string | null; confidence: number };
type Extraction = { title: string | null; documentDate: string | null; items: BoqItem[]; notes: string[] };
type Answer = { answer: string; sourceRefs: string[]; caveats: string[] };
const accepted = ".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.doc,.docx,.csv,.txt";

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function newItem(): BoqItem {
  return { itemNumber: "", description: "", unit: "", quantity: null, rate: null, amount: null, specification: "", sourceRef: "", confidence: 1 };
}

export default function BoqPage() {
  const { organization, user } = useWorkspace();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [boqs, setBoqs] = useState<Boq[]>([]);
  const [selected, setSelected] = useState<Boq | null>(null);
  const [selectedItems, setSelectedItems] = useState<BoqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [revisionDate, setRevisionDate] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const canDraft = ["owner", "accountant", "project_manager", "site_engineer"].includes(organization?.role || "");
  const canApprove = canApproveConstructionRecords(organization?.role) && ["owner", "accountant", "project_manager"].includes(organization?.role || "");

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [projectResult, siteResult, boqResult] = await Promise.all([
      supabase.from("projects").select("id, name").eq("organization_id", organization.id).neq("status", "archived").order("name"),
      supabase.from("project_sites").select("id, project_id, name").eq("organization_id", organization.id).order("name"),
      supabase.from("boqs").select("id, name, project_id, site_id, version_number, revision_date, status, total_amount, created_at").eq("organization_id", organization.id).order("created_at", { ascending: false }),
    ]);
    const firstError = projectResult.error || siteResult.error || boqResult.error;
    setError(firstError ? "Could not load BOQ records. Confirm the construction workflow migrations: " + firstError.message : "");
    setProjects((projectResult.data ?? []) as Project[]);
    setSites((siteResult.data ?? []) as Site[]);
    setBoqs((boqResult.data ?? []) as Boq[]);
    setLoading(false);
  }, [organization]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const availableSites = useMemo(() => sites.filter((site) => !projectId || site.project_id === projectId), [sites, projectId]);

  async function analyzeDocument() {
    if (!file || !organization) return;
    setError(""); setNotice(""); setBusy(true); setAnswer(null);
    try {
      const validationError = validateLeaderConFile(file);
      const mimeType = leaderConFileMimeType(file);
      if (validationError || !mimeType) throw new Error(validationError || "Unsupported file type.");
      if (file.size > 10 * 1024 * 1024) throw new Error("AI analysis supports files up to 10 MB. You can still add the BOQ items manually.");
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again.");
      const base64 = encodeBase64(new Uint8Array(await file.arrayBuffer()));
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ task: "extract_boq", organizationId: organization.id, file: { name: file.name, mimeType, base64 } }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "BOQ analysis failed.");
      const result = payload.result as Extraction;
      setExtraction(result);
      setName((current) => current || result.title || file.name.replace(/\.[^.]+$/, ""));
      setRevisionDate((current) => current || result.documentDate || "");
      setNotice("AI extraction is ready for review. Verify every quantity, rate, and source reference before saving.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "BOQ analysis failed.");
    } finally { setBusy(false); }
  }

  function updateItem(index: number, patch: Partial<BoqItem>) {
    setExtraction((current) => current ? { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) } : null);
  }

  function addManualItem() {
    setExtraction((current) => current ? { ...current, items: [...current.items, newItem()] } : { title: name || null, documentDate: revisionDate || null, items: [newItem()], notes: [] });
  }

  function amountFor(item: BoqItem) {
    if (item.quantity !== null && item.rate !== null) return Math.round(item.quantity * item.rate * 100) / 100;
    return Number(item.amount || 0);
  }

  async function saveReview() {
    if (!organization || !user || !file || !canDraft) { setError("Your workspace role cannot save this BOQ draft, or the source file is missing."); return; }
    const validationError = validateLeaderConFile(file);
    const mimeType = leaderConFileMimeType(file);
    if (validationError || !mimeType) { setError(validationError || "Unsupported file type."); return; }
    const items = extraction?.items ?? [];
    if (!name.trim() || !items.length || items.some((item) => !item.description.trim())) {
      setError("Add a BOQ name and a description for every item."); return;
    }
    setBusy(true); setError(""); setNotice("");
    const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const storagePath = organization.id + "/" + user.id + "/" + crypto.randomUUID() + "-" + safeName;
    try {
      const { error: uploadError } = await supabase.storage.from("sumanik-documents").upload(storagePath, file, { contentType: mimeType, upsert: false });
      if (uploadError) throw uploadError;
      const reviewedItems = items.map((item) => ({
        itemNumber: item.itemNumber || null, description: item.description.trim(), unit: item.unit || null,
        quantity: item.quantity === null || item.quantity === undefined ? null : Number(item.quantity),
        rate: item.rate === null || item.rate === undefined ? null : Number(item.rate),
        amount: item.amount === null || item.amount === undefined ? null : Number(item.amount),
        specification: item.specification || null, sourceRef: item.sourceRef || null, confidence: Number(item.confidence || 0),
      }));
      const { error: saveError } = await supabase.rpc("save_boq_review", {
        p_organization_id: organization.id, p_name: name.trim(), p_project_id: projectId || null,
        p_site_id: siteId || null, p_revision_date: revisionDate || null, p_storage_path: storagePath,
        p_file_name: file.name, p_mime_type: mimeType, p_file_size_bytes: file.size,
        p_items: reviewedItems, p_notes: extraction?.notes ?? [],
      });
      if (saveError) {
        await supabase.storage.from("sumanik-documents").remove([storagePath]);
        throw saveError;
      }
      setNotice("BOQ saved as a review draft. Official BOQ totals are stored from deterministic quantity × rate calculations.");
      setFile(null); setExtraction(null); setName(""); setRevisionDate(""); setSiteId("");
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? "Could not save BOQ: " + cause.message : "Could not save BOQ.");
    } finally { setBusy(false); }
  }

  async function openBoq(boq: Boq) {
    setSelected(boq); setAnswer(null); setQuestion(""); setError("");
    const { data, error: itemError } = await supabase.from("boq_items").select("id, item_number, description, unit, quantity, rate, amount, specification, source_ref, confidence").eq("organization_id", organization?.id).eq("boq_id", boq.id).order("item_number", { ascending: true });
    if (itemError) setError("Could not load BOQ items: " + itemError.message);
    else setSelectedItems((data ?? []).map((row) => ({ id: row.id, itemNumber: row.item_number, description: row.description, unit: row.unit, quantity: row.quantity === null ? null : Number(row.quantity), rate: row.rate === null ? null : Number(row.rate), amount: row.amount === null ? null : Number(row.amount), specification: row.specification, sourceRef: row.source_ref, confidence: Number(row.confidence ?? 1) })));
  }

  async function approveBoq(boq: Boq) {
    if (!organization) return;
    setBusy(true); setError("");
    const { error: approveError } = await supabase.rpc("approve_boq", { p_organization_id: organization.id, p_boq_id: boq.id });
    setBusy(false);
    if (approveError) setError("BOQ approval failed: " + approveError.message);
    else { setNotice("BOQ approved. Its items can now be used in BOQ questions, measurements, and bill review."); setSelected(null); await loadData(); }
  }

  async function askBoq(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !organization) return;
    setBusy(true); setError(""); setAnswer(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ task: "boq_question", organizationId: organization.id, boqId: selected.id, question }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not answer the BOQ question.");
      setAnswer(payload.result as Answer);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not answer the BOQ question."); }
    finally { setBusy(false); }
  }

  const selectedProjectName = (id: string | null) => projects.find((project) => project.id === id)?.name || "No project";
  const reviewItems = extraction?.items ?? [];
  const totalReviewAmount = reviewItems.reduce((sum, item) => sum + amountFor(item), 0);
  const sourceOnlyAmountRows = reviewItems.filter((item) => (item.quantity === null || item.rate === null) && item.amount !== null).length;

  return (
    <div>
      <div className="page-heading"><div><p className="eyebrow">Construction intelligence</p><h1>BOQ Intelligence</h1><p>Read, verify, version, explain, and query Bills of Quantities with source references.</p></div><div className="page-heading-actions"><span className="chip chip-neutral">{demoMode ? "AI disabled in local demo mode" : "AI analysis sends the selected file to your configured provider"}</span></div></div>
      {notice && <p className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</p>}
      {error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}

      <div className="content-grid" style={{ gridTemplateColumns: "minmax(0, 1.25fr) minmax(310px, .9fr)", alignItems: "start" }}>
        <section className="panel"><div className="panel-header"><div><h2>Upload and review a BOQ</h2><p>AI suggestions remain a draft until you verify and save them.</p></div><span className="chip">Review first</span></div>
          <div className="panel-body stack">
            <label className="field">Source file<input className="input" type="file" accept={accepted} onChange={(event) => { const nextFile = event.target.files?.[0] ?? null; setFile(nextFile); setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : ""); setExtraction(null); setError(""); }} /><small className="source-ref">PDF, image, Excel, Word, CSV, or text. AI analysis limit: 10 MB; private storage limit: 20 MB.</small></label>
            {file && <div className="upload-box"><strong>{file.name}</strong><p>{(file.size / (1024 * 1024)).toFixed(2)} MB. {demoMode ? "AI calls are disabled in this local preview; you can still enter BOQ lines manually." : "Select “Analyze with AI” to send it through the server to the configured provider."}</p><div className="form-actions"><button className="button button-gold" onClick={analyzeDocument} disabled={demoMode || busy || !canDraft}>{demoMode ? "AI unavailable in demo" : busy ? "Analyzing…" : "Analyze with AI"}</button><button className="button button-secondary" onClick={addManualItem} disabled={!canDraft}>Add item manually</button></div>{!canDraft && <span className="source-ref">Your workspace role is read-only for BOQ drafts.</span>}</div>}
            <div className="field-grid field-grid-3">
              <label className="field field-span-2">BOQ / estimate name<input className="input" maxLength={180} value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name or BOQ title" /></label>
              <label className="field">Revision date<input className="input" type="date" value={revisionDate} onChange={(event) => setRevisionDate(event.target.value)} /></label>
              <label className="field field-span-2">Project<select className="select" value={projectId} onChange={(event) => { setProjectId(event.target.value); setSiteId(""); }}><option value="">Not linked</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label className="field">Site<select className="select" value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Not linked</option>{availableSites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
            </div>
            {previewUrl && file?.type === "application/pdf" && <div className="panel"><div className="panel-header"><div><h2>Source preview</h2><p>Use the original alongside extracted rows.</p></div><a className="text-button" href={previewUrl} target="_blank" rel="noreferrer">Open PDF</a></div><iframe title="BOQ source preview" src={previewUrl} style={{ width: "100%", height: 300, border: 0 }} /></div>}
            {extraction && <>
              {extraction.notes?.length > 0 && <div className="alert alert-info"><strong>AI review notes</strong><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{extraction.notes.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
              <section className="panel"><div className="panel-header"><div><h2>Extracted items</h2><p>Correct uncertain rows before saving. Amounts use deterministic quantity × rate values when both are present.</p></div><button className="button button-secondary" onClick={addManualItem} disabled={!canDraft}>＋ Add row</button></div>
                <div className="table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>Description / specification</th><th>Unit</th><th className="numeric">Quantity</th><th className="numeric">Rate</th><th className="numeric">Amount</th><th>Source</th><th></th></tr></thead><tbody>
                  {extraction.items.map((item, index) => {
                    const calculated = amountFor(item);
                    const hasCalculation = item.quantity !== null && item.rate !== null;
                    const mismatch = hasCalculation && item.amount !== null && Math.abs(calculated - item.amount) > 0.01;
                    const itemNumber = item.itemNumber?.trim().toLocaleLowerCase("en");
                    const duplicateItemNumber = Boolean(itemNumber && extraction.items.some((other, otherIndex) => otherIndex !== index && other.itemNumber?.trim().toLocaleLowerCase("en") === itemNumber));
                    return <tr key={index}>
                      <td><input className="input" style={{ width: 64 }} aria-label="Item number" value={item.itemNumber || ""} onChange={(event) => updateItem(index, { itemNumber: event.target.value })} />{item.confidence < .7 && <span className="chip chip-warning">Check</span>}{duplicateItemNumber && <span className="chip chip-warning">Duplicate number</span>}</td>
                      <td><input className="input" style={{ minWidth: 180 }} aria-label="Item description" value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} /><input className="input" style={{ minWidth: 180, marginTop: 5 }} aria-label="Specification" value={item.specification || ""} onChange={(event) => updateItem(index, { specification: event.target.value })} placeholder="Technical specification" /></td>
                      <td><input className="input" style={{ width: 70 }} aria-label="Unit" value={item.unit || ""} onChange={(event) => updateItem(index, { unit: event.target.value })} /></td>
                      <td className="numeric"><input className="input" style={{ width: 90, textAlign: "right" }} aria-label="Quantity" type="number" step="0.0001" value={item.quantity ?? ""} onChange={(event) => updateItem(index, { quantity: event.target.value === "" ? null : Number(event.target.value) })} /></td>
                      <td className="numeric"><input className="input" style={{ width: 90, textAlign: "right" }} aria-label="Rate" type="number" step="0.01" value={item.rate ?? ""} onChange={(event) => updateItem(index, { rate: event.target.value === "" ? null : Number(event.target.value) })} /></td>
                      <td className="numeric">{hasCalculation ? formatINR(calculated) : item.amount === null ? "—" : <>{formatINR(item.amount)}<div className="source-ref">Source-stated; not recalculated</div></>}{mismatch && <div className="source-ref" style={{ color: "#a44c43" }}>Source says {formatINR(item.amount)}</div>}</td>
                      <td><input className="input" style={{ width: 100 }} aria-label="Source page or row" value={item.sourceRef || ""} onChange={(event) => updateItem(index, { sourceRef: event.target.value })} placeholder="Page / row" /></td>
                      <td><button className="text-button" aria-label="Remove BOQ row" onClick={() => setExtraction({ ...extraction, items: extraction.items.filter((_, rowIndex) => rowIndex !== index) })}>Remove</button></td>
                    </tr>;
                  })}
                  {!extraction.items.length && <tr><td colSpan={8} className="table-empty">Add a row to continue.</td></tr>}
                </tbody></table></div>
                <div className="pagination-row"><span>{extraction.items.length} item(s){sourceOnlyAmountRows > 0 && <span className="source-ref" style={{ display: "block" }}>{sourceOnlyAmountRows} amount(s) use the source figure because quantity or rate is missing.</span>}</span><strong>Reviewed total {formatINR(totalReviewAmount)}</strong></div>
              </section>
              {file && <button className="button button-primary" onClick={saveReview} disabled={busy || !canDraft}>{busy ? "Saving draft…" : "Save reviewed BOQ draft"}</button>}
            </>}
          </div>
        </section>

        <section className="panel"><div className="panel-header"><div><h2>BOQ register</h2><p>Approved versions can be queried and compared with measurements.</p></div><span className="chip">{boqs.length} versions</span></div>
          {loading ? <div className="loading-card"><span className="spinner" /> Loading BOQs…</div> : <div className="panel-body data-list">{boqs.map((boq) => <div className="data-list-row" key={boq.id}><button style={{ padding: 0, border: 0, background: "transparent", textAlign: "left" }} onClick={() => void openBoq(boq)}><strong>{boq.name} · v{boq.version_number}</strong><small>{selectedProjectName(boq.project_id)} · {formatDate(boq.revision_date)}</small></button><span style={{ display: "flex", alignItems: "center", gap: 8 }}><strong>{formatINR(boq.total_amount)}</strong><span className={"chip " + (boq.status === "approved" ? "chip-success" : "chip-warning")}>{boq.status}</span></span></div>)}{!boqs.length && <p className="table-empty">No BOQs recorded yet.</p>}</div>}
        </section>
      </div>

      {selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="boq-detail-title"><div className="modal-header"><div><p className="eyebrow">BOQ · v{selected.version_number} · {selected.status}</p><h2 id="boq-detail-title">{selected.name}</h2><p>{selectedProjectName(selected.project_id)} · Revision {formatDate(selected.revision_date)}</p></div><button className="close-button" aria-label="Close" onClick={() => setSelected(null)}>×</button></div><div className="modal-content stack">
        <section className="panel"><div className="panel-header"><div><h2>BOQ items</h2><p>Source references are shown with each item.</p></div><strong>{formatINR(selected.total_amount)}</strong></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>Description</th><th>Unit</th><th className="numeric">Quantity</th><th className="numeric">Rate</th><th className="numeric">Amount</th><th>Source</th></tr></thead><tbody>{selectedItems.map((item, index) => <tr key={item.id || index}><td>{item.itemNumber || "—"}</td><td className="primary-cell">{item.description}<div className="source-ref">{item.specification}</div></td><td>{item.unit || "—"}</td><td className="numeric">{item.quantity ?? "—"}</td><td className="numeric">{item.rate === null ? "—" : formatINR(item.rate)}</td><td className="numeric">{item.amount === null ? "—" : formatINR(item.amount)}</td><td className="source-ref">{item.sourceRef || "—"}</td></tr>)}</tbody></table></div></section>
        {selected.status === "approved" && <section className="panel"><div className="panel-header"><div><h2>Ask this BOQ</h2><p>Answers cite item numbers and source rows.</p></div></div><form className="panel-body form-stack" onSubmit={askBoq}><label className="field">Your question<textarea className="textarea" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Which items cover excavation? Explain item 4 in simple language…" /></label><button className="button button-primary" disabled={busy || !question.trim()}>{busy ? "Reviewing BOQ…" : "Ask the BOQ"}</button>{answer && <div className="alert alert-info"><strong>Answer</strong><p>{answer.answer}</p>{answer.sourceRefs.length > 0 && <p><strong>Sources:</strong> {answer.sourceRefs.join(" · ")}</p>}{answer.caveats.length > 0 && <p><strong>Needs confirmation:</strong> {answer.caveats.join(" · ")}</p>}</div>}</form></section>}
        {selected.status !== "approved" && canApprove && <div className="alert alert-info">Review the original document and every extracted item before approval. Approval is recorded with your user account.</div>}
        {selected.status !== "approved" && canApprove && <button className="button button-primary" onClick={() => approveBoq(selected)} disabled={busy}>{busy ? "Approving…" : "Approve BOQ"}</button>}
      </div></section></div>}
    </div>
  );
}
