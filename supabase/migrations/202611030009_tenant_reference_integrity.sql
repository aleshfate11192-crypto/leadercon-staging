-- RLS protects each row. These triggers also prevent a row in one workspace
-- from pointing at another workspace's projects, vendors, or source records.

create or replace function public.assert_same_organization(p_organization_id uuid, p_parent_table text, p_parent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_organization_id uuid;
begin
  if p_parent_id is null then return; end if;
  if p_parent_table not in (
    'projects', 'project_sites', 'vendors', 'vendor_transactions', 'documents', 'boqs',
    'boq_items', 'measurement_books', 'measurement_entries', 'contractor_bills',
    'contractor_bill_items'
  ) then raise exception 'Unsupported organization reference.'; end if;
  execute format('select organization_id from public.%I where id = $1', p_parent_table)
    into v_parent_organization_id using p_parent_id;
  if v_parent_organization_id is distinct from p_organization_id then
    raise exception 'A linked record is missing or belongs to another organization.';
  end if;
end;
$$;
revoke all on function public.assert_same_organization(uuid, text, uuid) from public;

create or replace function public.validate_organization_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_organization_id uuid;
  v_site_project_id uuid;
  v_source_project_id uuid;
  v_bill_vendor_id uuid;
  v_bill_project_id uuid;
  v_transaction_vendor_id uuid;
  v_invoice_type text;
  v_payment_type text;
  v_payable_type text;
  v_payable_status text;
  v_bill_net numeric;
  v_payable_amount numeric;
begin
  v_row := to_jsonb(new);
  v_organization_id := nullif(v_row->>'organization_id', '')::uuid;
  if tg_table_name = 'vendor_transactions' then
    perform public.assert_same_organization(v_organization_id, 'vendors', (v_row->>'vendor_id')::uuid);
    perform public.assert_same_organization(v_organization_id, 'projects', nullif(v_row->>'project_id', '')::uuid);
  elsif tg_table_name = 'project_sites' then
    perform public.assert_same_organization(v_organization_id, 'projects', (v_row->>'project_id')::uuid);
  elsif tg_table_name = 'documents' then
    perform public.assert_same_organization(v_organization_id, 'projects', nullif(v_row->>'project_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'project_sites', nullif(v_row->>'site_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'vendors', nullif(v_row->>'vendor_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'vendor_transactions', nullif(v_row->>'transaction_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'boqs', nullif(v_row->>'boq_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'measurement_books', nullif(v_row->>'measurement_book_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'contractor_bills', nullif(v_row->>'contractor_bill_id', '')::uuid);
    if v_row->>'site_id' is not null and v_row->>'project_id' is not null then
      select s.project_id into v_site_project_id from public.project_sites s where s.id = (v_row->>'site_id')::uuid;
      if v_site_project_id is distinct from (v_row->>'project_id')::uuid then raise exception 'The site must belong to the selected project.'; end if;
    end if;
  elsif tg_table_name = 'boqs' then
    perform public.assert_same_organization(v_organization_id, 'projects', nullif(v_row->>'project_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'project_sites', nullif(v_row->>'site_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'documents', nullif(v_row->>'document_id', '')::uuid);
    if v_row->>'site_id' is not null and v_row->>'project_id' is not null then
      select s.project_id into v_site_project_id from public.project_sites s where s.id = (v_row->>'site_id')::uuid;
      if v_site_project_id is distinct from (v_row->>'project_id')::uuid then raise exception 'The site must belong to the selected project.'; end if;
    end if;
  elsif tg_table_name = 'boq_items' then
    perform public.assert_same_organization(v_organization_id, 'boqs', (v_row->>'boq_id')::uuid);
  elsif tg_table_name = 'measurement_books' then
    perform public.assert_same_organization(v_organization_id, 'projects', nullif(v_row->>'project_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'project_sites', nullif(v_row->>'site_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'documents', nullif(v_row->>'document_id', '')::uuid);
    if v_row->>'site_id' is not null and v_row->>'project_id' is not null then
      select s.project_id into v_site_project_id from public.project_sites s where s.id = (v_row->>'site_id')::uuid;
      if v_site_project_id is distinct from (v_row->>'project_id')::uuid then raise exception 'The site must belong to the selected project.'; end if;
    end if;
  elsif tg_table_name = 'measurement_entries' then
    perform public.assert_same_organization(v_organization_id, 'measurement_books', (v_row->>'measurement_book_id')::uuid);
    perform public.assert_same_organization(v_organization_id, 'boq_items', nullif(v_row->>'boq_item_id', '')::uuid);
    if v_row->>'boq_item_id' is not null then
      select b.project_id into v_site_project_id from public.measurement_books mb join public.boq_items bi on bi.id = (v_row->>'boq_item_id')::uuid join public.boqs b on b.id = bi.boq_id where mb.id = (v_row->>'measurement_book_id')::uuid;
      if not found then raise exception 'The linked BOQ item was not found.'; end if;
      if (select mb.project_id from public.measurement_books mb where mb.id = (v_row->>'measurement_book_id')::uuid) is distinct from v_site_project_id then
        raise exception 'The linked BOQ item must belong to the same project as the Measurement Book.';
      end if;
    end if;
  elsif tg_table_name = 'contractor_bills' then
    perform public.assert_same_organization(v_organization_id, 'projects', nullif(v_row->>'project_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'project_sites', nullif(v_row->>'site_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'vendors', nullif(v_row->>'vendor_id', '')::uuid);
    if v_row->>'site_id' is not null and v_row->>'project_id' is not null then
      select s.project_id into v_site_project_id from public.project_sites s where s.id = (v_row->>'site_id')::uuid;
      if v_site_project_id is distinct from (v_row->>'project_id')::uuid then raise exception 'The site must belong to the selected project.'; end if;
    end if;
  elsif tg_table_name = 'contractor_bill_items' then
    perform public.assert_same_organization(v_organization_id, 'contractor_bills', (v_row->>'contractor_bill_id')::uuid);
    perform public.assert_same_organization(v_organization_id, 'boq_items', nullif(v_row->>'boq_item_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'measurement_entries', nullif(v_row->>'measurement_entry_id', '')::uuid);
    select b.vendor_id, b.project_id into v_bill_vendor_id, v_bill_project_id from public.contractor_bills b where b.id = (v_row->>'contractor_bill_id')::uuid;
    if v_row->>'boq_item_id' is not null then
      select b.project_id into v_source_project_id from public.boq_items bi join public.boqs b on b.id = bi.boq_id where bi.id = (v_row->>'boq_item_id')::uuid;
      if v_bill_project_id is not null and v_source_project_id is distinct from v_bill_project_id then raise exception 'The BOQ item must belong to the bill project.'; end if;
    end if;
    if v_row->>'measurement_entry_id' is not null then
      select mb.project_id into v_source_project_id from public.measurement_entries me join public.measurement_books mb on mb.id = me.measurement_book_id where me.id = (v_row->>'measurement_entry_id')::uuid;
      if v_bill_project_id is not null and v_source_project_id is distinct from v_bill_project_id then raise exception 'The measurement must belong to the bill project.'; end if;
    end if;
  elsif tg_table_name in ('procurement_records', 'labour_records') then
    perform public.assert_same_organization(v_organization_id, 'projects', nullif(v_row->>'project_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'project_sites', nullif(v_row->>'site_id', '')::uuid);
    perform public.assert_same_organization(v_organization_id, 'vendors', nullif(v_row->>'vendor_id', '')::uuid);
    if v_row->>'site_id' is not null and v_row->>'project_id' is not null then
      select s.project_id into v_site_project_id from public.project_sites s where s.id = (v_row->>'site_id')::uuid;
      if v_site_project_id is distinct from (v_row->>'project_id')::uuid then raise exception 'The site must belong to the selected project.'; end if;
    end if;
  elsif tg_table_name = 'invoice_allocations' then
    perform public.assert_same_organization(v_organization_id, 'vendor_transactions', (v_row->>'invoice_transaction_id')::uuid);
    perform public.assert_same_organization(v_organization_id, 'vendor_transactions', (v_row->>'payment_transaction_id')::uuid);
    select transaction_type into v_invoice_type from public.vendor_transactions where id = (v_row->>'invoice_transaction_id')::uuid;
    select transaction_type into v_payment_type from public.vendor_transactions where id = (v_row->>'payment_transaction_id')::uuid;
    if v_invoice_type is distinct from 'invoice' or v_payment_type is distinct from 'payment' then raise exception 'Invoice allocations must connect an invoice and a payment.'; end if;
  elsif tg_table_name = 'contractor_bill_ledger_links' then
    perform public.assert_same_organization(v_organization_id, 'contractor_bills', (v_row->>'contractor_bill_id')::uuid);
    perform public.assert_same_organization(v_organization_id, 'vendor_transactions', (v_row->>'transaction_id')::uuid);
    select b.vendor_id, t.vendor_id, t.transaction_type, t.status, b.net_payable, t.amount
      into v_bill_vendor_id, v_transaction_vendor_id, v_payable_type, v_payable_status, v_bill_net, v_payable_amount
    from public.contractor_bills b join public.vendor_transactions t on t.id = (v_row->>'transaction_id')::uuid
    where b.id = (v_row->>'contractor_bill_id')::uuid;
    if v_bill_vendor_id is distinct from v_transaction_vendor_id then raise exception 'The payable must use the contractor bill vendor.'; end if;
    if v_payable_type is distinct from 'invoice' or v_payable_status is distinct from 'posted' or v_payable_amount is distinct from v_bill_net then
      raise exception 'The linked ledger transaction must be a posted invoice for the bill net payable.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_organization_references() from public;

do $$
declare t text;
begin
  foreach t in array array[
    'vendor_transactions', 'project_sites', 'documents', 'boqs', 'boq_items',
    'measurement_books', 'measurement_entries', 'contractor_bills', 'contractor_bill_items',
    'procurement_records', 'labour_records', 'invoice_allocations', 'contractor_bill_ledger_links'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_organization_references', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.validate_organization_references()', t || '_organization_references', t);
  end loop;
end $$;
