# LeaderCon Development Log

## 3 November 2026 — Implementation and validation

- Read the full shared LeaderCon brief and audited the existing Next.js/Supabase project, current routes, login, vendor implementation, storage component, dependencies, and installed Next.js guidance.
- Created a source-only pre-change archive at the current task workspace `work/sumanik-accounts-before-changes.zip`. It excludes `.env.local`, `node_modules`, and generated build output.
- Replaced the demo home screen with a live dashboard and added the responsive branded workspace shell, organization setup, roles, and Settings administration.
- Implemented organization-scoped schema and RLS migrations, private storage, bank-detail privacy, ledger RPCs and balances, invoice allocations, immutable construction approvals, and one-time contractor bill posting.
- Implemented vendor, transaction, project/site, private document, BOQ, Measurement Book, contractor bill, procurement, labour, report, notification, and assistant routes.
- Added migration/bootstrap notes and a read-only legacy-row inventory template. Existing unassigned data remains untouched.
- `npm run lint` passed.
- `npm run build` passed; all application routes compiled and prerendered or were marked dynamic as intended.
- A read-only Supabase schema request could not resolve the configured host. No remote rows were fetched and no remote migrations, financial data, or deployment changes were made.
- No `OPENAI_API_KEY` was present in the configured project environment. AI routes return a setup message until the server-only key is added.

## Handover dependencies

- Verify the current Supabase schema and RLS policies, take a backup, and apply migrations in filename order through the project's approved process.
- Create the first workspace and assign existing Auth accounts from Settings.
- Carefully map legacy rows only after ownership is confirmed.
- Test the role matrix against a non-production Supabase project before deployment.

## 3 November 2026 — Production-readiness audit continuation

- Reviewed all 11 migrations, application routes, authentication/workspace context, storage access, AI API, and feature data operations. Added `LEADERCON_AUDIT_CHECKLIST.md` with verified, incomplete, and blocked items.
- Stopped migration 001 from assigning `draft` status to legacy transactions. Added migration 011 to remove an existing status default without rewriting rows.
- Added migration 010 for atomic AI request limits, idempotent transaction retries, storage MIME restrictions, and role-aware file updates/deletes.
- Hardened AI request size limits, file signature checks, and provider error responses. AI provider calls remain untested because the key is absent.
- Added Node unit coverage for ledger math, labour payment balances, units, CSV safety, and AI file validation (eight tests pass).
- Replaced ambiguous BOQ amount labels and added duplicate-number and measurement-unit warnings.
- Removed the unused connection-test route and dead vendor backup page. No user or database records were deleted.
- Added migration 012 and an owner/accountant-only RPC to post retry-safe supplier payments against labour costs, link each posted transaction, enforce the remaining balance, and audit the payment. The Labour screen now derives paid and due amounts from those links and flags old manual statuses for reconciliation.
- `npm test` passes eight tests, `npm run lint` passes, `npx tsc --noEmit` passes, and `npm run build` passes after the labour workflow changes.
- Live Supabase integration, RLS, auth, mobile, and financial workflow tests remain blocked or unrun because the configured Supabase host returned DNS NXDOMAIN and no test accounts exist. The shared ChatGPT page could not be fetched; the full attached brief was used.
- No migration or database record was applied or changed; all 12 migrations remain pending.

## 3 November 2026 — Staging connectivity and migration review

- Re-checked the `.env.local` Supabase URL without printing any key. Its URL format and project-ref hostname shape are valid, but the configured host returned NXDOMAIN from the default resolver and public resolvers 1.1.1.1 and 8.8.8.8.
- The project state cannot be determined from DNS. The host could belong to a mistyped/retired ref or a paused, deleted, or recreated project; only the owning Supabase Dashboard can resolve that. No replacement URL was guessed.
- Confirmed there is no configured `SUPABASE_DB_URL`, service-role key, OpenAI key, or installed Supabase CLI. No remote query, data fetch, migration, or write was performed.
- Reviewed migrations 001–012 in order. No table/column drops, truncations, or bulk deletes were found. Recorded the dependencies, nullable/unmapped legacy financial rows, RLS/privilege changes, bucket privacy/size/MIME changes, cascade behavior, and missing tested down-migration path in the audit checklist and development plan.
- No migration was applied in this session. Remote migration history remains unverified (handover reports all 12 pending); staging identity and backup are unconfirmed. No financial records were accessed or changed.
- User action needed: confirm the intended non-production project/reference and state in Supabase Dashboard, update only the local `.env.local` from that project's Connect dialog (do not send keys in chat), and confirm a current database backup plus separate Storage-object preservation. Then continue with live schema inspection and staged migration/test work.


