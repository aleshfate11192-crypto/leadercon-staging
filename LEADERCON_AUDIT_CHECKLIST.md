# LeaderCon project audit and continuation

Audit date: 3 November 2026

> For the latest verified staging state, use **Current staging verification — 3 November 2026** near the end of this document. Earlier pending-gate notes are historical.

This audit reviewed the app structure, README and development plan, the original 11 SQL migrations, client authentication and workspace access, storage policies, AI route, and the main feature screens. It added migration 012 for linked labour payments. The project directory is not a git checkout, so this report records the changes and checks directly.

## Status checklist

| Area | Status | What is present and what remains |
|---|---|---|
| Branding and navigation | Implemented locally | LeaderCon shell and “Developed by Alesh” credit are present. The unused connection test route, no-op vendor layout, and obsolete localStorage vendor page were removed. |
| Authentication and workspaces | Implemented; live test blocked | Supabase email/password sign-in, password reset, organization setup, workspace switching, role-aware navigation, and sign-out are wired. Owner membership administration depends on the migrations and existing Supabase Auth accounts. Sign-in and sign-out could not be exercised. |
| Vendor directory and ledger | Implemented; live test blocked | Vendor create/edit/archive, bank-detail RPC, ledger entries, invoices, payments, advances, credits, adjustments, invoice allocations, account history, CSV export, and vendor document attachments are wired to Supabase. New transaction retries use an idempotency key in the client and database wrapper. No live create/edit/payment/balance/statement test was possible. |
| Projects and sites | Implemented; live test blocked | Project and site creation, editing/status handling, date/budget fields, vendor and operational links, and project filtering in related forms are present. No live record or cross-workspace reference test was possible. |
| BOQ extraction and review | Implemented in part | PDF, image, spreadsheet, Word, CSV, and text inputs can be reviewed before saving. Source files remain private; quantities × rates are deterministic; source-only amounts are labeled; duplicate item numbers are flagged. Missing items include rate outlier analysis, unit/specification discrepancy checks, broad searchable/paginated BOQ history, and AI contractor bill review. The extraction provider path has not been exercised. |
| Measurement Books | Implemented in part | Dimensions and measured quantities are recorded, source references are retained, and comparisons require matching explicit units. Repeated source references are flagged. A Measurement Book is not linked to one selected BOQ version, so a complete “missing BOQ items” check cannot be reliable yet. Review does not include an inline stored-source preview. No live extraction or comparison was tested. |
| Contractor bills | Implemented in part | Draft review from approved BOQ/measurement rows, deterministic amounts, approval, and one-time payable posting are present. Tax and deduction fields are manual amounts with zero defaults; there are no configurable jurisdiction rules, AI bill review, bill-attachment screen, or bill payment status panel. Payments can be recorded in the vendor ledger. No live approval/posting test was possible. |
| Procurement | Incomplete | The current register records material, supplier, quantity, rate, date, project/site, and a delivery status. It does not model quotations, requisition-to-purchase-order conversion, receipt quantities/documents, or payment tracking as linked ledger records. |
| Labour | Implemented in part | The register calculates worker-count × days × rate. Migration 012 and the updated screen add partial/full supplier payments posted to the vendor ledger, per-record payment links, retry protection, an overpayment guard, and audit entries. The migration removes direct client UPDATE access to labour records and forces new records to start unpaid. Legacy manual `paid`/`partial` values without ledger links are flagged for review. Worker-level attendance, wage advances, individual worker payments, and payment-proof attachments remain unimplemented. Payments require a linked supplier and an owner/accountant role. |
| Documents | Implemented in part | Private bucket uploads, 20 MiB size checks, MIME allow-list settings, role-aware storage controls, and short-lived signed open links are present or added in pending migration 010. Document metadata supports project/vendor links and construction records are linked during their review saves. General document replacement, deletion, in-app Office preview, and links to every transaction/bill type are not finished. Direct browser uploads rely on Supabase's size/MIME allow-list and the uploaded content type; deep server-side content inspection and malware scanning are not implemented. |
| AI assistant | Implemented in part; provider blocked | The server-only Responses API supports BOQ/Measurement Book extraction, approved BOQ questions, and an accounts assistant. Request bodies are bounded, uploaded AI files are signature-checked, provider errors do not echo raw provider details, and migration 010 adds a database-backed per-user limit of six requests per minute. Document summarization, contractor bill review, full natural-language search, and AI follow-up suggestions are not implemented. `OPENAI_API_KEY` is absent, so provider calls were not tested. |
| Reports and notifications | Implemented in part | Reports and follow-ups read Supabase data. Several queries use fixed limits (up to 3,000 rows) and a report table shows at most 1,000 rows; there is no server pagination. Large workspaces can therefore have incomplete visible/exported activity. |
| Security and RLS | Static review complete; live verification blocked | Organization-scoped RLS, role checks, private storage policies, bank-detail RPC, approval locks, tenant-reference triggers, and audit functions were reviewed. Migrations 010/011 add request controls and tighten storage write roles. Policies have not been exercised against the configured database or separate role accounts. |

