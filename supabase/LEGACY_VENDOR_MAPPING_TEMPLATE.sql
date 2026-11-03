-- READ-ONLY inventory template. Review ownership before writing any mapping.
-- Run against a backed-up database in the Supabase SQL editor.

-- Count vendor rows not assigned to a LeaderCon organization.
select count(*) as unassigned_vendor_rows
from public.vendors
where organization_id is null;

-- Review unassigned vendors and their original profile fields.
select id, name, phone, email, category, opening_balance, created_at
from public.vendors
where organization_id is null
order by created_at, name;

-- Review unassigned transaction rows and their parent vendor IDs.
select id, vendor_id, transaction_type, transaction_date, reference_number, amount, status
from public.vendor_transactions
where organization_id is null
order by transaction_date, created_at;

-- Do not bulk-update these rows until each vendor and transaction has been
-- verified as belonging to one organization. If rows belong to multiple
-- companies, map them in separate reviewed batches and keep an audit record.
