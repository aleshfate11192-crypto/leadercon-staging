-- Link an approved contractor bill to its payable exactly once. The link is
-- stored separately so the approved bill and its items remain immutable.

create table if not exists public.contractor_bill_ledger_links (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contractor_bill_id uuid not null unique references public.contractor_bills(id) on delete restrict,
  transaction_id uuid not null unique references public.vendor_transactions(id) on delete restrict,
  posted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (organization_id, contractor_bill_id)
);
alter table public.contractor_bill_ledger_links enable row level security;
drop policy if exists contractor_bill_ledger_links_scope on public.contractor_bill_ledger_links;
create policy contractor_bill_ledger_links_scope on public.contractor_bill_ledger_links as restrictive for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
drop policy if exists contractor_bill_ledger_links_read on public.contractor_bill_ledger_links;
create policy contractor_bill_ledger_links_read on public.contractor_bill_ledger_links for select to authenticated
  using (public.is_org_member(organization_id));

create or replace function public.post_contractor_bill_to_ledger(p_organization_id uuid, p_bill_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill public.contractor_bills%rowtype;
  v_transaction_id uuid;
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner', 'accountant']::text[]) then
    raise exception 'Only an owner or accountant can post a bill payable.';
  end if;

  select * into v_bill
  from public.contractor_bills
  where id = p_bill_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'Contractor bill was not found in this workspace.'; end if;
  select transaction_id into v_transaction_id
  from public.contractor_bill_ledger_links
  where organization_id = p_organization_id and contractor_bill_id = p_bill_id;
  if v_transaction_id is not null then return v_transaction_id; end if;
  if v_bill.status <> 'approved' then raise exception 'Approve the contractor bill before posting its payable.'; end if;
  if v_bill.vendor_id is null then raise exception 'Select a vendor before posting this payable.'; end if;
  if v_bill.net_payable <= 0 then raise exception 'The contractor bill must have a positive net payable.'; end if;

  insert into public.vendor_transactions(
    organization_id, vendor_id, project_id, transaction_type, transaction_date,
    amount, reference_number, description, status, created_by
  ) values (
    p_organization_id, v_bill.vendor_id, v_bill.project_id, 'invoice', v_bill.bill_date,
    v_bill.net_payable, v_bill.bill_number, 'Contractor bill payable', 'posted', auth.uid()
  ) returning id into v_transaction_id;

  insert into public.contractor_bill_ledger_links(organization_id, contractor_bill_id, transaction_id, posted_by)
  values (p_organization_id, p_bill_id, v_transaction_id, auth.uid());
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'contractor_bill.payable_posted', 'contractor_bill', p_bill_id::text,
    jsonb_build_object('transaction_id', v_transaction_id, 'net_payable', v_bill.net_payable));
  return v_transaction_id;
end;
$$;
revoke all on function public.post_contractor_bill_to_ledger(uuid, uuid) from public;
grant execute on function public.post_contractor_bill_to_ledger(uuid, uuid) to authenticated;