## Local changes made in this continuation

- Added eight Node built-in unit tests for ledger signs/balances, labour payment balances, unit comparability, formula-safe CSV cells, and valid/invalid AI file payloads.
- Added `npm test` and updated the README with local validation commands.
- Added database idempotency for vendor transaction submissions and persisted the retry key for the current browser session.
- Bounded AI request-body reads, checked file size, extension/MIME agreement and common file signatures, and returned generic provider errors.
- Added a Postgres per-user AI request limiter and restrictive Storage upload/update/delete role policies in migration 010.
- Removed the implicit `draft` status default from the pending foundation migration. Added migration 011 to drop that default without changing existing transaction rows if the earlier migration version was already applied.
- Added explicit BOQ source-amount labeling, duplicate item-number warnings, and measurement unit-mismatch checks.
- Added migration 012 and a payment workflow that posts supplier payments to the vendor ledger and links them to labour entries. Legacy manual payment flags are not treated as verified ledger payments.
- Updated this checklist, the README, and development plan to avoid treating unverified screens as end-to-end complete.

## Migration status

The 12 requested migrations were applied incrementally to the verified staging project on 3 November 2026. Each completed in its own transaction and was recorded in `supabase_migrations.schema_migrations`; none failed. Supplemental migrations 013–014 were then applied to correct Supabase's default function ACLs. The current catalog and E2E status are summarized in the latest verification table below.

1. [x] `202611030001_leadercon_foundation.sql`
2. [x] `202611030002_accounting_workflows.sql`
3. [x] `202611030003_deterministic_balances.sql`
4. [x] `202611030004_construction_workflows.sql`
5. [x] `202611030005_approval_controls.sql`
6. [x] `202611030006_contractor_bill_posting.sql`
7. [x] `202611030007_workspace_administration.sql`
8. [x] `202611030008_vendor_privacy_and_write_controls.sql`
9. [x] `202611030009_tenant_reference_integrity.sql`
10. [x] `202611030010_request_controls.sql`
11. [x] `202611030011_legacy_status_default_safety.sql`
12. [x] `202611030012_labour_payments.sql`
13. [x] `202611030013_public_function_acl.sql` — removes direct `anon` execution and updates future public-schema function defaults.
14. [x] `202611030014_public_execute_acl.sql` — removes `PUBLIC` execution and its future default for public-schema functions.

Migration 001 now adds legacy `vendor_transactions.status` without a default, leaving existing rows unclassified. Migration 011 only removes the column default; it does not update or delete transaction rows. Do not backfill old rows or assign them to an organization until an administrator verifies ownership and records the mapping.

## Test results

| Check | Result |
|---|---|
| `npm test` | Pass: eight unit tests. |
| `npm run lint` | Pass. |
| `npm run build` | Pass on Next.js 16.4.1; routes compile and static pages generate. |
| `npx tsc --noEmit` | Pass. |
| Supabase schema / integration / RLS tests | Blocked: the configured Supabase hostname returned DNS NXDOMAIN. No records were fetched. |
| Sign-in, sign-out, financial workflow E2E, private-file retrieval, cross-tenant denial | Blocked: no reachable Supabase project or test accounts. |
| AI provider success/failure tests | Blocked: no `OPENAI_API_KEY`. The local file validator has unit coverage. |
| Mobile browser workflow test | Not run: there is no browser E2E setup or signed-in test workspace. Responsive styles are present but not validated at runtime. |

## Environment and local run

Required for the app to connect:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional, required for AI features:

- `OPENAI_API_KEY` (server-side only)
- `OPENAI_MODEL` (optional; defaults to `gpt-6-astra`)

From `C:\Users\Admin\sumanik-accounts`:

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. Do not overwrite an existing `.env.local`; copy `.env.example` to that filename only when creating a new local environment.

## Supabase setup and deployment path