## 3 November 2026 — Supabase dashboard diagnosis

- With the user's approval to proceed, checked the signed-in Supabase Dashboard read-only. The configured project ref `zfpllejyxlquidklofdz` matches the existing `sumanik-accounts` project, which the Dashboard marks **paused** in a Free organization.
- Confirmed the DNS root cause: Supabase's current troubleshooting documentation says paused projects stop serving their hostname and resolve as NXDOMAIN. The configured URL format/reference is correct; the project was not missing from the signed-in organization.
- Project APIs and Connect are disabled while paused. Dashboard does not label it staging versus production, and no backup/restore point or Storage-object backup could be verified in the paused state. No project was resumed, no migration was applied, and no records were accessed or changed.
- Next required decision: user must confirm this project is the non-production staging target before resuming it. After resume, create and verify a database export and preserve Storage objects separately, then inspect migration state/schema and proceed with migrations and test accounts.

## 3 November 2026 — Dashboard and backup checkpoint

- The user confirmed that `sumanik-accounts` is intended as staging and authorized proceeding. On reinspection, the selected Dashboard branch is explicitly labeled `main Production`, so staging identity conflicts with the Dashboard label and needs reconciliation before any resume or schema change.
- Confirmed that the matching project remains paused. Dashboard reports paused data/backups/storage remain safe; the configured hostname's NXDOMAIN is consistent with Supabase's paused-project behavior.
- Downloaded the database export to `C:\Users\Admin\Downloads\db_cluster-23-10-2026@04-04-43.backup.gz`; it is 52,521 bytes and passes gzip decompression/integrity checks (346,049 uncompressed bytes). Its filename indicates 23 Oct 2026; backup recency relative to the last database writes is not confirmed.
- Downloaded the Storage export to `C:\Users\Admin\Downloads\zfpllejyxlquidklofdz.storage.zip`; the ZIP is valid but contains zero files. Storage-object preservation is therefore not verified.
- No project resume, database connection, live schema/history inspection, migration, record read/write, or AI provider call occurred. All 12 migrations remain pending. No financial data was changed.
- Next action requires resolving why the Dashboard identifies the selected branch as `Production`, plus confirming a current pre-migration recovery point. After that, resume the intended staging target and continue with live schema/security review and tests using test accounts and records only.

- Read-only Branches page check confirms main is the Production branch and the project has no preview/staging branch. No branch was created and no production action was taken.

## 3 November 2026 — Production target excluded; staging project search

- The user clarified `sumanik-accounts` is Production and instructed using another staging project. Left it paused and made no schema, database, or project changes.
- Read-only Supabase account scan found one organization and one project only; its sole project is `sumanik-accounts` with `main` as the Production branch. No existing staging project is visible in this signed-in account.
- The compressed database export downloaded before the clarification remains at `C:\Users\Admin\Downloads\db_cluster-23-10-2026@04-04-43.backup.gz`. It was checked for gzip integrity only and not inspected for business data. The separate Storage ZIP contains zero files. These are not accepted as staging recovery artifacts.
- No live rows were queried or changed; all 12 migrations remain unapplied. The staging project must be identified in another organization/account or its creation explicitly approved before any live database work.

## 3 November 2026 — Empty staging project created

- Following the user's approval, created a new empty Supabase project `leadercon-staging` in the existing Free organization. Project ref `yxsbvwhytxvxmtzleiaz`; URL `https://yxsbvwhytxvxmtzleiaz.supabase.co`. Dashboard status is Healthy; no migrations, backup, or user data are present. Production data was not copied.
- Supabase selected Sydney (`ap-southeast-2`) for the Asia-Pacific region option; Production is Singapore (`ap-southeast-1`). Data API/table exposure remain enabled and automatic RLS for new public tables is enabled.
- Changed only `NEXT_PUBLIC_SUPABASE_URL` in local `.env.local` to the new staging URL. The anon key is still the old Production key and must be replaced before using the app.
- The Dashboard reports Free plan has no project backups. `SUPABASE_DB_URL`, Supabase CLI, `pg_dump`, and Docker are not configured locally. The generated project database password was not retained, so reset it in Dashboard and set the exact connection string locally to create a logical backup before migrations.
- Migrations 001–012 remain unapplied. No live rows were queried or changed; no test users or test data have been created.

## 3 November 2026 — Fresh-install migration review

