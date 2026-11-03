# LeaderCon implementation and handover

> Current staging status is recorded in **Staging verification checkpoint — 3 November 2026** near the end of this document. It supersedes the earlier pending-migration notes below.

## Completed implementation

- Rebranded the app as LeaderCon — Developed by Alesh — with protected responsive workspace navigation and organization setup.
- Added organization and role-aware RLS migrations, safe owner member administration, private document storage, legacy-row isolation, and role-checked bank-detail reads.
- Replaced the sample dashboard with current organization data and deterministic vendor/invoice balances.
- Added vendor archive, profile, secure bank details, optional legacy localStorage import, ledger transactions, invoice allocations, projects, and sites.
- Added private document management, BOQ extraction and human review, immutable BOQ approval/versioning, BOQ questions, Measurement Book extraction/review/comparison, and contractor bill review and payable posting.
- Added procurement records and labour attendance. Labour supplier payments now post to the vendor ledger, link to attendance costs, enforce remaining balances, and write audit entries. Reports, derived in-app notifications, and a workspace-scoped AI accounts assistant are present.
- Added setup instructions, a read-only legacy data inventory, and preserved the pre-change source archive without environment secrets.
- `npm run lint` passes. `npm run build` passes on Next.js 16.4.1 with TypeScript.

## Still required before real use

- The configured Supabase hostname did not resolve for a read-only schema request in this environment. No remote financial data was fetched and no migrations were applied.
- Review the migration files against the actual project schema and policies, take a database backup, then apply them in filename order using the project's normal approval process.
- Create the first workspace owner after migration. Invite/create any other accounts in Supabase Auth before assigning their roles in LeaderCon Settings.
- Map only verified legacy vendor and transaction rows to an organization. Inventory queries are in `supabase/LEGACY_VENDOR_MAPPING_TEMPLATE.sql`; no ownership was guessed.
- Add `OPENAI_API_KEY` to the server-only environment to enable AI workflows. No key was present in the project environment at audit time.
- Test RLS with owner, accountant, site engineer, and auditor accounts using non-production sample data before deployment.

## Current audit continuation

The follow-up review added a detailed status matrix and remaining blockers in [LEADERCON_AUDIT_CHECKLIST.md](./LEADERCON_AUDIT_CHECKLIST.md). It also added local financial unit tests, retry-safe vendor transaction posting, AI input validation and request limits, more restrictive private storage controls, safer legacy status handling, and migration 012 for ledger-linked labour payments. Database-dependent changes are still pending application and live verification.

## Guardrails followed

- No production schema or financial data was changed.
- No demo financial data was used for tests.
- No public deployment or paid-service activation was performed.
- AI output stays a review suggestion; official balances and quantity calculations come from deterministic database logic.

## Staging readiness update — 3 November 2026

