-- Review-first BOQ, Measurement Book, and contractor bill workflows.
-- Files remain in the existing private sumanik-documents bucket.

alter table public.documents add column if not exists boq_id uuid references public.boqs(id);
alter table public.documents add column if not exists measurement_book_id uuid references public.measurement_books(id);
alter table public.documents add column if not exists contractor_bill_id uuid references public.contractor_bills(id);

-- Site engineers can create drafts, while approvals are restricted to owners,
-- accountants, and project managers even if another permissive policy exists.
drop policy if exists boqs_approval_scope on public.boqs;
create policy boqs_approval_scope on public.boqs as restrictive for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'accountant', 'project_manager']::text[]))
  with check (public.has_org_role(organization_id, array['owner', 'accountant', 'project_manager']::text[]));
drop policy if exists measurement_books_approval_scope on public.measurement_books;
create policy measurement_books_approval_scope on public.measurement_books as restrictive for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'accountant', 'project_manager']::text[]))
  with check (public.has_org_role(organization_id, array['owner', 'accountant', 'project_manager']::text[]));
drop policy if exists contractor_bills_approval_scope on public.contractor_bills;
create policy contractor_bills_approval_scope on public.contractor_bills as restrictive for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'accountant', 'project_manager']::text[]))
  with check (public.has_org_role(organization_id, array['owner', 'accountant', 'project_manager']::text[]));

create or replace function public.save_boq_review(
  p_organization_id uuid,
  p_name text,
  p_project_id uuid,
  p_site_id uuid,
  p_revision_date date,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_items jsonb,
  p_notes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_boq_id uuid;
  v_document_id uuid;
  v_version integer;
  v_item jsonb;
  v_quantity numeric(16,4);
  v_rate numeric(14,2);
  v_stated_amount numeric(14,2);
  v_amount numeric(14,2);
  v_total numeric(14,2) := 0;
  v_item_count integer := 0;
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner', 'accountant', 'project_manager', 'site_engineer']::text[]) then
    raise exception 'You do not have permission to save a BOQ in this workspace.';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'BOQ name is required.'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'At least one reviewed BOQ item is required.';
  end if;
  if (storage.foldername(p_storage_path))[1] <> p_organization_id::text
    or (storage.foldername(p_storage_path))[2] <> auth.uid()::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'sumanik-documents' and o.name = p_storage_path) then
    raise exception 'The uploaded BOQ file is missing or outside this workspace.';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects p where p.id = p_project_id and p.organization_id = p_organization_id) then
    raise exception 'The selected project is outside this workspace.';
  end if;
  if p_site_id is not null and not exists (select 1 from public.project_sites s where s.id = p_site_id and s.organization_id = p_organization_id and (p_project_id is null or s.project_id = p_project_id)) then
    raise exception 'The selected site is outside this project.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || coalesce(p_project_id::text, '') || lower(trim(p_name)), 0));
  select coalesce(max(b.version_number), 0) + 1 into v_version
  from public.boqs b where b.organization_id = p_organization_id and b.project_id is not distinct from p_project_id and lower(b.name) = lower(trim(p_name));

  insert into public.documents(organization_id, uploader_id, project_id, site_id, document_type, file_name, storage_path, mime_type, file_size_bytes, status, ai_extraction)
  values (p_organization_id, auth.uid(), p_project_id, p_site_id, 'boq', trim(p_file_name), p_storage_path, p_mime_type, p_file_size_bytes, 'review', jsonb_build_object('items', p_items, 'notes', coalesce(p_notes, '[]'::jsonb)))
  returning id into v_document_id;

  insert into public.boqs(organization_id, project_id, site_id, document_id, name, version_number, revision_date, status, created_by)
  values (p_organization_id, p_project_id, p_site_id, v_document_id, trim(p_name), v_version, p_revision_date, 'draft', auth.uid())
  returning id into v_boq_id;

  update public.documents set boq_id = v_boq_id where id = v_document_id;

  for v_item in select rows.value from jsonb_array_elements(p_items) as rows(value) loop
    if char_length(trim(coalesce(v_item->>'description', ''))) = 0 then raise exception 'Every BOQ row needs a description.'; end if;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_rate := nullif(v_item->>'rate', '')::numeric;
    v_stated_amount := nullif(v_item->>'amount', '')::numeric;
    if v_quantity is not null and v_quantity < 0 then raise exception 'BOQ quantities cannot be negative.'; end if;
    if v_rate is not null and v_rate < 0 then raise exception 'BOQ rates cannot be negative.'; end if;
    v_amount := case when v_quantity is not null and v_rate is not null then round(v_quantity * v_rate, 2) else v_stated_amount end;
    v_total := v_total + coalesce(v_amount, 0);
    insert into public.boq_items(organization_id, boq_id, item_number, description, unit, quantity, rate, amount, specification, source_ref, confidence)
    values (
      p_organization_id, v_boq_id, nullif(trim(coalesce(v_item->>'itemNumber', '')), ''), trim(v_item->>'description'),
      nullif(trim(coalesce(v_item->>'unit', '')), ''), v_quantity, v_rate, v_amount,
      nullif(trim(coalesce(v_item->>'specification', '')), ''), nullif(trim(coalesce(v_item->>'sourceRef', '')), ''),
      greatest(0, least(1, coalesce(nullif(v_item->>'confidence', '')::numeric, 0)))
    );
    v_item_count := v_item_count + 1;
  end loop;

  update public.boqs set total_amount = v_total where id = v_boq_id;
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'boq.draft_created', 'boq', v_boq_id::text, jsonb_build_object('document_id', v_document_id, 'version', v_version, 'items', v_item_count));
  return v_boq_id;
