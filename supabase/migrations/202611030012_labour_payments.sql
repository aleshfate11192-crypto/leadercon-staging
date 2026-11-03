-- Link labour payments to both the attendance/cost record and vendor ledger.
-- The RPC is atomic and uses the same retry key as the vendor ledger posting.

create table if not exists public.labour_payment_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  labour_record_id uuid not null references public.labour_records(id) on delete restrict,
  payment_transaction_id uuid not null unique references public.vendor_transactions(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists labour_payment_links_record_idx
  on public.labour_payment_links(organization_id, labour_record_id);
alter table public.labour_payment_links enable row level security;
revoke all on table public.labour_payment_links from public, anon;
revoke insert, update, delete on table public.labour_payment_links from authenticated;
grant select on table public.labour_payment_links to authenticated;
drop policy if exists labour_payment_links_member_read on public.labour_payment_links;
create policy labour_payment_links_member_read on public.labour_payment_links for select to authenticated
  using (public.is_org_member(organization_id));

-- Payment state can only change inside the payment RPC. There is no direct
-- labour-record editing UI, so clients receive no UPDATE privilege on it.
revoke update on table public.labour_records from public, anon, authenticated;

create or replace function public.require_new_labour_records_unpaid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_status is distinct from 'unpaid' then
    raise exception 'New labour records start unpaid; use the payment workflow to record a payment.';
  end if;
  return new;
end;
$$;
revoke all on function public.require_new_labour_records_unpaid() from public, anon, authenticated;
drop trigger if exists labour_records_start_unpaid on public.labour_records;
create trigger labour_records_start_unpaid before insert on public.labour_records
  for each row execute function public.require_new_labour_records_unpaid();

create or replace function public.validate_labour_payment_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_labour_org uuid;
  v_labour_vendor uuid;
  v_payment_org uuid;
  v_payment_vendor uuid;
  v_payment_type text;
  v_payment_status text;
  v_payment_amount numeric;
begin
  select l.organization_id, l.vendor_id into v_labour_org, v_labour_vendor
  from public.labour_records l where l.id = new.labour_record_id;
  select t.organization_id, t.vendor_id, t.transaction_type, t.status, t.amount
    into v_payment_org, v_payment_vendor, v_payment_type, v_payment_status, v_payment_amount
  from public.vendor_transactions t where t.id = new.payment_transaction_id;
  if v_labour_org is distinct from new.organization_id
    or v_payment_org is distinct from new.organization_id
    or v_labour_vendor is null
    or v_labour_vendor is distinct from v_payment_vendor
    or v_payment_type is distinct from 'payment'
    or v_payment_status is distinct from 'posted'
    or v_payment_amount is distinct from new.amount then
    raise exception 'Labour payment must match a posted payment for its linked vendor and amount.';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_labour_payment_link() from public, anon, authenticated;
drop trigger if exists labour_payment_links_validate on public.labour_payment_links;
create trigger labour_payment_links_validate before insert or update on public.labour_payment_links
  for each row execute function public.validate_labour_payment_link();

create or replace function public.record_labour_payment(
  p_idempotency_key uuid,
  p_organization_id uuid,
  p_labour_record_id uuid,
  p_payment_date date,
  p_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_labour public.labour_records%rowtype;
  v_paid_before numeric(14,2);
  v_paid_after numeric(14,2);
  v_transaction_id uuid;
  v_existing_link public.labour_payment_links%rowtype;
begin
  if v_user_id is null then raise exception 'Sign in is required.'; end if;
  if p_idempotency_key is null then raise exception 'A retry key is required.'; end if;
  if not public.has_org_role(p_organization_id, array['owner', 'accountant']::text[]) then
    raise exception 'Only an owner or accountant can post labour payments.';
  end if;
  if p_payment_date is null or p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
    raise exception 'Enter a positive payment amount to the nearest paise and a payment date.';
  end if;

  select * into v_labour from public.labour_records l
  where l.id = p_labour_record_id and l.organization_id = p_organization_id
  for update;
  if not found then raise exception 'Labour record was not found in this organization.'; end if;
  if v_labour.vendor_id is null then raise exception 'Link a labour supplier before posting a ledger payment.'; end if;

  v_transaction_id := public.create_vendor_transaction_idempotent(
    p_idempotency_key,
    p_organization_id,
    v_labour.vendor_id,
    'payment',
    p_payment_date,
    p_amount,
    null,
    'Labour payment: ' || v_labour.category || ' (' || v_labour.work_date::text || ')',
    null,
    v_labour.project_id,
    'posted',
    '[]'::jsonb
  );

  select * into v_existing_link from public.labour_payment_links lpl
  where lpl.payment_transaction_id = v_transaction_id;
  if found then
    if v_existing_link.organization_id is distinct from p_organization_id
      or v_existing_link.labour_record_id is distinct from p_labour_record_id
      or v_existing_link.amount is distinct from p_amount then
      raise exception 'This retry key is already linked to another labour payment.';
    end if;
    return v_transaction_id;
  end if;

  select coalesce(sum(lpl.amount), 0) into v_paid_before
  from public.labour_payment_links lpl
  where lpl.organization_id = p_organization_id and lpl.labour_record_id = p_labour_record_id;
  if v_paid_before + p_amount > v_labour.amount then
    raise exception 'Payment exceeds the remaining labour amount.';
  end if;

  insert into public.labour_payment_links(
    organization_id, labour_record_id, payment_transaction_id, amount, created_by
  ) values (p_organization_id, p_labour_record_id, v_transaction_id, p_amount, v_user_id);

  v_paid_after := v_paid_before + p_amount;
  update public.labour_records set payment_status = case
    when v_paid_after >= amount then 'paid'
    when v_paid_after > 0 then 'partial'
    else 'unpaid'
  end
  where id = p_labour_record_id and organization_id = p_organization_id;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_organization_id, v_user_id, 'labour.payment_recorded', 'labour_record', p_labour_record_id::text,
    jsonb_build_object('payment_transaction_id', v_transaction_id, 'amount', p_amount, 'paid_total', v_paid_after)
  );
  return v_transaction_id;
end;
$$;
revoke all on function public.record_labour_payment(uuid, uuid, uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.record_labour_payment(uuid, uuid, uuid, date, numeric) to authenticated;
