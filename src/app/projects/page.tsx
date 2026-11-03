"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import { canApproveConstructionRecords, downloadCsv, formatDate, formatINR } from "@/lib/financials";
import { supabase } from "@/lib/supabase";

type Project = { id: string; name: string; project_code: string | null; client_department: string | null; contract_number: string | null; location: string | null; start_date: string | null; expected_completion_date: string | null; contract_value: number | string; budget: number | string; project_manager: string | null; status: string; notes: string | null };
type Site = { id: string; project_id: string; name: string; department: string | null; location: string | null; status: string; notes: string | null };
type ProjectTransaction = { id: string; project_id: string | null; transaction_type: string; amount: number | string; status: string; transaction_date: string };
const emptyProject = { name: "", project_code: "", client_department: "", contract_number: "", location: "", start_date: "", expected_completion_date: "", contract_value: "0", budget: "0", project_manager: "", status: "active", notes: "" };
const departments = ["PMRDA", "PMGSY", "MMGSY", "PWD", "ZP", "Other"];

export default function ProjectsPage() {
  const { organization, user } = useWorkspace();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [transactions, setTransactions] = useState<ProjectTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [selected, setSelected] = useState<Project | null>(null);
  const [projectForm, setProjectForm] = useState(emptyProject);
  const [siteForm, setSiteForm] = useState({ project_id: "", name: "", department: "", location: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const canEdit = canApproveConstructionRecords(organization?.role);

  const loadData = useCallback(async () => {
    if (!organization) return;
    const [projectResult, siteResult, transactionResult] = await Promise.all([
      supabase.from("projects").select("*").eq("organization_id", organization.id).order("created_at", { ascending: false }),
      supabase.from("project_sites").select("*").eq("organization_id", organization.id).order("created_at", { ascending: false }),
      supabase.from("vendor_transactions").select("id, project_id, transaction_type, amount, status, transaction_date").eq("organization_id", organization.id).eq("status", "posted").not("project_id", "is", null).limit(2000),
    ]);
    const firstError = projectResult.error || siteResult.error || transactionResult.error;
    if (firstError) setError("Could not load project data. Check the LeaderCon database migration: " + firstError.message);
    else setError("");
    setProjects((projectResult.data ?? []) as Project[]);
    setSites((siteResult.data ?? []) as Site[]);
    setTransactions((transactionResult.data ?? []) as ProjectTransaction[]);
    setLoading(false);
  }, [organization]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);

  const visibleProjects = useMemo(() => projects.filter((project) => [project.name, project.project_code, project.location, project.client_department, project.contract_number].join(" ").toLowerCase().includes(search.trim().toLowerCase())), [projects, search]);
  const siteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const site of sites) counts.set(site.project_id, (counts.get(site.project_id) ?? 0) + 1);
    return counts;
  }, [sites]);

  function openCreate() {
    setEditing(null);
    setProjectForm(emptyProject);
    setError("");
    setShowProjectForm(true);
  }

  function openEdit(project: Project) {
    setEditing(project);
    setProjectForm({
      name: project.name, project_code: project.project_code ?? "", client_department: project.client_department ?? "",
      contract_number: project.contract_number ?? "", location: project.location ?? "", start_date: project.start_date ?? "",
      expected_completion_date: project.expected_completion_date ?? "", contract_value: String(project.contract_value ?? 0),
      budget: String(project.budget ?? 0), project_manager: project.project_manager ?? "", status: project.status,
      notes: project.notes ?? "",
    });
    setError("");
    setShowProjectForm(true);
  }

  async function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !user || !canEdit) return;
    const contractValue = Number(projectForm.contract_value);
    const budget = Number(projectForm.budget);
    if (!Number.isFinite(contractValue) || contractValue < 0 || !Number.isFinite(budget) || budget < 0) {
      setError("Budget and contract value must be valid non-negative amounts.");
      return;
    }
    setSaving(true);
    const payload = {
      organization_id: organization.id, name: projectForm.name.trim(), project_code: projectForm.project_code.trim() || null,
      client_department: projectForm.client_department.trim() || null, contract_number: projectForm.contract_number.trim() || null,
      location: projectForm.location.trim() || null, start_date: projectForm.start_date || null,
      expected_completion_date: projectForm.expected_completion_date || null, contract_value: contractValue, budget,
      project_manager: projectForm.project_manager.trim() || null, status: projectForm.status,
      notes: projectForm.notes.trim() || null, updated_at: new Date().toISOString(),
    };
    const result = editing
      ? await supabase.from("projects").update(payload).eq("id", editing.id).eq("organization_id", organization.id).select("*").single()
      : await supabase.from("projects").insert({ ...payload, created_by: user.id }).select("*").single();
    setSaving(false);
    if (result.error) {
      setError("Could not save project: " + result.error.message);
      return;
    }
    await supabase.from("audit_logs").insert({ organization_id: organization.id, actor_id: user.id, action: editing ? "project.updated" : "project.created", entity_type: "project", entity_id: result.data.id, metadata: { name: result.data.name } });
    setShowProjectForm(false);
    setNotice(editing ? "Project updated." : "Project created.");
    await loadData();
  }

  async function saveSite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !user || !canEdit) return;
    setSaving(true);
    const { data, error: saveError } = await supabase.from("project_sites").insert({
      organization_id: organization.id, project_id: siteForm.project_id, name: siteForm.name.trim(),
      department: siteForm.department.trim() || null, location: siteForm.location.trim() || null,
      notes: siteForm.notes.trim() || null, created_by: user.id,
    }).select("*").single();
    setSaving(false);
    if (saveError) {
      setError("Could not add site: " + saveError.message);
      return;
    }
    await supabase.from("audit_logs").insert({ organization_id: organization.id, actor_id: user.id, action: "site.created", entity_type: "project_site", entity_id: data.id, metadata: { project_id: data.project_id, name: data.name } });
    setShowSiteForm(false);
    setSiteForm({ project_id: "", name: "", department: "", location: "", notes: "" });
    setNotice("Site added.");
    await loadData();
  }

  async function updateStatus(project: Project, status: string) {
    if (!organization || !user || !canEdit) return;
    const { error: updateError } = await supabase.from("projects").update({ status, updated_at: new Date().toISOString() }).eq("id", project.id).eq("organization_id", organization.id);
    if (updateError) setError("Could not update project status: " + updateError.message);
    else { setNotice("Project status updated."); await loadData(); }
  }

  function exportProjects() {
    downloadCsv("leadercon-projects.csv", [["Project", "Code", "Department", "Contract", "Location", "Status", "Budget INR", "Contract value INR", "Sites"], ...visibleProjects.map((project) => [project.name, project.project_code, project.client_department, project.contract_number, project.location, project.status, project.budget, project.contract_value, siteCounts.get(project.id) ?? 0])]);
  }

  const selectedSites = selected ? sites.filter((site) => site.project_id === selected.id) : [];
  const projectPostedTotal = selected ? transactions.filter((row) => row.project_id === selected.id).reduce((sum, row) => sum + (row.transaction_type === "invoice" ? Number(row.amount) : row.transaction_type === "adjustment" ? Number(row.amount) : 0), 0) : 0;

  return (
    <div>
      <div className="page-heading"><div><p className="eyebrow">Construction delivery</p><h1>Projects & Sites</h1><p>Keep contract, department, budget, location, and site records together.</p></div><div className="page-heading-actions"><button className="button button-secondary" onClick={exportProjects} disabled={!visibleProjects.length}>Export CSV</button>{canEdit && <><button className="button button-secondary" onClick={() => { setSiteForm({ project_id: "", name: "", department: "", location: "", notes: "" }); setShowSiteForm(true); }}>＋ Add site</button><button className="button button-primary" onClick={openCreate}>＋ Add project</button></>}</div></div>
      {notice && <p className="alert alert-success" role="status" style={{ marginBottom: 12 }}>{notice}</p>}
      {error && <p className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      <section className="panel"><div className="panel-header"><div><h2>Project register</h2><p>Budget and contract values are shown directly from project records.</p></div><span className="chip">{visibleProjects.length} projects</span></div>
        <div className="toolbar"><input className="input" placeholder="Search project, code, department, location" aria-label="Search projects" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        {loading ? <div className="loading-card"><span className="spinner" /> Loading projects…</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Project</th><th>Department / client</th><th>Completion</th><th>Sites</th><th>Status</th><th className="numeric">Budget</th><th className="numeric">Contract value</th><th className="numeric">Actions</th></tr></thead><tbody>
          {visibleProjects.map((project) => <tr key={project.id}>
            <td><button className="text-button primary-cell" onClick={() => setSelected(project)}>{project.name}</button><div className="source-ref">{project.project_code || project.contract_number || "No project code"}</div></td>
            <td>{project.client_department || "—"}<div className="source-ref">{project.location || "Location not set"}</div></td>
            <td>{formatDate(project.expected_completion_date)}</td><td>{siteCounts.get(project.id) ?? 0}</td>
            <td><span className="chip chip-neutral">{project.status.replaceAll("_", " ")}</span></td>
            <td className="numeric">{formatINR(project.budget)}</td><td className="numeric">{formatINR(project.contract_value)}</td>
            <td><div className="table-actions"><button className="text-button" onClick={() => setSelected(project)}>View</button>{canEdit && <button className="text-button" onClick={() => openEdit(project)}>Edit</button>}</div></td>
          </tr>)}
          {!visibleProjects.length && <tr><td colSpan={8} className="table-empty">{projects.length ? "No projects match this search." : "No projects in this workspace yet."}</td></tr>}
        </tbody></table></div>}
        <div className="pagination-row"><span>Project departments are editable values such as PMRDA, PMGSY, MMGSY, PWD, or ZP.</span><span>{sites.length} site(s)</span></div>
      </section>

      {showProjectForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowProjectForm(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="project-form-title"><div className="modal-header"><div><h2 id="project-form-title">{editing ? "Edit project" : "Create project"}</h2><p>Project budgets and dates are entered by your team.</p></div><button className="close-button" aria-label="Close" onClick={() => setShowProjectForm(false)}>×</button></div>
        <form onSubmit={saveProject} className="modal-content form-stack"><div className="field-grid field-grid-3">
          <label className="field field-span-2">Project name<input className="input" required maxLength={180} value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} /></label>
          <label className="field">Project code<input className="input" maxLength={80} value={projectForm.project_code} onChange={(event) => setProjectForm({ ...projectForm, project_code: event.target.value })} /></label>
          <label className="field">Client / department<select className="select" value={projectForm.client_department} onChange={(event) => setProjectForm({ ...projectForm, client_department: event.target.value })}><option value="">Select or enter below</option>{departments.map((item) => <option key={item}>{item}</option>)}</select><input className="input" maxLength={120} value={projectForm.client_department} onChange={(event) => setProjectForm({ ...projectForm, client_department: event.target.value })} placeholder="Custom department" /></label>
          <label className="field">Contract number<input className="input" maxLength={100} value={projectForm.contract_number} onChange={(event) => setProjectForm({ ...projectForm, contract_number: event.target.value })} /></label>
          <label className="field">Location<input className="input" maxLength={240} value={projectForm.location} onChange={(event) => setProjectForm({ ...projectForm, location: event.target.value })} /></label>
          <label className="field">Start date<input className="input" type="date" value={projectForm.start_date} onChange={(event) => setProjectForm({ ...projectForm, start_date: event.target.value })} /></label>
          <label className="field">Expected completion<input className="input" type="date" value={projectForm.expected_completion_date} onChange={(event) => setProjectForm({ ...projectForm, expected_completion_date: event.target.value })} /></label>
          <label className="field">Contract value (INR)<input className="input" type="number" min="0" step="0.01" value={projectForm.contract_value} onChange={(event) => setProjectForm({ ...projectForm, contract_value: event.target.value })} /></label>
          <label className="field">Budget (INR)<input className="input" type="number" min="0" step="0.01" value={projectForm.budget} onChange={(event) => setProjectForm({ ...projectForm, budget: event.target.value })} /></label>
          <label className="field">Project manager<input className="input" maxLength={160} value={projectForm.project_manager} onChange={(event) => setProjectForm({ ...projectForm, project_manager: event.target.value })} /></label>
          <label className="field">Status<select className="select" value={projectForm.status} onChange={(event) => setProjectForm({ ...projectForm, status: event.target.value })}>{["planning", "active", "on_hold", "completed", "archived"].map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
          <label className="field field-span-3">Notes<textarea className="textarea" maxLength={2000} value={projectForm.notes} onChange={(event) => setProjectForm({ ...projectForm, notes: event.target.value })} /></label>
        </div>{error && <p role="alert" className="alert alert-error">{error}</p>}<div className="form-actions"><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save project" : "Create project"}</button><button className="button button-secondary" type="button" onClick={() => setShowProjectForm(false)}>Cancel</button></div></form>
      </section></div>}

      {showSiteForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSiteForm(false); }}><section className="modal modal-narrow" role="dialog" aria-modal="true" aria-labelledby="site-form-title"><div className="modal-header"><div><h2 id="site-form-title">Add a project site</h2><p>Sites inherit the organization boundary of their project.</p></div><button className="close-button" aria-label="Close" onClick={() => setShowSiteForm(false)}>×</button></div><form onSubmit={saveSite} className="modal-content form-stack">
        <label className="field">Project<select className="select" required value={siteForm.project_id} onChange={(event) => setSiteForm({ ...siteForm, project_id: event.target.value })}><option value="">Select a project</option>{projects.filter((item) => item.status !== "archived").map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="field">Site name<input className="input" required maxLength={160} value={siteForm.name} onChange={(event) => setSiteForm({ ...siteForm, name: event.target.value })} /></label>
        <label className="field">Department<input className="input" maxLength={120} value={siteForm.department} onChange={(event) => setSiteForm({ ...siteForm, department: event.target.value })} placeholder="PMRDA, PWD, ZP…" /></label>
        <label className="field">Location<input className="input" maxLength={240} value={siteForm.location} onChange={(event) => setSiteForm({ ...siteForm, location: event.target.value })} /></label>
        <label className="field">Notes<textarea className="textarea" maxLength={1000} value={siteForm.notes} onChange={(event) => setSiteForm({ ...siteForm, notes: event.target.value })} /></label>
        {error && <p role="alert" className="alert alert-error">{error}</p>}<div className="form-actions"><button className="button button-primary" disabled={saving || !projects.length}>{saving ? "Saving…" : "Add site"}</button><button className="button button-secondary" type="button" onClick={() => setShowSiteForm(false)}>Cancel</button></div>
      </form></section></div>}

      {selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="project-detail-title"><div className="modal-header"><div><p className="eyebrow">Project dashboard</p><h2 id="project-detail-title">{selected.name}</h2><p>{selected.project_code || selected.contract_number || "No project code"} · {selected.status.replaceAll("_", " ")}</p></div><button className="close-button" aria-label="Close" onClick={() => setSelected(null)}>×</button></div><div className="modal-content stack">
        <div className="metrics-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}><div className="metric-card"><div className="metric-top">Budget</div><p className="metric-value">{formatINR(selected.budget)}</p></div><div className="metric-card"><div className="metric-top">Contract value</div><p className="metric-value">{formatINR(selected.contract_value)}</p></div><div className="metric-card"><div className="metric-top">Posted invoices</div><p className="metric-value">{formatINR(projectPostedTotal)}</p></div></div>
        <section className="panel"><div className="panel-header"><div><h2>Project details</h2><p>Dates: {formatDate(selected.start_date)} – {formatDate(selected.expected_completion_date)}</p></div>{canEdit && <button className="text-button" onClick={() => { setSelected(null); openEdit(selected); }}>Edit details</button>}</div><div className="panel-body muted">{selected.client_department || "Department not set"} · {selected.location || "Location not set"}<br />Contract {selected.contract_number || "not set"} · Manager {selected.project_manager || "not assigned"}<br />{selected.notes || "No notes."}</div></section>
        <section className="panel"><div className="panel-header"><div><h2>Sites</h2><p>Sites associated with this project.</p></div>{canEdit && <button className="text-button" onClick={() => { setSiteForm({ project_id: selected.id, name: "", department: "", location: "", notes: "" }); setShowSiteForm(true); }}>＋ Add site</button>}</div><div className="panel-body data-list">{selectedSites.map((site) => <div key={site.id} className="data-list-row"><span><strong>{site.name}</strong><small>{site.department || "No department"} · {site.location || "No location"}</small></span><span className="chip chip-neutral">{site.status}</span></div>)}{!selectedSites.length && <p className="muted">No sites added to this project.</p>}</div></section>
        {canEdit && <div className="form-actions"><button className="button button-secondary" onClick={() => updateStatus(selected, selected.status === "archived" ? "active" : "archived")}>{selected.status === "archived" ? "Restore project" : "Archive project"}</button><button className="button button-secondary" onClick={() => updateStatus(selected, selected.status === "on_hold" ? "active" : "on_hold")}>{selected.status === "on_hold" ? "Resume project" : "Place on hold"}</button></div>}
      </div></section></div>}
    </div>
  );
}