1. Confirm the project URL and anon key refer to the intended Supabase project and that its hostname resolves.
2. Back up the database and use a staging project first. Inspect the existing `vendors`, `vendor_transactions`, `vendor_documents`, and Storage schema/policies against all migration assumptions.
3. Apply migrations 001–012 in order on staging. Verify that no legacy row has been assigned to a workspace and no financial amount or status value was rewritten.
4. Create owner, accountant, project-manager, site-engineer, auditor, and second-organization test accounts. Verify each allowed and denied table/RPC/Storage operation, especially bank-detail reads, transaction posting/retries, labour payment limits, and cross-organization file access.
5. Run the local commands below, then exercise the workflows with non-production records and files. Confirm vendor balances, payment allocations, partial/full labour payments, and overpayment rejection from the database.
6. Configure Supabase Auth redirect URLs and email/password policies for the deployment hostname. Add the public Supabase URL/anon key and server-only AI key to the hosting environment; never set a service-role key in client variables.
7. Build with `npm run build` and run the Node server with `npm run start`, or use a compatible Next.js host. Keep production migrations behind the project's normal backup and approval process.

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## Readiness decision

**Not safe to use as the production accounting system yet.** The live schema and RLS remain unverified, all migrations are pending, the required end-to-end financial and file workflows could not be run, and procurement/labour/payment/document features listed as incomplete above still need implementation. Use only a controlled staging database with test records until these blockers are resolved.

## Staging connectivity and migration safety update — 3 November 2026

### Connectivity diagnosis

The configured `.env.local` URL is syntactically valid and uses Supabase's normal `https://<project-ref>.supabase.co` API hostname format. Its project ref is `zfpllejyxlquidklofdz`. The signed-in Dashboard contains the matching `sumanik-accounts` project and marks it **paused**. DNS returned NXDOMAIN from the default resolver and from 1.1.1.1 and 8.8.8.8. Supabase documents that paused projects stop serving their hostnames and therefore resolve as NXDOMAIN ([Supabase troubleshooting](https://supabase.com/kb/troubleshooting/nxdomain-error-connecting-to-a-supabase-project)); this is the confirmed cause, not a malformed URL. The project is in a Free organization. The user clarified it is Production; the Dashboard header and Branches page confirm `main` is the Production branch. A read-only scan found this is the only project in the signed-in account; no staging target was found. No keys were printed and no live rows were queried.

