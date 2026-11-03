type DemoRow = Record<string, unknown>;
type DemoError = { message: string; code?: string };
type DemoResponse = { data: unknown; error: DemoError | null; count?: number };
type Filter = { kind: "eq" | "neq" | "in" | "not" | "is"; column: string; value: unknown; operator?: string };

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const projectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const siteId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const vendorIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const boqIds = [
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];
const boqItemIds = [
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
];
const bookIds = [
  "88888888-8888-4888-8888-888888888888",
  "99999999-9999-4999-8999-999999999999",
];
const billId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const now = () => new Date().toISOString();
let nextId = 1;
const newId = () => `f0000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

const demoUser = {
  id: userId,
  email: "owner@leadercon.demo",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { full_name: "Demo Owner" },
  created_at: "2026-01-10T09:00:00.000Z",
};

const seed: Record<string, DemoRow[]> = {
  organizations: [
    { id: organizationId, name: "LeaderCon Demo Workspace", created_at: "2026-01-10T09:00:00.000Z" },
  ],
  organization_memberships: [
    { organization_id: organizationId, user_id: userId, role: "owner", created_at: "2026-01-10T09:00:00.000Z" },
  ],
  vendors: [
    { id: vendorIds[0], organization_id: organizationId, created_by: userId, name: "Sahyadri Ready Mix", contact_person: "Anil Patil", phone: "+91 90000 11001", email: "accounts@sahyadri.example", address: "Pune, Maharashtra", category: "Materials", opening_balance: 45000, notes: "Fictional demo supplier", is_archived: false, created_at: "2026-01-12T09:00:00.000Z" },
    { id: vendorIds[1], organization_id: organizationId, created_by: userId, name: "Nirman Steel Traders", contact_person: "Meera Shah", phone: "+91 90000 11002", email: "billing@nirman.example", address: "Pimpri, Maharashtra", category: "Steel", opening_balance: 0, notes: "Fictional demo supplier", is_archived: false, created_at: "2026-02-08T09:00:00.000Z" },
    { id: vendorIds[2], organization_id: organizationId, created_by: userId, name: "Kumar Earthworks", contact_person: "Ravi Kumar", phone: "+91 90000 11003", email: "office@kumar-earthworks.example", address: "Pune, Maharashtra", category: "Labour", opening_balance: 0, notes: "Fictional demo supplier", is_archived: false, created_at: "2026-03-04T09:00:00.000Z" },
  ],
  projects: [
    { id: projectId, organization_id: organizationId, created_by: userId, name: "Kondhwa Road Widening", project_code: "DEMO-PWD-117", client_department: "PWD", contract_number: "DEMO-24-117", location: "Pune, Maharashtra", start_date: "2026-01-15", expected_completion_date: "2026-12-20", contract_value: 16450000, budget: 18000000, project_manager: "Rohan Deshmukh", status: "active", notes: "Fictional preview project", created_at: "2026-01-15T09:00:00.000Z", updated_at: "2026-10-28T09:00:00.000Z" },
  ],
  project_sites: [
    { id: siteId, organization_id: organizationId, project_id: projectId, created_by: userId, name: "North Section · Chainage 0/000–2/400", department: "PWD", location: "Kondhwa, Pune", status: "active", notes: "Fictional demo site", created_at: "2026-01-20T09:00:00.000Z" },
    { id: "d0000000-0000-4000-8000-000000000002", organization_id: organizationId, project_id: projectId, created_by: userId, name: "Drainage Package · Chainage 2/400–3/100", department: "PWD", location: "Kondhwa, Pune", status: "active", notes: "Fictional demo site", created_at: "2026-02-03T09:00:00.000Z" },
  ],
  vendor_transactions: [
    { id: "a1000000-0000-4000-8000-000000000001", organization_id: organizationId, vendor_id: vendorIds[0], project_id: projectId, transaction_type: "invoice", transaction_date: "2026-10-15", reference_number: "DEMO-SRM-104", description: "Ready mix concrete supply", amount: 320000, due_date: "2026-11-14", status: "posted", created_by: userId, created_at: "2026-10-15T09:00:00.000Z" },
    { id: "a1000000-0000-4000-8000-000000000002", organization_id: organizationId, vendor_id: vendorIds[0], project_id: projectId, transaction_type: "payment", transaction_date: "2026-10-22", reference_number: "DEMO-NEFT-041", description: "Part payment for concrete supply", amount: 200000, due_date: null, status: "posted", created_by: userId, created_at: "2026-10-22T09:00:00.000Z" },
    { id: "a1000000-0000-4000-8000-000000000003", organization_id: organizationId, vendor_id: vendorIds[1], project_id: projectId, transaction_type: "invoice", transaction_date: "2026-10-20", reference_number: "DEMO-NST-228", description: "Reinforcement steel", amount: 185000, due_date: "2026-11-19", status: "posted", created_by: userId, created_at: "2026-10-20T09:00:00.000Z" },
    { id: "a1000000-0000-4000-8000-000000000004", organization_id: organizationId, vendor_id: vendorIds[1], project_id: projectId, transaction_type: "payment", transaction_date: "2026-10-25", reference_number: "DEMO-NEFT-044", description: "Part payment for reinforcement steel", amount: 50000, due_date: null, status: "posted", created_by: userId, created_at: "2026-10-25T09:00:00.000Z" },
    { id: "a1000000-0000-4000-8000-000000000005", organization_id: organizationId, vendor_id: vendorIds[2], project_id: projectId, transaction_type: "invoice", transaction_date: "2026-11-01", reference_number: "DEMO-KE-019", description: "Earthwork crew charges", amount: 78000, due_date: "2026-11-30", status: "draft", created_by: userId, created_at: "2026-11-01T09:00:00.000Z" },
    { id: "a1000000-0000-4000-8000-000000000006", organization_id: organizationId, vendor_id: vendorIds[2], project_id: projectId, transaction_type: "payment", transaction_date: "2026-10-29", reference_number: "DEMO-LAB-012", description: "Labour payment", amount: 36000, due_date: null, status: "posted", created_by: userId, created_at: "2026-10-29T09:00:00.000Z" },
    { id: "a1000000-0000-4000-8000-000000000007", organization_id: organizationId, vendor_id: vendorIds[2], project_id: projectId, transaction_type: "invoice", transaction_date: "2026-10-28", reference_number: "DEMO-LAB-011", description: "Masonry crew labour cost", amount: 45600, due_date: "2026-11-27", status: "posted", created_by: userId, created_at: "2026-10-28T09:00:00.000Z" },
  ],
  invoice_allocations: [
    { id: "b1000000-0000-4000-8000-000000000001", organization_id: organizationId, invoice_transaction_id: "a1000000-0000-4000-8000-000000000001", payment_transaction_id: "a1000000-0000-4000-8000-000000000002", amount: 200000, created_by: userId, created_at: "2026-10-22T09:00:00.000Z" },
    { id: "b1000000-0000-4000-8000-000000000002", organization_id: organizationId, invoice_transaction_id: "a1000000-0000-4000-8000-000000000003", payment_transaction_id: "a1000000-0000-4000-8000-000000000004", amount: 50000, created_by: userId, created_at: "2026-10-25T09:00:00.000Z" },
    { id: "b1000000-0000-4000-8000-000000000003", organization_id: organizationId, invoice_transaction_id: "a1000000-0000-4000-8000-000000000007", payment_transaction_id: "a1000000-0000-4000-8000-000000000006", amount: 36000, created_by: userId, created_at: "2026-10-29T09:00:00.000Z" },
  ],
  boqs: [
    { id: boqIds[0], organization_id: organizationId, project_id: projectId, site_id: siteId, name: "Kondhwa Road · BOQ Rev 2", version_number: 2, revision_date: "2026-09-10", status: "approved", total_amount: 4844000, storage_path: `${organizationId}/${userId}/demo-boq.pdf`, file_name: "demo-road-boq.pdf", mime_type: "application/pdf", file_size_bytes: 184320, created_at: "2026-09-10T09:00:00.000Z" },
    { id: boqIds[1], organization_id: organizationId, project_id: projectId, site_id: siteId, name: "Drainage Schedule · Review Draft", version_number: 1, revision_date: "2026-10-26", status: "review", total_amount: 740000, storage_path: `${organizationId}/${userId}/demo-drainage-boq.pdf`, file_name: "demo-drainage-boq.pdf", mime_type: "application/pdf", file_size_bytes: 102400, created_at: "2026-10-26T09:00:00.000Z" },
  ],
  boq_items: [
    { id: boqItemIds[0], organization_id: organizationId, boq_id: boqIds[0], item_number: "1.01", description: "Granular sub-base, compacted", unit: "m³", quantity: 420, rate: 1850, amount: 777000, specification: "As per approved specification", source_ref: "BOQ p. 4, item 1.01", confidence: 1 },
    { id: boqItemIds[1], organization_id: organizationId, boq_id: boqIds[0], item_number: "1.02", description: "M25 reinforced concrete", unit: "m³", quantity: 160, rate: 9600, amount: 1536000, specification: "Design mix", source_ref: "BOQ p. 7, item 1.02", confidence: 1 },
    { id: "70000000-0000-4000-8000-000000000003", organization_id: organizationId, boq_id: boqIds[1], item_number: "2.01", description: "RCC drain cover slab", unit: "m", quantity: 240, rate: 3083.33, amount: 740000, specification: "Review quantity against drawing", source_ref: "Schedule p. 2, item 2.01", confidence: 0.94 },
  ],
  measurement_books: [
    { id: bookIds[0], organization_id: organizationId, number: "DEMO-MB-014", project_id: projectId, site_id: siteId, measured_on: "2026-10-24", status: "approved", created_at: "2026-10-24T09:00:00.000Z", storage_path: `${organizationId}/${userId}/demo-mb-014.pdf`, file_name: "demo-mb-014.pdf", mime_type: "application/pdf", file_size_bytes: 142000 },
    { id: bookIds[1], organization_id: organizationId, number: "DEMO-MB-015", project_id: projectId, site_id: siteId, measured_on: "2026-10-31", status: "review", created_at: "2026-10-31T09:00:00.000Z", storage_path: `${organizationId}/${userId}/demo-mb-015.pdf`, file_name: "demo-mb-015.pdf", mime_type: "application/pdf", file_size_bytes: 153000 },
  ],
  measurement_entries: [
    { id: "80000000-0000-4000-8000-000000000003", organization_id: organizationId, measurement_book_id: bookIds[0], boq_item_id: boqItemIds[0], item_number: "1.01", description: "Granular sub-base, compacted", length: 120, width: 3.5, height_depth: 0.1, units_count: 10, quantity: 420, unit: "m³", source_ref: "MB-014 p. 3" },
    { id: "80000000-0000-4000-8000-000000000004", organization_id: organizationId, measurement_book_id: bookIds[0], boq_item_id: boqItemIds[1], item_number: "1.02", description: "M25 reinforced concrete", length: 20, width: 4, height_depth: 0.2, units_count: 8, quantity: 128, unit: "m³", source_ref: "MB-014 p. 6" },
    { id: "80000000-0000-4000-8000-000000000005", organization_id: organizationId, measurement_book_id: bookIds[1], boq_item_id: boqItemIds[1], item_number: "1.02", description: "M25 reinforced concrete", length: 24, width: 4, height_depth: 0.2, units_count: 8, quantity: 153.6, unit: "m³", source_ref: "MB-015 p. 2" },
  ],
  contractor_bills: [
    { id: billId, organization_id: organizationId, project_id: projectId, site_id: siteId, vendor_id: vendorIds[0], bill_number: "DEMO-RAB-006", bill_date: "2026-10-30", previous_amount: 450000, current_amount: 384000, deductions: 28500, tax_amount: 69120, net_payable: 874620, status: "review", created_at: "2026-10-30T09:00:00.000Z" },
  ],
  contractor_bill_items: [
    { id: "90000000-0000-4000-8000-000000000003", organization_id: organizationId, contractor_bill_id: billId, boq_item_id: boqItemIds[1], measurement_entry_id: null, item_number: "1.02", description: "M25 reinforced concrete", quantity: 40, rate: 9600, amount: 384000, source_ref: "MB-014 p. 6" },
  ],
  contractor_bill_ledger_links: [],
  documents: [
    { id: "f1000000-0000-4000-8000-000000000001", organization_id: organizationId, uploader_id: userId, project_id: projectId, vendor_id: vendorIds[0], transaction_id: "a1000000-0000-4000-8000-000000000001", document_type: "invoice", file_name: "demo-srm-invoice-104.pdf", storage_path: `${organizationId}/${userId}/demo-srm-invoice-104.pdf`, mime_type: "application/pdf", file_size_bytes: 184320, status: "uploaded", created_at: "2026-10-15T09:00:00.000Z" },
    { id: "f1000000-0000-4000-8000-000000000002", organization_id: organizationId, uploader_id: userId, project_id: projectId, vendor_id: null, transaction_id: null, document_type: "other", file_name: "demo-site-instruction-026.pdf", storage_path: `${organizationId}/${userId}/demo-site-instruction-026.pdf`, mime_type: "application/pdf", file_size_bytes: 118000, status: "review", created_at: "2026-10-28T09:00:00.000Z" },
  ],
  procurement_records: [
    { id: "f2000000-0000-4000-8000-000000000001", organization_id: organizationId, project_id: projectId, site_id: siteId, vendor_id: vendorIds[1], material_name: "TMT steel Fe 500D", category: "Reinforcement", quantity: 12, unit: "MT", unit_rate: 64200, amount: 770400, order_date: "2026-10-18", reference_number: "DEMO-PO-044", status: "part_received", notes: "Fictional sample order" },
    { id: "f2000000-0000-4000-8000-000000000002", organization_id: organizationId, project_id: projectId, site_id: siteId, vendor_id: vendorIds[0], material_name: "Ready mix concrete M25", category: "Concrete", quantity: 45, unit: "m³", unit_rate: 9200, amount: 414000, order_date: "2026-10-22", reference_number: "DEMO-PO-047", status: "ordered", notes: "Fictional sample order" },
    { id: "f2000000-0000-4000-8000-000000000003", organization_id: organizationId, project_id: projectId, site_id: siteId, vendor_id: vendorIds[0], material_name: "Granular sub-base", category: "Roadworks", quantity: 180, unit: "m³", unit_rate: 1750, amount: 315000, order_date: "2026-10-12", reference_number: "DEMO-PO-039", status: "delivered", notes: "Fictional sample order" },
  ],
  labour_records: [
    { id: "f3000000-0000-4000-8000-000000000001", organization_id: organizationId, project_id: projectId, site_id: siteId, vendor_id: vendorIds[2], category: "Masonry crew", work_date: "2026-10-29", workers_count: 8, days: 6, rate: 950, amount: 45600, work_description: "Drainage headwall masonry", payment_status: "partially_paid" },
    { id: "f3000000-0000-4000-8000-000000000002", organization_id: organizationId, project_id: projectId, site_id: siteId, vendor_id: vendorIds[2], category: "Roadwork helpers", work_date: "2026-10-27", workers_count: 12, days: 4, rate: 720, amount: 34560, work_description: "Sub-base spreading and compaction support", payment_status: "unpaid" },
  ],
  labour_payment_links: [
    { id: "f4000000-0000-4000-8000-000000000001", organization_id: organizationId, labour_record_id: "f3000000-0000-4000-8000-000000000001", transaction_id: "a1000000-0000-4000-8000-000000000006", amount: 36000, payment_date: "2026-10-29", created_at: "2026-10-29T09:00:00.000Z" },
  ],
  audit_logs: [],
};

const demoFiles = new Map<string, Blob>();
for (const row of seed.documents) {
  if (typeof row.storage_path === "string") demoFiles.set(row.storage_path, new Blob([`Fictional LeaderCon preview file: ${row.file_name}`], { type: "text/plain" }));
}

function rowsFor(table: string) { return seed[table] ?? (seed[table] = []); }

function relationValue(row: DemoRow, path: string): unknown {
  const [first, ...rest] = path.split(".");
  if (first === "boq") {
    const related = rowsFor("boqs").find((candidate) => candidate.id === row.boq_id);
    return rest.length ? rest.reduce<unknown>((value, key) => value && typeof value === "object" ? (value as DemoRow)[key] : undefined, related) : related;
  }
  if (first === "book") {
    const related = rowsFor("measurement_books").find((candidate) => candidate.id === row.measurement_book_id);
    return rest.length ? rest.reduce<unknown>((value, key) => value && typeof value === "object" ? (value as DemoRow)[key] : undefined, related) : related;
  }
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as DemoRow)[key] : undefined, row);
}

function enrich(table: string, row: DemoRow): DemoRow {
  if (table === "organization_memberships") return { ...row, organization: rowsFor("organizations").find((organization) => organization.id === row.organization_id) ?? null };
  if (table === "boq_items") return { ...row, boq: rowsFor("boqs").find((boq) => boq.id === row.boq_id) ?? null };
  if (table === "measurement_entries") return { ...row, book: rowsFor("measurement_books").find((book) => book.id === row.measurement_book_id) ?? null };
  return { ...row };
}

class DemoQuery implements PromiseLike<DemoResponse> {
  private operation: "select" | "insert" | "update" | "delete" = "select";
  private filters: Filter[] = [];
  private sorters: Array<{ column: string; ascending: boolean }> = [];
  private maxRows: number | null = null;
  private writeRows: DemoRow[] = [];
  private writePatch: DemoRow = {};
  private returnRows = false;
  private countRequested = false;
  private headOnly = false;
  private rowMode: "many" | "single" | "maybeSingle" = "many";

  constructor(private readonly table: string) {}
  select(_columns = "*", options?: { count?: string; head?: boolean }) { this.returnRows = this.operation !== "select"; this.countRequested = options?.count === "exact"; this.headOnly = Boolean(options?.head); return this; }
  eq(column: string, value: unknown) { this.filters.push({ kind: "eq", column, value }); return this; }
  neq(column: string, value: unknown) { this.filters.push({ kind: "neq", column, value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ kind: "in", column, value }); return this; }
  is(column: string, value: unknown) { this.filters.push({ kind: "is", column, value }); return this; }
  not(column: string, operator: string, value: unknown) { this.filters.push({ kind: "not", column, operator, value }); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.sorters.push({ column, ascending: options?.ascending !== false }); return this; }
  limit(value: number) { this.maxRows = value; return this; }
  single() { this.rowMode = "single"; return this; }
  maybeSingle() { this.rowMode = "maybeSingle"; return this; }
  insert(values: DemoRow | DemoRow[]) { this.operation = "insert"; this.writeRows = Array.isArray(values) ? values : [values]; return this; }
  update(values: DemoRow) { this.operation = "update"; this.writePatch = values; return this; }
  delete() { this.operation = "delete"; return this; }
  upsert(values: DemoRow | DemoRow[]) { return this.insert(values); }

  private matches(row: DemoRow) {
    return this.filters.every((filter) => {
      const actual = relationValue(row, filter.column);
      if (filter.kind === "eq" || filter.kind === "is") return actual === filter.value;
      if (filter.kind === "neq") return actual !== filter.value;
      if (filter.kind === "in") return Array.isArray(filter.value) && filter.value.includes(actual);
      if (filter.kind === "not" && filter.operator === "is") return actual !== filter.value;
      return true;
    });
  }

  private async execute(): Promise<DemoResponse> {
    const tableRows = rowsFor(this.table);
    let resultRows: DemoRow[] = [];
    if (this.operation === "select") resultRows = tableRows.filter((row) => this.matches(row)).map((row) => enrich(this.table, row));
    else if (this.operation === "insert") {
      resultRows = this.writeRows.map((row) => ({ id: row.id ?? newId(), created_at: row.created_at ?? now(), ...row }));
      tableRows.push(...resultRows);
    } else if (this.operation === "update") {
      resultRows = tableRows.filter((row) => this.matches(row));
      for (const row of resultRows) Object.assign(row, this.writePatch);
      resultRows = resultRows.map((row) => enrich(this.table, row));
    } else {
      resultRows = tableRows.filter((row) => this.matches(row));
      for (const row of resultRows) tableRows.splice(tableRows.indexOf(row), 1);
    }
    for (const sorter of [...this.sorters].reverse()) {
      resultRows.sort((a, b) => {
        const left = relationValue(a, sorter.column);
        const right = relationValue(b, sorter.column);
        const comparison = left == null && right == null ? 0 : left == null ? -1 : right == null ? 1 : String(left).localeCompare(String(right), undefined, { numeric: true });
        return sorter.ascending ? comparison : -comparison;
      });
    }
    const count = resultRows.length;
    if (this.maxRows !== null) resultRows = resultRows.slice(0, this.maxRows);
    let data: unknown = this.returnRows ? resultRows : this.operation === "select" ? resultRows : null;
    if (this.operation === "select" && this.headOnly) data = null;
    if (this.rowMode === "single") {
      if (resultRows.length === 0) return { data: null, error: { message: "No demo row matched the query.", code: "PGRST116" }, count: this.countRequested ? count : undefined };
      data = resultRows[0];
    } else if (this.rowMode === "maybeSingle") data = resultRows[0] ?? null;
    return { data, error: null, count: this.countRequested ? count : undefined };
  }

  then<TResult1 = DemoResponse, TResult2 = never>(
    onfulfilled?: ((value: DemoResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> { return this.execute().then(onfulfilled, onrejected); }
}

function rpcResult(data: unknown = null): DemoResponse { return { data, error: null }; }
function rpcError(message: string): DemoResponse { return { data: null, error: { message } }; }
function byId(table: string, id: unknown) { return rowsFor(table).find((row) => row.id === id); }
function transactionSign(row: DemoRow) {
  const amount = Number(row.amount ?? 0);
  if (row.status !== "posted") return 0;
  if (["payment", "advance", "credit_note"].includes(String(row.transaction_type))) return -Math.abs(amount);
  if (row.transaction_type === "invoice") return Math.abs(amount);
  return row.transaction_type === "adjustment" ? amount : 0;
}

function vendorBalances(orgId: unknown) {
  return rowsFor("vendors").filter((vendor) => vendor.organization_id === orgId && vendor.is_archived !== true).map((vendor) => {
    const ledger = rowsFor("vendor_transactions").filter((entry) => entry.organization_id === orgId && entry.vendor_id === vendor.id).reduce((sum, entry) => sum + transactionSign(entry), 0);
    return { vendor_id: vendor.id, vendor_name: vendor.name, opening_balance: Number(vendor.opening_balance ?? 0), ledger_total: ledger, outstanding_balance: Number(vendor.opening_balance ?? 0) + ledger };
  }).sort((a, b) => String(a.vendor_name).localeCompare(String(b.vendor_name)));
}

function invoiceBalances(orgId: unknown) {
  return rowsFor("vendor_transactions").filter((invoice) => invoice.organization_id === orgId && invoice.transaction_type === "invoice" && invoice.status === "posted").map((invoice) => {
    const paid = rowsFor("invoice_allocations").filter((allocation) => allocation.invoice_transaction_id === invoice.id && allocation.organization_id === orgId).reduce((sum, allocation) => sum + Number(allocation.amount ?? 0), 0);
    const amount = Math.abs(Number(invoice.amount ?? 0));
    return { invoice_id: invoice.id, vendor_id: invoice.vendor_id, invoice_amount: amount, paid_amount: paid, outstanding_amount: Math.max(amount - paid, 0) };
  }).sort((a, b) => String(byId("vendor_transactions", b.invoice_id)?.transaction_date).localeCompare(String(byId("vendor_transactions", a.invoice_id)?.transaction_date)));
}

function insertRow(table: string, row: DemoRow) {
  const saved = { id: row.id ?? newId(), created_at: row.created_at ?? now(), ...row };
  rowsFor(table).push(saved);
  return saved;
}

function executeRpc(name: string, args: DemoRow): DemoResponse {
  const orgId = args.p_organization_id ?? organizationId;
  switch (name) {
    case "get_vendor_balances": return rpcResult(vendorBalances(orgId));
    case "get_invoice_balances": return rpcResult(invoiceBalances(orgId));
    case "get_vendor_bank_details": return rpcResult([]);
    case "get_organization_members": return rpcResult(rowsFor("organization_memberships").filter((row) => row.organization_id === orgId).map((row) => ({ member_user_id: row.user_id, email: row.demo_email ?? demoUser.email, role: row.role, joined_at: row.created_at })));
    case "rename_organization": { const organization = byId("organizations", orgId); if (organization) organization.name = args.p_name; return rpcResult(true); }
    case "add_organization_member": {
      const email = String(args.p_email ?? "").trim();
      if (!email) return rpcError("Enter an email address.");
      const memberId = newId();
      rowsFor("organization_memberships").push({ organization_id: orgId, user_id: memberId, role: args.p_role, created_at: now(), demo_email: email });
      return rpcResult(memberId);
    }
    case "set_organization_member_role": { const member = rowsFor("organization_memberships").find((row) => row.organization_id === orgId && row.user_id === args.p_user_id); if (member) member.role = args.p_role; return rpcResult(true); }
    case "create_vendor_transaction_idempotent": {
      const key = String(args.p_idempotency_key ?? "");
      const existing = rowsFor("vendor_transactions").find((row) => row.demo_idempotency_key === key && key);
      if (existing) return rpcResult(existing.id);
      const vendor = byId("vendors", args.p_vendor_id);
      const amount = Number(args.p_amount);
      const type = String(args.p_transaction_type ?? "");
      const status = String(args.p_status ?? "posted");
      if (!vendor || vendor.organization_id !== orgId) return rpcError("Select a vendor in the demo workspace.");
      if (!Number.isFinite(amount) || amount === 0 || (type !== "adjustment" && amount < 0)) return rpcError("Enter a valid transaction amount.");
      if (!["invoice", "payment", "credit_note", "advance", "adjustment"].includes(type) || !["posted", "draft"].includes(status)) return rpcError("Unsupported demo transaction.");
      const allocations = Array.isArray(args.p_allocations) ? args.p_allocations as DemoRow[] : [];
      if (allocations.length && (type !== "payment" || status !== "posted")) return rpcError("Only posted demo payments can be allocated to invoices.");
      let allocationTotal = 0;
      for (const allocation of allocations) {
        const invoice = byId("vendor_transactions", allocation.invoice_id);
        const allocationAmount = Number(allocation.amount);
        const alreadyPaid = rowsFor("invoice_allocations").filter((row) => row.invoice_transaction_id === allocation.invoice_id).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
        if (!invoice || invoice.organization_id !== orgId || invoice.vendor_id !== args.p_vendor_id || invoice.transaction_type !== "invoice" || invoice.status !== "posted") return rpcError("An allocation references an invalid demo invoice.");
        if (allocationAmount <= 0 || alreadyPaid + allocationAmount > Math.abs(Number(invoice.amount))) return rpcError("An invoice allocation exceeds the remaining demo balance.");
        allocationTotal += allocationAmount;
      }
      if (allocationTotal > Math.abs(amount)) return rpcError("Invoice allocations cannot exceed the payment amount.");
      const transaction = insertRow("vendor_transactions", { organization_id: orgId, vendor_id: args.p_vendor_id, project_id: args.p_project_id ?? null, transaction_type: type, transaction_date: args.p_transaction_date, reference_number: args.p_reference_number ?? null, description: args.p_description ?? null, amount, due_date: args.p_due_date ?? null, status, created_by: userId, demo_idempotency_key: key });
      for (const allocation of allocations) insertRow("invoice_allocations", { organization_id: orgId, invoice_transaction_id: allocation.invoice_id, payment_transaction_id: transaction.id, amount: Number(allocation.amount), created_by: userId });
      return rpcResult(transaction.id);
    }
    case "record_labour_payment": {
      const labour = byId("labour_records", args.p_labour_record_id);
      const amount = Number(args.p_amount);
      if (!labour || labour.organization_id !== orgId || !labour.vendor_id) return rpcError("Choose a linked demo labour record.");
      const paid = rowsFor("labour_payment_links").filter((row) => row.labour_record_id === labour.id).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
      if (amount <= 0 || amount > Number(labour.amount) - paid) return rpcError("The payment exceeds the remaining demo labour amount.");
      const transaction = insertRow("vendor_transactions", { organization_id: orgId, vendor_id: labour.vendor_id, project_id: labour.project_id, transaction_type: "payment", transaction_date: args.p_payment_date, reference_number: "DEMO-LAB-PAY", description: `Labour payment · ${labour.category}`, amount, due_date: null, status: "posted", created_by: userId });
      insertRow("labour_payment_links", { organization_id: orgId, labour_record_id: labour.id, transaction_id: transaction.id, amount, payment_date: args.p_payment_date });
      return rpcResult(transaction.id);
    }
    case "save_boq_review": {
      const items = Array.isArray(args.p_items) ? args.p_items as DemoRow[] : [];
      const total = items.reduce((sum, item) => sum + (item.quantity != null && item.rate != null ? Number(item.quantity) * Number(item.rate) : Number(item.amount ?? 0)), 0);
      const boq = insertRow("boqs", { organization_id: orgId, project_id: args.p_project_id ?? null, site_id: args.p_site_id ?? null, name: args.p_name, version_number: 1, revision_date: args.p_revision_date ?? null, status: "review", total_amount: total, storage_path: args.p_storage_path, file_name: args.p_file_name, mime_type: args.p_mime_type, file_size_bytes: args.p_file_size_bytes });
      for (const item of items) insertRow("boq_items", { organization_id: orgId, boq_id: boq.id, item_number: item.itemNumber ?? null, description: item.description, unit: item.unit ?? null, quantity: item.quantity ?? null, rate: item.rate ?? null, amount: item.amount ?? null, specification: item.specification ?? null, source_ref: item.sourceRef ?? null, confidence: item.confidence ?? 1 });
      return rpcResult(boq.id);
    }
    case "approve_boq": { const boq = byId("boqs", args.p_boq_id); if (!boq || boq.organization_id !== orgId) return rpcError("Demo BOQ not found."); boq.status = "approved"; return rpcResult(true); }
    case "save_measurement_review": {
      const entries = Array.isArray(args.p_entries) ? args.p_entries as DemoRow[] : [];
      const book = insertRow("measurement_books", { organization_id: orgId, number: args.p_number, project_id: args.p_project_id ?? null, site_id: args.p_site_id ?? null, measured_on: args.p_measured_on ?? null, status: "review", storage_path: args.p_storage_path, file_name: args.p_file_name, mime_type: args.p_mime_type, file_size_bytes: args.p_file_size_bytes });
      for (const entry of entries) insertRow("measurement_entries", { organization_id: orgId, measurement_book_id: book.id, boq_item_id: entry.boqItemId ?? null, item_number: entry.itemNumber ?? null, description: entry.description, length: entry.length ?? null, width: entry.width ?? null, height_depth: entry.heightDepth ?? null, units_count: entry.unitsCount ?? 1, quantity: entry.quantity ?? 0, unit: entry.unit ?? null, source_ref: entry.sourceRef ?? null });
      return rpcResult(book.id);
    }
    case "approve_measurement_book": { const book = byId("measurement_books", args.p_book_id); if (!book || book.organization_id !== orgId) return rpcError("Demo Measurement Book not found."); book.status = "approved"; return rpcResult(true); }
    case "save_contractor_bill_review": {
      const items = Array.isArray(args.p_items) ? args.p_items as DemoRow[] : [];
      const current = items.reduce((sum, item) => sum + Number(item.quantity ?? 0) * Number(item.rate ?? 0), 0);
      const previous = Number(args.p_previous_amount ?? 0);
      const deductions = Number(args.p_deductions ?? 0);
      const tax = Number(args.p_tax_amount ?? 0);
      const bill = insertRow("contractor_bills", { organization_id: orgId, project_id: args.p_project_id ?? null, site_id: args.p_site_id ?? null, vendor_id: args.p_vendor_id ?? null, bill_number: args.p_bill_number, bill_date: args.p_bill_date, previous_amount: previous, current_amount: current, deductions, tax_amount: tax, net_payable: previous + current - deductions + tax, status: "review" });
      for (const item of items) insertRow("contractor_bill_items", { organization_id: orgId, contractor_bill_id: bill.id, boq_item_id: item.boq_item_id ?? null, measurement_entry_id: item.measurement_entry_id ?? null, item_number: item.item_number ?? null, description: item.description, quantity: Number(item.quantity ?? 0), rate: Number(item.rate ?? 0), amount: Number(item.quantity ?? 0) * Number(item.rate ?? 0), source_ref: item.source_ref ?? null });
      return rpcResult(bill.id);
    }
    case "approve_contractor_bill": { const bill = byId("contractor_bills", args.p_bill_id); if (!bill || bill.organization_id !== orgId) return rpcError("Demo contractor bill not found."); bill.status = "approved"; return rpcResult(true); }
    case "post_contractor_bill_to_ledger": {
      const bill = byId("contractor_bills", args.p_bill_id);
      if (!bill || bill.organization_id !== orgId || bill.status !== "approved") return rpcError("Approve the demo contractor bill before posting.");
      const existing = rowsFor("contractor_bill_ledger_links").find((row) => row.contractor_bill_id === bill.id);
      if (existing) return rpcResult(existing.transaction_id);
      const transaction = insertRow("vendor_transactions", { organization_id: orgId, vendor_id: bill.vendor_id, project_id: bill.project_id, transaction_type: "invoice", transaction_date: bill.bill_date, reference_number: bill.bill_number, description: "Demo contractor bill payable", amount: bill.net_payable, due_date: null, status: "posted", created_by: userId });
      rowsFor("contractor_bill_ledger_links").push({ organization_id: orgId, contractor_bill_id: bill.id, transaction_id: transaction.id, posted_by: userId, created_at: now() });
      return rpcResult(transaction.id);
    }
    default: return rpcResult(null);
  }
}

export function createDemoSupabaseClient() {
  let signedIn = true;
  type AuthCallback = (event: string, session: DemoRow | null) => void;
  const listeners = new Set<AuthCallback>();
  const session = () => signedIn ? { access_token: "local-leadercon-demo-session", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: demoUser } : null;
  const notify = (event: string) => { for (const listener of listeners) listener(event, session()); };
  const auth = {
    getUser: async () => ({ data: { user: signedIn ? demoUser : null }, error: null }),
    getSession: async () => ({ data: { session: session() }, error: null }),
    onAuthStateChange: (callback: AuthCallback) => {
      listeners.add(callback);
      queueMicrotask(() => callback("INITIAL_SESSION", session()));
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    signInWithPassword: async () => { signedIn = true; notify("SIGNED_IN"); return { data: { user: demoUser, session: session() }, error: null }; },
    signOut: async () => { signedIn = false; notify("SIGNED_OUT"); return { error: null }; },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
  };
  const storage = {
    from: (_bucket: string) => ({
      upload: async (path: string, file: Blob) => { demoFiles.set(path, file); return { data: { path }, error: null }; },
      remove: async (paths: string[]) => { for (const path of paths) demoFiles.delete(path); return { data: paths.map((name) => ({ name })), error: null }; },
      createSignedUrl: async (path: string) => {
        const blob = demoFiles.get(path) ?? new Blob([`Fictional local preview file: ${path}`], { type: "text/plain" });
        return { data: { signedUrl: URL.createObjectURL(blob) }, error: null };
      },
    }),
  };
  return {
    auth,
    storage,
    from: (table: string) => new DemoQuery(table),
    rpc: async (name: string, args: DemoRow = {}) => executeRpc(name, args),
  };
}
