-- Atomic vendor ledger posting and invoice payment allocations.
-- This migration is intentionally not applied to the remote database here.

create table if not exists public.invoice_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_transaction_id uuid not null references public.vendor_transactions(id) on delete restrict,
  payment_transaction_id uuid not null references public.vendor_transactions(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists invoice_allocations_invoice_idx on public.invoice_allocations(organization_id, invoice_transaction_id);
create index if not exists invoice_allocations_payment_idx on public.invoice_allocations(organization_id, payment_transaction_id);
alter table public.invoice_allocations enable row level security;
drop policy if exists invoice_allocations_member_read on public.invoice_allocations;
create policy invoice_allocations_member_read on public.invoice_allocations for select to authenticated
  using (public.is_org_member(organization_id));

-- An allocation can only connect a posted invoice and posted payment for the same vendor.
create or replace function public.create_vendor_transaction(
  p_organization_id uuid,
  p_vendor_id uuid,
  p_transaction_type text,
  p_transaction_date date,
  p_amount numeric,
  p_reference_number text default null,
  p_description text default null,
  p_due_date date default null,
  p_project_id uuid default null,
  p_status text default 'posted',
  p_allocations jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction_id uuid;
  v_invoice_id uuid;
  v_allocation_amount numeric(14,2);
  v_invoice_amount numeric(14,2);
  v_allocated numeric(14,2);
  v_payment_allocation_total numeric(14,2) := 0;
begin
  if auth.uid() is null then raise exception 'Sign in is required.'; end if;
  if not public.has_org_role(p_organization_id, array['owner', 'accountant']::text[]) then
    raise exception 'You do not have permission to post financial records.';
  end if;
  if p_transaction_type not in ('invoice', 'payment', 'credit_note', 'advance', 'adjustment') then
    raise exception 'Unsupported transaction type.';
  end if;
  if p_status not in ('draft', 'posted') then raise exception 'Status must be draft or posted.'; end if;
  if p_amount is null or p_amount = 0 or (p_transaction_type <> 'adjustment' and p_amount < 0) then
    raise exception 'Amount must be positive, except signed adjustments.';
  end if;
  if not exists (
    select 1 from public.vendors v
    where v.id = p_vendor_id and v.organization_id = p_organization_id and not v.is_archived
  ) then raise exception 'Vendor was not found in this organization.'; end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_project_id and p.organization_id = p_organization_id
  ) then raise exception 'Project was not found in this organization.'; end if;
  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' then raise exception 'Payment allocations must be a list.'; end if;
  if p_transaction_type <> 'payment' and jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) > 0 then
    raise exception 'Only a payment can be allocated to invoices.';
  end if;
  if p_status = 'draft' and jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) > 0 then
    raise exception 'Draft payments cannot allocate amounts to posted invoices.';
  end if;

  insert into public.vendor_transactions (
    organization_id, vendor_id, transaction_type, transaction_date, amount,
    reference_number, description, due_date, project_id, status, created_by
  ) values (
    p_organization_id, p_vendor_id, p_transaction_type, p_transaction_date, abs(p_amount),
    nullif(trim(coalesce(p_reference_number, '')), ''), nullif(trim(coalesce(p_description, '')), ''),
    p_due_date, p_project_id, p_status, auth.uid()
  ) returning id into v_transaction_id;

  if p_transaction_type = 'adjustment' and p_amount < 0 then
    update public.vendor_transactions set amount = p_amount where id = v_transaction_id;
  end if;

  if p_transaction_type = 'payment' and p_status = 'posted' then
    for v_invoice_id, v_allocation_amount in
      select (rows.value->>'invoice_id')::uuid, (rows.value->>'amount')::numeric
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) as rows(value)
    loop
      if v_allocation_amount is null or v_allocation_amount <= 0 then
        raise exception 'Each invoice allocation must have a positive amount.';
      end if;
      if v_invoice_id is null then raise exception 'Each allocation needs an invoice id.'; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_invoice_id::text, 0));
      select i.amount into v_invoice_amount
      from public.vendor_transactions i
      where i.id = v_invoice_id
        and i.organization_id = p_organization_id
        and i.vendor_id = p_vendor_id
        and i.transaction_type = 'invoice'
        and i.status = 'posted';
      if not found then raise exception 'An allocation references an invalid or unposted invoice.'; end if;

      v_payment_allocation_total := v_payment_allocation_total + v_allocation_amount;
      if v_payment_allocation_total > abs(p_amount) then
        raise exception 'Total invoice allocations cannot exceed the payment amount.';
      end if;

      select coalesce(sum(a.amount), 0) into v_allocated
      from public.invoice_allocations a
      where a.organization_id = p_organization_id and a.invoice_transaction_id = v_invoice_id;
      if v_allocated + v_allocation_amount > v_invoice_amount then
        raise exception 'An allocation exceeds the invoice balance.';
      end if;
      insert into public.invoice_allocations (
        organization_id, invoice_transaction_id, payment_transaction_id, amount, created_by
      ) values (p_organization_id, v_invoice_id, v_transaction_id, v_allocation_amount, auth.uid());
    end loop;
  end if;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_organization_id, auth.uid(), 'transaction.' || p_status, 'vendor_transaction', v_transaction_id::text,
    jsonb_build_object('vendor_id', p_vendor_id, 'transaction_type', p_transaction_type, 'amount', p_amount)
  );
  return v_transaction_id;
end;
$$;
revoke all on function public.create_vendor_transaction(uuid, uuid, text, date, numeric, text, text, date, uuid, text, jsonb) from public;
grant execute on function public.create_vendor_transaction(uuid, uuid, text, date, numeric, text, text, date, uuid, text, jsonb) to authenticated;

-- Existing vendor-document metadata stays linked to its vendor and is limited by
-- both membership and the tenant-scoped vendors policy from the foundation file.
do $$
begin
  if to_regclass('public.vendor_documents') is not null then
    execute 'drop policy if exists vendor_documents_member_read on public.vendor_documents';
    execute $policy$
      create policy vendor_documents_member_read on public.vendor_documents for select to authenticated
      using (exists (select 1 from public.vendors v where v.id = vendor_documents.vendor_id and public.is_org_member(v.organization_id)))
    $policy$;
    execute 'drop policy if exists vendor_documents_member_upload on public.vendor_documents';
    execute $policy$
      create policy vendor_documents_member_upload on public.vendor_documents for insert to authenticated
      with check (exists (select 1 from public.vendors v where v.id = vendor_documents.vendor_id and public.has_org_role(v.organization_id, array[''owner'', ''accountant'', ''project_manager'', ''site_engineer'']::text[])))
    $policy$;
  end if;
end $$;