The matching Production project is paused and will remain untouched. Supabase says Free projects retain data while paused and can be resumed from the project list ([Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). The signed-in account has no separate staging project. Identify an existing staging project in another account/organization or approve creating an empty isolated staging project. Once available, set the matching project URL and anon key only in local `.env.local`; never send keys in chat. Supabase documents Connect as the source for project URL and API key ([Supabase API routes](https://supabase.com/docs/guides/api/creating-routes)).

### Migration 001–012 static review

All 12 files were reviewed in filename order. Static SQL review found no table/column drops, truncations, or bulk row deletions. This is not equivalent to applying them against a live schema: migration state, actual types/columns, existing policies, and Postgres execution remain unverified.

| Migration | Purpose and review notes |
|---|---|
| 001 foundation | Creates organizations/memberships and construction/workspace tables; adds tenant/profile fields to vendors/transactions; installs RLS and private document storage policies. Static review found a blank-database blocker: it altered `public.vendors` before creating it. Fixed by adding a `CREATE TABLE IF NOT EXISTS` for the app's base vendor fields before those alterations; this is a no-op when the table already exists. Legacy vendor/ledger rows remain unassigned and inaccessible until verified mapping. Requires Supabase Auth and Storage schemas; `vendor_documents` is optional because the current app upload widget now stores metadata in tenant-scoped `documents`. Creates/locks `sumanik-documents` private and caps files at 20 MiB. |
| 002 accounting | Adds invoice allocation records and role-checked atomic vendor ledger posting. New records are posted through the function; allocation amounts are constrained and audit logged. Existing financial rows are not rewritten. |
| 003 balances | Adds caller/RLS-respecting vendor and invoice balance functions. No data mutation. |
| 004 construction | Adds document links and save/review RPCs for BOQs, Measurement Books, and contractor bills. Creates review records only when app RPCs are called. |
| 005 approval controls | Adds approval/immutability triggers and role-checked approval RPCs. Replaces same-named triggers idempotently; no existing records are bulk transitioned. |
| 006 contractor bill posting | Adds a one-to-one bill/payable link and posts a ledger invoice only when the authenticated owner/accountant invokes the RPC for an approved bill. No initial posting occurs during migration. |
| 007 workspace administration | Adds owner-checked membership/role and organization rename RPCs. No memberships or organizations are created during migration. |
| 008 vendor privacy/write controls | Revokes broad vendor SELECT and grants only non-bank columns; bank fields use a role-checked RPC. Tightens finance and document approval writes. Existing clients that select `*` or need omitted columns must be verified. |
| 009 tenant references | Adds triggers that reject parent/source records from another organization. Triggers are installed, but existing rows are not backfilled or audited by this migration. Check old cross-tenant references before relying on it. |
| 010 request controls | Adds AI rate-limit and transaction idempotency tables/functions; restricts storage writes by organization role and updates the bucket MIME allow-list. The bucket update affects upload configuration, not stored file contents. |
| 011 legacy status safety | Drops only the default on `vendor_transactions.status`; does not change existing status values. Depends on migration 001 having established that column. |
| 012 labour payments | Adds ledger-payment links and a retry-safe payment RPC with an overpayment guard/audit. Revokes direct authenticated UPDATE on `labour_records`; payment status changes happen through the RPC. It does not normalize any legacy paid flags. |

### Data assumptions, risks, and rollback

- Applying RLS can make old records disappear from normal authenticated app queries. That is deliberate for rows with no verified organization. Do not bulk-assign them or use financial records as test data.
- Before migration, compare the staging `vendors`, `vendor_transactions`, optional `vendor_documents`, Storage bucket and policies, existing RLS policies, and all function signatures/column types with the SQL. `CREATE TABLE IF NOT EXISTS` does not reconcile an incompatible pre-existing table.
- Existing broad grants/policies and project-specific triggers need live review. In particular, verify tenant-scoped SELECT behavior for every pre-existing table and confirm non-members cannot access Storage objects through any other permissive policy.
- Migration 001 changes the bucket's public flag and size cap; migration 010 restricts MIME types. Database backups do not include stored file contents, so preserve needed Storage objects separately. Supabase documents Dashboard backups under **Database → Backups** and notes that Storage objects are excluded ([Supabase database backups](https://supabase.com/docs/guides/platform/backups)).
- Migrations 008 and 012 intentionally narrow database privileges. Verify client reads, writes, payment RPCs, roles, and legacy UI compatibility before using staging.
- There is no tested automatic down migration. Do not reverse by dropping tables or changing ledger data. Record a backup/restore point before applying; if rollback becomes necessary, stop staging writes and restore/repair from the reviewed recovery plan. Confirmed staging only, never production without explicit approval.

### Historical gate (superseded by the latest staging verification below)

The following checkpoint described the earlier state before the staging database URL and backup were configured. Use the current staging verification table below for migration, schema, security, and E2E status.

## Current staging verification — 3 November 2026 (supersedes the earlier pending status)

| Verification | Result | Evidence / remaining work |
|---|---|---|
| Staging target and database connection | Pass | URL and connection project refs both match `yxsbvwhytxvxmtzleiaz`; PostgreSQL 17.11. Production was not targeted. |
| Pre-migration backup | Pass with limit | `pg_restore --list` reads the 413-entry archive; 294,193 bytes; SHA256 `747FC34A906E790826E611525C60B176C097DCF6A7BBBABF85F9E1BDBCC351C`. No restore test was performed; Free plan has no managed backup. |
| Migrations 001–012 | Pass | Applied incrementally, each in its own transaction; all recorded; no migration failed. |
| ACL remediation | Pass | Supplemental migrations 013–014 remove `anon` and `PUBLIC` function execution; authenticated critical RPC grants remain. Future public-schema function defaults exclude both. |
| DDL object inventory | Pass | All 21 declared tables, 25 `ALTER TABLE ... ADD COLUMN` fields, 13 explicit indexes, 30 function names, 22 explicit/dynamic triggers, and 30 named policies were found; none are missing. The catalog has 118 validated constraints and 39 valid public indexes, with no disabled app triggers. |
| Tables and RLS | Structural pass | 21 public tables; RLS enabled on all 21; zero anon policies. Behavioral tenant-isolation tests remain pending. |
| Storage controls | Structural pass | Private bucket, 20 MiB limit, ten MIME types, eight object policies, and zero anon policies. Authorized retrieval and unauthorized denial are not yet exercised through the API. |
| Authentication and financial E2E | Blocked | The local anon key belongs to another project; no staging test accounts are configured. Sign-in, vendor/invoice/payment flows, balances, labour payment, and overpayment denial remain untested. |
| Construction/document E2E | Blocked | BOQ, Measurement Book, discrepancy review, contractor-bill posting, upload, authorized retrieval, and cross-tenant denial remain untested. |
| AI provider | Blocked | No server-side `OPENAI_API_KEY`; provider extraction, assistant, document-type, timeout, and rate-limit behavior remain untested. |
| Real financial data readiness | No | Do not enter real financial records until the remaining behavioral and end-to-end checks pass. |
