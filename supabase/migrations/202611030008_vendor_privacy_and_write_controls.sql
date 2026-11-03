-- Keep supplier bank fields behind a role-checked RPC. Table reads for regular
-- authenticated clients include only the non-bank profile columns.

revoke select on table public.vendors from public, anon, authenticated;
revoke select (bank_account_holder, bank_name, bank_account_number, bank_ifsc, bank_branch, bank_account_type)
  on table public.vendors from public, anon, authenticated;
grant select (
  id, organization_id, created_by, name, contact_person, phone, email, address,
  category, opening_balance, notes, is_archived, created_at
) on table public.vendors to authenticated;

drop policy if exists vendors_finance_insert_scope on public.vendors;
create policy vendors_finance_insert_scope on public.vendors as restrictive for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'accountant']::text[]));
drop policy if exists vendors_finance_update_scope on public.vendors;
create policy vendors_finance_update_scope on public.vendors as restrictive for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'accountant']::text[]))
  with check (public.has_org_role(organization_id, array['owner', 'accountant']::text[]));

drop policy if exists vendor_transactions_finance_insert_scope on public.vendor_transactions;
create policy vendor_transactions_finance_insert_scope on public.vendor_transactions as restrictive for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'accountant']::text[]));
drop policy if exists vendor_transactions_finance_update_scope on public.vendor_transactions;
create policy vendor_transactions_finance_update_scope on public.vendor_transactions as restrictive for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'accountant']::text[]))
  with check (public.has_org_role(organization_id, array['owner', 'accountant']::text[]));

create or replace function public.get_vendor_bank_details(p_organization_id uuid, p_vendor_id uuid)
returns table(
  bank_account_holder text,
  bank_name text,
  bank_account_number text,
  bank_ifsc text,
  bank_branch text,
  bank_account_type text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner', 'accountant']::text[]) then
    raise exception 'Bank details are restricted to workspace owners and accountants.';
  end if;
  return query
    select v.bank_account_holder, v.bank_name, v.bank_account_number, v.bank_ifsc, v.bank_branch, v.bank_account_type
    from public.vendors v
    where v.id = p_vendor_id and v.organization_id = p_organization_id and not v.is_archived;
  if not found then raise exception 'Vendor was not found in this workspace.'; end if;
end;
$$;
revoke all on function public.get_vendor_bank_details(uuid, uuid) from public;
grant execute on function public.get_vendor_bank_details(uuid, uuid) to authenticated;

-- Application roles that can upload documents may not approve document metadata.
drop policy if exists documents_approval_scope on public.documents;
create policy documents_approval_scope on public.documents as restrictive for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'accountant', 'project_manager']::text[]))
  with check (public.has_org_role(organization_id, array['owner', 'accountant', 'project_manager']::text[]));

create or replace function public.guard_document_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'approved' then
    raise exception 'Approved document metadata is immutable.';
  end if;
  if new.status = 'approved' then
    if tg_op = 'INSERT' then
      if not public.has_org_role(new.organization_id, array['owner', 'accountant', 'project_manager']::text[]) then
        raise exception 'Only an owner, accountant, or project manager can approve a document.';
      end if;
      new.approved_by := auth.uid();
    elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
      if not public.has_org_role(new.organization_id, array['owner', 'accountant', 'project_manager']::text[]) then
        raise exception 'Only an owner, accountant, or project manager can approve a document.';
      end if;
      new.approved_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists documents_guard_approval on public.documents;
create trigger documents_guard_approval before insert or update on public.documents
  for each row execute function public.guard_document_approval();