- Rechecked the local staging environment without printing secret values. `NEXT_PUBLIC_SUPABASE_URL` matches project `yxsbvwhytxvxmtzleiaz`; an anon key is present but its project association is not verified. `SUPABASE_DB_URL` is not present yet. No Supabase CLI, `pg_dump`, `psql`, or Docker command is available.
- Reviewed migration files 001–012 in filename order for destructive statements, dependencies, data assumptions, RLS/storage changes, and rollback considerations. No table/column drops, truncations, or bulk deletes were found. Migration 011 changes only the status-column default; it does not rewrite ledger rows. Foreign-key cascades and policy/trigger replacements are limited to declared relationships and named policies/triggers.
- Found and fixed a fresh-project blocker in migration 001: it altered `public.vendors` before that table existed. It now creates the vendor base table with `IF NOT EXISTS` before adding tenant/profile fields, so the same migration supports a blank staging database and leaves any existing vendor table and records in place.
- Found that the vendor/transaction upload widget inserted metadata into optional legacy `vendor_documents`, which is absent on blank staging. Updated it to use the existing organization-scoped `documents` table with uploader, vendor, transaction, and upload metadata; this matches the RLS and private storage workflow used elsewhere in the app.
- Migration 001–012 have not been applied. No staging or Production rows were queried or changed. The logical backup and staging DB credentials remain prerequisites; E2E and live RLS checks remain pending.
- Revalidated the app after the migration and upload-path fixes: `npm test` passes all 8 existing tests, `npm run lint` passes, `npx tsc --noEmit` passes, and `npm run build` completes successfully. No tests against Supabase were possible yet.
- Confirmed in current Supabase docs that Free projects need a user-managed logical export, and the dashboard's Connect panel is the source of the DB connection string; Direct is recommended for `pg_dump`, with Session pooler as an IPv4-compatible option. The database password and connection string are still not available locally. The linked ChatGPT share page still fails to fetch, so the supplied handover brief remains the active requirements source.

## 3 November 2026 — Credential readiness recheck

- After the user said `ready`, checked credential presence/target without displaying values. `NEXT_PUBLIC_SUPABASE_URL` is the staging URL, but the configured anon JWT's embedded project reference does not match staging. `SUPABASE_DB_URL` is absent from `.env.local` and process, user, and machine environment scopes.
- No database connection, backup, migration, schema query, or remote write was attempted. Production remains untouched; the staging project remains empty. Waiting for the staging anon key and DB connection string to be saved locally.
- Rechecked after a second `ready` reply, including `.env.local` and process/user/machine environment scopes. The anon JWT still references a different project and no DB URL is present in any checked scope. No database action was attempted.

## 3 November 2026 — Staging migrations and catalog verification

- Independently confirmed the configured database URL and public Supabase URL resolve to staging ref `yxsbvwhytxvxmtzleiaz`; the read-only connection reports PostgreSQL 17.11. Production was not contacted for migration or test work.
- Independently validated `backups\leadercon-staging-pre-migration-20261103.dump` with `pg_restore --list`: 413 TOC entries, 294,193 bytes, SHA256 `747FC34A906E790826E611525C60B176C097DCF6A7BBBABF85F9E1BDBCC351C`. The archive has no public application table or data entries. It was not restored elsewhere.
- Applied migrations 001–012 incrementally, each in an atomic transaction with `ON_ERROR_STOP`; all completed and were recorded. There were no failures; PostgreSQL emitted only expected “policy/trigger does not exist, skipping” notices for idempotent drop-before-create statements.
- Staging catalog verification: 21 public app tables, all 21 with RLS enabled; zero anonymous policies; private `sumanik-documents` bucket with 20 MiB maximum, ten allowed MIME types, and eight Storage object policies. Key tables, columns, indexes, constraints, functions, and triggers created by the later migrations were checked as each migration completed.
- DDL inventory cross-check found all 21 declared tables, 25 added columns, 13 explicit indexes, 30 public function names, 22 explicit/dynamic triggers, and 30 named policies. The catalog has 118 validated constraints, 39 valid public indexes, and no disabled application triggers.
- Found that Supabase's default ACL allowed `anon` and PostgreSQL `PUBLIC` to execute functions even when the migration revoked only `PUBLIC`. Added and applied migrations 013 and 014 to remove current `anon`/`PUBLIC` execution and those default grants for future public-schema functions. Verified zero effective `anon` or `PUBLIC` execution on public-schema functions while authenticated balance and posting RPCs remain executable.
- No migration failed, no financial/test record was inserted, and Production was untouched. The staging app still cannot run authenticated E2E because `NEXT_PUBLIC_SUPABASE_ANON_KEY` references a different project and there are no confirmed staging test users. `OPENAI_API_KEY` is absent, so AI provider tests also remain blocked.
- Core authentication, financial workflows, tenant isolation, private file authorization, AI, and mobile workflows remain unverified end to end. LeaderCon is not ready for real financial data.
