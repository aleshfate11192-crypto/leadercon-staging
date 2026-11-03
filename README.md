# LeaderCon

LeaderCon is a construction accounts and project workspace, developed by Alesh. It replaces the original Sumanik Accounts prototype with organization-scoped vendors, a posted financial ledger, projects and sites, private documents, BOQ and Measurement Book reviews, contractor bills, procurement, labour, reports, derived follow-ups, and a workspace-scoped AI assistant.

## Run locally

1. Install Node.js 20.9 or later and run `npm install`.
2. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the intended Supabase project. These are the browser-safe project URL and anon key. Never put a service-role key in a `NEXT_PUBLIC_` variable.
3. Configure email/password sign-in and the local redirect URL (`http://localhost:3000`) in Supabase Auth.
4. Review and apply the SQL migrations in `supabase/migrations/` in filename order against the target project's current schema and RLS policies. They are never run by the app. Check [LEADERCON_AUDIT_CHECKLIST.md](./LEADERCON_AUDIT_CHECKLIST.md) for the current project-specific migration status.
5. Start the app with `npm run dev`; open `http://localhost:3000` and sign in.
6. Create the company workspace from the first-run setup screen. The first signed-in user becomes its owner.
7. To use AI extraction or the accounts assistant, set `OPENAI_API_KEY` in the server-only `.env.local` file. `OPENAI_MODEL` is optional; the app defaults to `gpt-6-astra`. Restart the server after changing environment variables.

### Local preview without Supabase

To explore the interface with fictional in-memory records and no cloud calls, open PowerShell in the project folder and run:

```powershell
$env:NEXT_PUBLIC_LEADERCON_DEMO_MODE = "true"
$env:NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321"
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "local-demo-key-not-used"
$env:SUPABASE_DB_URL = ""
$env:OPENAI_API_KEY = ""
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`. The demo uses fictitious data, keeps changes in memory, and disables Supabase, file storage, and AI provider calls. Demo changes disappear when the server restarts.

## Main workflows

- **Vendors and accounts:** create and archive suppliers, review a vendor ledger, post invoices, payments, advances, credits, and adjustments, allocate payments to invoices, and export CSV reports. Posted balances are calculated in SQL. Draft transactions do not affect official balances.
- **Projects:** manage projects, sites, budget, contract value, dates, and status.
- **Documents:** upload to a private Supabase Storage bucket and open files with short-lived signed URLs.
- **BOQ Intelligence:** upload a BOQ for AI extraction or enter lines manually; verify quantities, rates, amounts, and source references; approve drafts; ask questions against approved items.
- **Measurement Books:** extract or enter dimensions and measured quantities, link rows to approved BOQ items, compare measured and planned quantities, and approve the review.
- **Contractor bills:** build review drafts from approved BOQ and Measurement Book lines, approve them, and post an approved payable to the vendor ledger exactly once. Payments are recorded from Transactions.
- **Operations and insights:** track procurement delivery status and labour attendance. Owners/accountants can post partial or full payments for a labour supplier; each payment is linked to the labour cost and posted to that vendor's ledger. Inspect reports and in-app follow-ups derived from overdue invoices and review queues.
- **Workspace access:** owners can assign roles to existing Supabase Auth accounts. Create or invite the account in Supabase Auth first, then add its email from Settings.

## Data and security notes

- All client database requests use the signed-in user's Supabase session and organization-scoped RLS. No service-role key is used by the app.
- The first migration intentionally leaves existing vendor and transaction rows with `organization_id IS NULL`; the new tenant policies will not show those rows until an administrator verifies and maps them. `supabase/LEGACY_VENDOR_MAPPING_TEMPLATE.sql` contains read-only inventory queries. Do not bulk-assign legacy records without confirming their ownership and taking a backup.
- Vendor bank columns are not selectable directly by authenticated clients. Owners and accountants read them through a role-checked RPC. The UI also hides those fields from other roles.
- Uploaded files are stored in the private `sumanik-documents` bucket under organization and uploader folders. Applying the first migration sets the bucket private and configures the 20 MB limit.
- Applying migrations 010–012 adds database-backed AI request limits, retry-safe transaction posting, storage MIME and write-role controls, removes an implicit status default without changing existing transaction values, and enables ledger-linked labour payments. Existing manual labour payment flags without linked ledger entries are flagged for review.
- AI document analysis runs only after a user selects a file and starts analysis. The request is authenticated and organization-scoped, uses the OpenAI Responses API with `store: false`, and returns structured suggestions for review. AI does not approve records or post accounting entries. The configured provider receives the selected file or workspace context.
- The accounts assistant receives full database-calculated vendor balances and a limited recent transaction sample. It is not an accounting system of record.
- No production migration, data mapping, or deployment has been performed as part of the implementation.

## Legacy vendor rows

Before applying the migrations, inspect the current database and take a backup. After applying them and creating a workspace, an administrator can review unassigned vendor IDs using the read-only template in `supabase/LEGACY_VENDOR_MAPPING_TEMPLATE.sql`. Map only rows that are confirmed to belong to that organization, and map any legacy transaction rows consistently. Keep an audit record of the mapping. The app does not guess which company owns existing rows.

## Validation

Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` before deployment. Review all SQL migrations against the actual Supabase schema, test RLS with separate owner, accountant, site engineer, and auditor accounts using non-production sample data, then deploy only through the project's normal approval process.

See [LEADERCON_AUDIT_CHECKLIST.md](./LEADERCON_AUDIT_CHECKLIST.md) for the current verified, incomplete, and blocked items. The local unit tests do not replace Supabase integration or browser workflow tests.

## Attribution

**LeaderCon — Developed by Alesh**
