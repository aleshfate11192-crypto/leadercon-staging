-- Database-calculated summaries for official vendor and invoice balances.
-- Functions run as the caller so the underlying RLS policies remain in force.

create or replace function public.get_vendor_balances(p_organization_id uuid)
returns table (
  vendor_id uuid,
  vendor_name text,
  opening_balance numeric,
  ledger_total numeric,
  outstanding_balance numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    v.id,
    v.name,
    coalesce(v.opening_balance, 0)::numeric,
    coalesce(sum(case
      when t.status = 'posted' and t.transaction_type = 'invoice' then abs(t.amount)
      when t.status = 'posted' and t.transaction_type in ('payment', 'advance', 'credit_note') then -abs(t.amount)
      when t.status = 'posted' and t.transaction_type = 'adjustment' then t.amount
      else 0
    end), 0)::numeric,
    (coalesce(v.opening_balance, 0) + coalesce(sum(case
      when t.status = 'posted' and t.transaction_type = 'invoice' then abs(t.amount)
      when t.status = 'posted' and t.transaction_type in ('payment', 'advance', 'credit_note') then -abs(t.amount)
      when t.status = 'posted' and t.transaction_type = 'adjustment' then t.amount
      else 0
    end), 0))::numeric
  from public.vendors v
  left join public.vendor_transactions t
    on t.vendor_id = v.id and t.organization_id = v.organization_id
  where v.organization_id = p_organization_id
    and not v.is_archived
    and public.is_org_member(p_organization_id)
  group by v.id, v.name, v.opening_balance
  order by v.name;
$$;
grant execute on function public.get_vendor_balances(uuid) to authenticated;

create or replace function public.get_invoice_balances(p_organization_id uuid)
returns table (
  invoice_id uuid,
  vendor_id uuid,
  invoice_amount numeric,
  paid_amount numeric,
  outstanding_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.id,
    i.vendor_id,
    abs(i.amount)::numeric,
    coalesce(sum(a.amount), 0)::numeric,
    greatest(abs(i.amount) - coalesce(sum(a.amount), 0), 0)::numeric
  from public.vendor_transactions i
  left join public.invoice_allocations a
    on a.invoice_transaction_id = i.id and a.organization_id = i.organization_id
  where i.organization_id = p_organization_id
    and i.transaction_type = 'invoice'
    and i.status = 'posted'
    and public.is_org_member(p_organization_id)
  group by i.id, i.vendor_id, i.amount
  order by i.transaction_date desc, i.created_at desc;
$$;
grant execute on function public.get_invoice_balances(uuid) to authenticated;