- `NEXT_PUBLIC_SUPABASE_URL` is present in `.env.local` and has the expected HTTPS `<project-ref>.supabase.co` shape; its configured host is `zfpllejyxlquidklofdz.supabase.co` (project ref `zfpllejyxlquidklofdz`). The matching `sumanik-accounts` project is present in the signed-in Supabase Dashboard and its status is **paused**. The configured host returned NXDOMAIN from the default resolver and public resolvers 1.1.1.1 and 8.8.8.8. Supabase confirms paused projects stop serving their hostname, which explains the NXDOMAIN ([Supabase NXDOMAIN troubleshooting](https://supabase.com/kb/troubleshooting/nxdomain-error-connecting-to-a-supabase-project)). The user later confirmed this as intended staging, but Dashboard reinspection shows the selected `main` branch labeled **Production**. Reconcile this conflict before resuming or migrating.
- No database connection URL, service-role key, Supabase CLI, or OpenAI key is configured. Secret values were not printed. No remote data was read and no migration or database write was attempted.
- Static review of migrations 001–012 found no `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or bulk `DELETE`. Migration 001 originally altered `public.vendors` before creating it, which would fail on the approved empty staging project. Fixed migration 001 to create the app's base vendor table only when absent, then add its tenant/profile columns; on an existing database the create is a no-op. Existing vendor and ledger rows remain unassigned and unchanged, so tenant-scoped policies hide legacy rows until ownership is verified. Migration 011 removes only a column default and does not rewrite existing status values.
- The migrations depend on Supabase Auth and Storage schemas. Migration 001 creates the private `sumanik-documents` bucket and installs its base policies; `vendor_documents` is optional. Migration 001 caps files at 20 MiB, migration 010 adds an upload MIME allow-list and narrows write roles, migration 008 narrows vendor SELECT grants, and migration 012 revokes direct client UPDATE on labour records. These access changes require live schema and workflow verification before app use.
- After the empty-project fixes, the existing eight local unit tests, ESLint, TypeScript check, and production build pass. This does not verify Supabase SQL, RLS, storage access, financial workflows, or AI provider calls.
- Confirm a current database backup in the Supabase Dashboard under **Database → Backups** and preserve any Storage objects separately: Supabase database backups contain Storage metadata, not the file contents. A Dashboard database export was downloaded and passed gzip integrity checks, but its filename dates it 23 Oct 2026; freshness is unconfirmed. The downloaded Storage ZIP contains zero files, so a Storage-object recovery copy is not verified.
- Migrations are not accompanied by a tested down-migration sequence. A restore or hand-written rollback after application must be planned against the backup and any new staging writes; do not drop financial tables or rewrite legacy ledger rows to roll back.
- Live staging remains blocked until the Dashboard `Production` label is reconciled and the pre-migration database and Storage recovery points are verified. Do not apply these files to a production target.


## Staging checkpoint — 3 November 2026 (latest)

- The user clarified that `sumanik-accounts` is Production and instructed using a different staging project. The Branches page confirms `main` is the Production branch, with no preview branch. A read-only account scan found one organization and one project, so no staging target is available in this signed-in Supabase account.
- The matching project (`zfpllejyxlquidklofdz`) remains paused. The Dashboard says its data, backups, and Storage objects remain safe. This explains the configured hostname's NXDOMAIN; do not replace the project URL.
- Downloaded the Dashboard database backup to `C:\Users\Admin\Downloads\db_cluster-23-10-2026@04-04-43.backup.gz` (52,521 bytes). Gzip integrity/decompression succeeded (346,049 uncompressed bytes); filename dates the export 23 Oct 2026, so recency versus the project's last writes still needs confirmation before migrations.
- Downloaded `C:\Users\Admin\Downloads\zfpllejyxlquidklofdz.storage.zip` (22 bytes). The ZIP is valid but contains zero files. This does not establish a recoverable copy of any Storage objects; the Dashboard's general paused-project assurance is not a separately verified Storage export.
- No live schema or migration history was inspected. Migrations 001–012 remain unapplied. No live rows were queried or changed. A compressed database export from the Production project was downloaded while it was believed to be staging; it remains in Downloads, passed integrity checking only, and was not opened to inspect business data. Existing local validation remains separate from live database verification.
- Next gate: identify an existing staging project or approve creating a new isolated project with an empty database. Do not use the Production export as staging data or recovery point. Once the staging target is available, verify its own backup/recovery path, inspect live schema/migration history, and continue with non-production test accounts. Never run these migrations against a production target without explicit approval.

- Branches-page verification confirms main is the project's **Production branch**; no preview/staging branch currently exists. The project must not be used for staging migrations or test records.

## New staging project — 3 November 2026

- At the user's request, created an empty Supabase project named `leadercon-staging` in the existing Free organization. Project ref: `yxsbvwhytxvxmtzleiaz`; URL: `https://yxsbvwhytxvxmtzleiaz.supabase.co`. Dashboard reports **Healthy**, with no migrations and no project backup. No Production data was cloned.
- Supabase selected Sydney (`ap-southeast-2`) from the Asia-Pacific region choice; Production is Singapore (`ap-southeast-1`). This staging project has a new isolated database; no records are present from Production.
- Data API and automatic table exposure were left enabled. Automatic RLS for new public tables was enabled. Migrations still need to establish and verify each table's grants and policies.
- Updated local `.env.local` `NEXT_PUBLIC_SUPABASE_URL` to the staging URL. The existing `NEXT_PUBLIC_SUPABASE_ANON_KEY` is still from Production and must be replaced before running the app. No key value is shown here.
- Supabase Dashboard confirms the Free plan does not include project backups. A pre-migration logical dump is required. The latest local check found no `SUPABASE_DB_URL` in `.env.local` or the process/user/machine environments, and no Supabase CLI, `pg_dump`, or Docker. The staging URL matches the new project. The present anon JWT's project reference does not match staging; replace it with the staging API key. Reset the staging database password, then copy the exact connection string from the project Dashboard's **Connect** panel into `SUPABASE_DB_URL`; use the Direct connection for `pg_dump` when IPv6 is available, with Session pooler as the IPv4 fallback ([Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres)). Never send either value in chat.
- Do not apply migrations until the local stage credentials are configured and a verified logical backup has been created. Migrations 001–012 remain unapplied.

## Staging verification checkpoint — 3 November 2026

- Target verified as `leadercon-staging` (`yxsbvwhytxvxmtzleiaz`); the configured database host and public URL both match this staging reference. The Production project was not used.
- Read-only database connection reports PostgreSQL 17.11. The pre-migration archive passes `pg_restore --list` and contains 413 TOC entries (294,193 bytes; SHA256 `747FC34A906E790826E6115256C60B176C097DCF6A7BBBABF85F9E1BDBCC351C`). Its public app table/data entries are zero. It was not restored to a separate database, and this Free-plan project has no managed backup.
- Migrations 001–012 were applied one at a time, each in a transaction, and each has a migration-history entry. No migration failed. Supplemental migrations 013 and 014 remove direct `anon` and `PUBLIC` function execution and adjust future public-schema function defaults; they were applied and verified as well. Current history contains 14 records.
- Catalog checks found 21 public app tables with RLS enabled on all 21, no anonymous policies, eight Storage object policies, a private `sumanik-documents` bucket, a 20 MiB limit, and ten allowed MIME types. No public-schema function is executable by `anon` or `PUBLIC`; authenticated access to key balance and posting RPCs remains present. These are structural checks, not behavioral cross-tenant tests.
- No financial or test records were added. Auth, financial workflows, Storage retrieval/denial, cross-tenant behavior, and AI provider calls remain unverified end to end. The local `NEXT_PUBLIC_SUPABASE_ANON_KEY` still references a different project; two confirmed staging test users and a server-only `OPENAI_API_KEY` are also absent.
- Do not use real financial data yet. The core staging app is not production-ready until the key is corrected and the requested authenticated workflow, tenant-isolation, document-access, and AI tests pass.

## Steps to resume staging E2E verification

1. In `C:\Users\Admin\sumanik-accounts\.env.local`, keep `NEXT_PUBLIC_SUPABASE_URL=https://yxsbvwhytxvxmtzleiaz.supabase.co` and replace `NEXT_PUBLIC_SUPABASE_ANON_KEY` with the staging project's client-safe key from **Supabase Dashboard → leadercon-staging → Project Settings → API Keys**. Do not use a secret/service-role key in this browser variable and do not paste keys into chat.
2. Create two confirmed, disposable users under **Authentication → Users** in the staging project. For the verification session only, place their email/password values in local variables named `LEADERCON_TEST_USER_A_EMAIL`, `LEADERCON_TEST_USER_A_PASSWORD`, `LEADERCON_TEST_USER_B_EMAIL`, and `LEADERCON_TEST_USER_B_PASSWORD`; do not commit or share them.
3. Add `OPENAI_API_KEY` to the server-only local environment if AI provider success tests are required. Keep it out of `NEXT_PUBLIC_*` variables and browser code.
4. Recheck that the public URL and key reference match the staging project, then run `npm run dev` from this directory and open `http://localhost:3000`. Do not start E2E testing until those checks pass.
5. Migrations 001–014 are already recorded in this staging database. Do not reapply them. Before future database work, confirm the connected project ref and migration history, and take a fresh logical backup.
