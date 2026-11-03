"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { leaderConFileMimeType, validateLeaderConFile } from "@/lib/document-files";
import { formatDate } from "@/lib/financials";
import { supabase } from "@/lib/supabase";

type Project = { id: string; name: string };
type Vendor = { id: string; name: string };
type DocumentRow = { id: string; document_type: string; file_name: string; storage_path: string; mime_type: string | null; file_size_bytes: number | null; status: string; project_id: string | null; vendor_id: string | null; created_at: string };
const documentTypes = ["invoice", "contract", "boq", "measurement_book", "purchase_order", "delivery_note", "receipt", "other"];

export default function DocumentsPage() {
  const { organization, user } = useWorkspace();
  const [projects, setProjects] = useState<Project[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("other");
  const [projectId, setProjectId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canUpload = ["owner", "accountant", "project_manager", "site_engineer"].includes(organization?.role || "");

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [d, p, v] = await Promise.all([
      supabase.from("documents").select("id, document_type, file_name, storage_path, mime_type, file_size_bytes, status, project_id, vendor_id, created_at").eq("organization_id", organization.id).order("created_at", { ascending: false }).limit(1000),
      supabase.from("projects").select("id, name").eq("organization_id", organization.id).neq("status", "archived").order("name"),
      supabase.from("vendors").select("id, name").eq("organization_id", organization.id).eq("is_archived", false).order("name"),
    ]);
    const loadError = d.error || p.error || v.error;
    setError(loadError ? "Could not load documents: " + loadError.message : "");
    setDocuments((d.data ?? []) as DocumentRow[]); setProjects((p.data ?? []) as Project[]); setVendors((v.data ?? []) as Vendor[]); setLoading(false);
  }, [organization]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !user || !file) { setError("Choose a document to upload."); return; }
    const validationError = validateLeaderConFile(file);
    const mimeType = leaderConFileMimeType(file);
    if (validationError || !mimeType) { setError(validationError || "Unsupported document type."); return; }
    setBusy(true); setError(""); setNotice("");
    const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const storagePath = organization.id + "/" + user.id + "/" + crypto.randomUUID() + "-" + safeName;
    try {
      const { error: uploadError } = await supabase.storage.from("sumanik-documents").upload(storagePath, file, { contentType: mimeType, upsert: false });
      if (uploadError) throw uploadError;
      const { error: metadataError } = await supabase.from("documents").insert({ organization_id: organization.id, uploader_id: user.id, project_id: projectId || null, vendor_id: vendorId || null, document_type: documentType, file_name: file.name, storage_path: storagePath, mime_type: mimeType, file_size_bytes: file.size, status: "uploaded" });
      if (metadataError) {
        await supabase.storage.from("sumanik-documents").remove([storagePath]);
        throw metadataError;
      }
      setNotice("Document uploaded to the private company workspace."); setFile(null); setProjectId(""); setVendorId(""); await loadData();
    } catch (cause) { setError(cause instanceof Error ? "Upload failed: " + cause.message : "Document upload failed."); }
    finally { setBusy(false); }
  }

  async function openDocument(document: DocumentRow) {
    setError("");
    const { data, error: signedError } = await supabase.storage.from("sumanik-documents").createSignedUrl(document.storage_path, 60);
    if (signedError || !data?.signedUrl) { setError("Could not create a private document link: " + (signedError?.message || "try again")); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const projectName = (id: string | null) => projects.find((row) => row.id === id)?.name || "—";
  const vendorName = (id: string | null) => vendors.find((row) => row.id === id)?.name || "—";
  const filtered = documents.filter((row) => [row.file_name, row.document_type, projectName(row.project_id), vendorName(row.vendor_id)].join(" ").toLowerCase().includes(search.trim().toLowerCase()));

  return <div>
    <div className="page-heading"><div><p className="eyebrow">Private records</p><h1>Documents</h1><p>Keep source files in a private bucket and open them using short-lived signed links.</p></div></div>
    {notice && <p className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</p>}{error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
    <div className="content-grid" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(300px, .75fr)", alignItems: "start" }}>
      <section className="panel"><div className="panel-header"><div><h2>Document register</h2><p>Only members of this workspace can create a temporary open link.</p></div><span className="chip">{documents.length} files</span></div>
        <div className="toolbar"><input className="input" placeholder="Search file, project, vendor" aria-label="Search documents" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        {loading ? <div className="loading-card"><span className="spinner" /> Loading documents…</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>File</th><th>Type</th><th>Linked to</th><th>Added</th><th>Status</th><th></th></tr></thead><tbody>
          {filtered.map((row) => <tr key={row.id}><td><strong>{row.file_name}</strong><div className="source-ref">{row.file_size_bytes ? (row.file_size_bytes / 1048576).toFixed(2) + " MB" : ""}</div></td><td style={{ textTransform: "capitalize" }}>{row.document_type.replaceAll("_", " ")}</td><td>{row.project_id ? projectName(row.project_id) : vendorName(row.vendor_id)}</td><td>{formatDate(row.created_at.slice(0, 10))}</td><td><span className="chip chip-neutral">{row.status}</span></td><td><button className="text-button" onClick={() => void openDocument(row)}>Open privately</button></td></tr>)}
          {!filtered.length && <tr><td colSpan={6} className="table-empty">{documents.length ? "No files match your search." : "No documents uploaded yet."}</td></tr>}
        </tbody></table></div>}
        <div className="pagination-row"><span>Private storage · member scoped</span><span>{filtered.length} shown</span></div>
      </section>
      {canUpload ? <section className="panel"><div className="panel-header"><div><h2>Upload a document</h2><p>Upload once. Link it to a project or vendor for easier review.</p></div></div>
        <form className="panel-body form-stack" onSubmit={upload}>
          <label className="field">File<input className="input" type="file" accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.doc,.docx,.csv,.txt" required onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); setError(next ? validateLeaderConFile(next) : ""); }} /><small className="source-ref">PDF, PNG, JPG/JPEG, Excel, Word, CSV, or text. Maximum 20 MB. Access follows your workspace membership.</small></label>
          <label className="field">Document type<select className="select" value={documentType} onChange={(event) => setDocumentType(event.target.value)}>{documentTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
          <label className="field">Project<select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">No project link</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="field">Vendor<select className="select" value={vendorId} onChange={(event) => setVendorId(event.target.value)}><option value="">No vendor link</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
          <button className="button button-primary" disabled={busy || !file}>{busy ? "Uploading…" : "Upload privately"}</button>
        </form>
      </section> : <section className="panel"><div className="panel-body muted">Your workspace role can view documents but cannot upload them.</div></section>}
    </div>
    <p className="credit-line">AI analysis sends selected files to the configured provider only after a user starts analysis. General documents are not analyzed automatically.</p>
  </div>;
}
