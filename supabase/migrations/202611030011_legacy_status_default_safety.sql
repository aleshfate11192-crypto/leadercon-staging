-- Remove an implicit status from legacy ledgers without changing any existing
-- transaction values. App posting RPCs always provide draft or posted explicitly.
alter table public.vendor_transactions alter column status drop default;