end;
$$;
revoke all on function public.save_boq_review(uuid, text, uuid, uuid, date, text, text, text, bigint, jsonb, jsonb) from public;
grant execute on function public.save_boq_review(uuid, text, uuid, uuid, date, text, text, text, bigint, jsonb, jsonb) to authenticated;

create or replace function public.save_measurement_review(
  p_organization_id uuid,
  p_number text,
  p_project_id uuid,
  p_site_id uuid,
  p_measured_on date,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_entries jsonb,
  p_notes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_book_id uuid;
  v_document_id uuid;
  v_entry jsonb;
  v_length numeric(16,4);
  v_width numeric(16,4);
  v_height numeric(16,4);
  v_units numeric(16,4);
  v_quantity numeric(16,4);
  v_boq_item_id uuid;
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner', 'accountant', 'project_manager', 'site_engineer']::text[]) then
    raise exception 'You do not have permission to save a Measurement Book in this workspace.';
  end if;
  if char_length(trim(coalesce(p_number, ''))) < 1 then raise exception 'Measurement Book number is required.'; end if;
  if jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) = 0 then
    raise exception 'At least one reviewed measurement is required.';
  end if;
  if (storage.foldername(p_storage_path))[1] <> p_organization_id::text
    or (storage.foldername(p_storage_path))[2] <> auth.uid()::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'sumanik-documents' and o.name = p_storage_path) then
    raise exception 'The uploaded Measurement Book file is missing or outside this workspace.';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects p where p.id = p_project_id and p.organization_id = p_organization_id) then
    raise exception 'The selected project is outside this workspace.';
  end if;
  if p_site_id is not null and not exists (select 1 from public.project_sites s where s.id = p_site_id and s.organization_id = p_organization_id and (p_project_id is null or s.project_id = p_project_id)) then
    raise exception 'The selected site is outside this project.';
  end if;

  insert into public.documents(organization_id, uploader_id, project_id, site_id, document_type, file_name, storage_path, mime_type, file_size_bytes, status, ai_extraction)
  values (p_organization_id, auth.uid(), p_project_id, p_site_id, 'measurement_book', trim(p_file_name), p_storage_path, p_mime_type, p_file_size_bytes, 'review', jsonb_build_object('entries', p_entries, 'notes', coalesce(p_notes, '[]'::jsonb)))
  returning id into v_document_id;
  insert into public.measurement_books(organization_id, project_id, site_id, document_id, number, measured_on, status, created_by)
  values (p_organization_id, p_project_id, p_site_id, v_document_id, trim(p_number), p_measured_on, 'draft', auth.uid())
  returning id into v_book_id;
  update public.documents set measurement_book_id = v_book_id where id = v_document_id;

  for v_entry in select rows.value from jsonb_array_elements(p_entries) as rows(value) loop
    v_length := nullif(v_entry->>'length', '')::numeric;
    v_width := nullif(v_entry->>'width', '')::numeric;
    v_height := nullif(v_entry->>'heightDepth', '')::numeric;
    v_units := coalesce(nullif(v_entry->>'unitsCount', '')::numeric, 1);
    v_boq_item_id := nullif(v_entry->>'boqItemId', '')::uuid;
    if v_boq_item_id is not null and not exists (
      select 1 from public.boq_items bi join public.boqs b on b.id = bi.boq_id
      where bi.id = v_boq_item_id and bi.organization_id = p_organization_id and b.status = 'approved'
        and (p_project_id is null or b.project_id = p_project_id)
    ) then raise exception 'A measurement entry references an unapproved or unauthorized BOQ item.'; end if;
    v_quantity := case
      when v_length is not null and v_width is not null and v_height is not null then round(v_length * v_width * v_height * v_units, 4)
      else coalesce(nullif(v_entry->>'quantity', '')::numeric, 0)
    end;
    if v_quantity < 0 then raise exception 'Measurement quantities cannot be negative.'; end if;
    insert into public.measurement_entries(organization_id, measurement_book_id, boq_item_id, item_number, description, length, width, height_depth, units_count, quantity, unit, source_ref)
    values (
      p_organization_id, v_book_id, v_boq_item_id, nullif(trim(coalesce(v_entry->>'itemNumber', '')), ''),
      nullif(trim(coalesce(v_entry->>'description', '')), ''), v_length, v_width, v_height, v_units, v_quantity,
      nullif(trim(coalesce(v_entry->>'unit', '')), ''), nullif(trim(coalesce(v_entry->>'sourceRef', '')), '')
    );
  end loop;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'measurement_book.draft_created', 'measurement_book', v_book_id::text, jsonb_build_object('document_id', v_document_id));
  return v_book_id;
end;
$$;
revoke all on function public.save_measurement_review(uuid, text, uuid, uuid, date, text, text, text, bigint, jsonb, jsonb) from public;
grant execute on function public.save_measurement_review(uuid, text, uuid, uuid, date, text, text, text, bigint, jsonb, jsonb) to authenticated;

create or replace function public.save_contractor_bill_review(
  p_organization_id uuid,
  p_project_id uuid,
  p_site_id uuid,
  p_vendor_id uuid,
  p_bill_number text,
  p_bill_date date,
  p_previous_amount numeric,
  p_deductions numeric,
  p_tax_amount numeric,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill_id uuid;
  v_item jsonb;
  v_quantity numeric(16,4);
  v_rate numeric(14,2);
  v_item_amount numeric(14,2);
  v_current_amount numeric(14,2) := 0;
  v_boq_item_id uuid;
  v_measurement_entry_id uuid;
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner', 'accountant', 'project_manager']::text[]) then
    raise exception 'You do not have permission to create contractor bills.';
  end if;
  if char_length(trim(coalesce(p_bill_number, ''))) = 0 then raise exception 'Bill number is required.'; end if;
  if coalesce(p_previous_amount, 0) < 0 or coalesce(p_deductions, 0) < 0 or coalesce(p_tax_amount, 0) < 0 then
    raise exception 'Bill amounts and deductions cannot be negative.';
  end if;
  if not exists (select 1 from public.vendors v where v.id = p_vendor_id and v.organization_id = p_organization_id and not v.is_archived) then
    raise exception 'Contractor was not found in this workspace.';
  end if;
  if p_project_id is not null and not exists (select 1 from public.projects p where p.id = p_project_id and p.organization_id = p_organization_id) then
    raise exception 'Project was not found in this workspace.';
  end if;
  if p_site_id is not null and not exists (select 1 from public.project_sites s where s.id = p_site_id and s.organization_id = p_organization_id and (p_project_id is null or s.project_id = p_project_id)) then
    raise exception 'Site was not found in the selected project.';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one bill line with its source references.';
  end if;

  for v_item in select rows.value from jsonb_array_elements(p_items) as rows(value) loop
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_rate := nullif(v_item->>'rate', '')::numeric;
    if v_quantity is null or v_quantity < 0 or v_rate is null or v_rate < 0 or char_length(trim(coalesce(v_item->>'description', ''))) = 0 then
      raise exception 'Every bill line needs a description, non-negative quantity, and non-negative rate.';
    end if;
    v_boq_item_id := nullif(v_item->>'boqItemId', '')::uuid;
    v_measurement_entry_id := nullif(v_item->>'measurementEntryId', '')::uuid;
    if v_boq_item_id is not null and not exists (
      select 1 from public.boq_items bi join public.boqs b on b.id = bi.boq_id
      where bi.id = v_boq_item_id and bi.organization_id = p_organization_id and b.status = 'approved'
        and (p_project_id is null or b.project_id = p_project_id)
    ) then raise exception 'A bill line references an unapproved or unauthorized BOQ item.'; end if;
    if v_measurement_entry_id is not null and not exists (
      select 1 from public.measurement_entries me join public.measurement_books mb on mb.id = me.measurement_book_id
      where me.id = v_measurement_entry_id and me.organization_id = p_organization_id and mb.status = 'approved'
        and (p_project_id is null or mb.project_id = p_project_id)
    ) then raise exception 'A bill line references an unapproved or unauthorized measurement.'; end if;
    v_current_amount := v_current_amount + round(v_quantity * v_rate, 2);
  end loop;
  if coalesce(p_deductions, 0) > coalesce(p_previous_amount, 0) + v_current_amount then
    raise exception 'Deductions cannot exceed the previous plus current bill amount.';
  end if;

  insert into public.contractor_bills(organization_id, project_id, site_id, vendor_id, bill_number, bill_date, previous_amount, current_amount, deductions, tax_amount, status, created_by)
  values (p_organization_id, p_project_id, p_site_id, p_vendor_id, trim(p_bill_number), p_bill_date, coalesce(p_previous_amount, 0), v_current_amount, coalesce(p_deductions, 0), coalesce(p_tax_amount, 0), 'draft', auth.uid())
  returning id into v_bill_id;

  for v_item in select rows.value from jsonb_array_elements(p_items) as rows(value) loop
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_rate := nullif(v_item->>'rate', '')::numeric;
    v_boq_item_id := nullif(v_item->>'boqItemId', '')::uuid;
    v_measurement_entry_id := nullif(v_item->>'measurementEntryId', '')::uuid;
    insert into public.contractor_bill_items(organization_id, contractor_bill_id, boq_item_id, measurement_entry_id, item_number, description, quantity, rate, source_ref)
    values (p_organization_id, v_bill_id, v_boq_item_id, v_measurement_entry_id, nullif(trim(coalesce(v_item->>'itemNumber', '')), ''), trim(v_item->>'description'), v_quantity, v_rate, nullif(trim(coalesce(v_item->>'sourceRef', '')), ''));
  end loop;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'contractor_bill.draft_created', 'contractor_bill', v_bill_id::text, jsonb_build_object('bill_number', p_bill_number, 'current_amount', v_current_amount));
  return v_bill_id;
end;
$$;
revoke all on function public.save_contractor_bill_review(uuid, uuid, uuid, uuid, text, date, numeric, numeric, numeric, jsonb) from public;
grant execute on function public.save_contractor_bill_review(uuid, uuid, uuid, uuid, text, date, numeric, numeric, numeric, jsonb) to authenticated;
