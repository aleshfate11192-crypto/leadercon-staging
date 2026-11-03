-- Approval transitions are auditable and role-checked in the database.

create or replace function public.guard_construction_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_needs_approval boolean := false;
begin
  if tg_op = 'INSERT' then
    v_needs_approval := new.status = 'approved';
  elsif tg_op = 'UPDATE' then
    if old.status in ('approved', 'superseded') then
      if tg_table_name = 'boqs' and old.status = 'approved' and new.status = 'superseded'
        and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
        return new;
      end if;
      raise exception 'Approved records are immutable. Create a new version or correction record.';
    end if;
    v_needs_approval := new.status = 'approved' and old.status is distinct from 'approved';
  end if;
  if v_needs_approval then
    if not public.has_org_role(new.organization_id, array['owner', 'accountant', 'project_manager']::text[]) then
      raise exception 'Only an owner, accountant, or project manager can approve this record.';
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.guard_approved_construction_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_parent_status text;
  v_parent_id uuid;
begin
  for v_row in
    select row_value
    from (values
      (case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null::jsonb end),
      (case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null::jsonb end)
    ) as affected(row_value)
    where row_value is not null
  loop
    v_parent_status := null;
    if tg_table_name = 'boq_items' then
      v_parent_id := (v_row->>'boq_id')::uuid;
      select b.status into v_parent_status from public.boqs b where b.id = v_parent_id;
    elsif tg_table_name = 'measurement_entries' then
      v_parent_id := (v_row->>'measurement_book_id')::uuid;
      select b.status into v_parent_status from public.measurement_books b where b.id = v_parent_id;
    elsif tg_table_name = 'contractor_bill_items' then
      v_parent_id := (v_row->>'contractor_bill_id')::uuid;
      select b.status into v_parent_status from public.contractor_bills b where b.id = v_parent_id;
    end if;
    if v_parent_status in ('approved', 'superseded') then
      raise exception 'Items in an approved construction record cannot be changed.';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists boq_items_approved_immutable on public.boq_items;
create trigger boq_items_approved_immutable before insert or update or delete on public.boq_items
  for each row execute function public.guard_approved_construction_items();
drop trigger if exists measurement_entries_approved_immutable on public.measurement_entries;
create trigger measurement_entries_approved_immutable before insert or update or delete on public.measurement_entries
  for each row execute function public.guard_approved_construction_items();
drop trigger if exists contractor_bill_items_approved_immutable on public.contractor_bill_items;
create trigger contractor_bill_items_approved_immutable before insert or update or delete on public.contractor_bill_items
  for each row execute function public.guard_approved_construction_items();

drop trigger if exists boqs_guard_approval on public.boqs;
create trigger boqs_guard_approval before insert or update on public.boqs
  for each row execute function public.guard_construction_approval();
drop trigger if exists measurement_books_guard_approval on public.measurement_books;
create trigger measurement_books_guard_approval before insert or update on public.measurement_books
  for each row execute function public.guard_construction_approval();
drop trigger if exists contractor_bills_guard_approval on public.contractor_bills;
create trigger contractor_bills_guard_approval before insert or update on public.contractor_bills
  for each row execute function public.guard_construction_approval();

create or replace function public.approve_boq(p_organization_id uuid, p_boq_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner', 'accountant', 'project_manager']::text[]) then
    raise exception 'Only an owner, accountant, or project manager can approve a BOQ.';
  end if;
  if not exists (select 1 from public.boq_items i where i.boq_id = p_boq_id and i.organization_id = p_organization_id) then
    raise exception 'Add at least one reviewed BOQ item before approval.';
  end if;
  update public.boqs set status = 'approved' where id = p_boq_id and organization_id = p_organization_id and status in ('draft', 'review');
  if not found then raise exception 'The BOQ is not available for approval.'; end if;
  update public.documents set status = 'approved', approved_by = auth.uid() where boq_id = p_boq_id and organization_id = p_organization_id;
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id)
  values (p_organization_id, auth.uid(), 'boq.approved', 'boq', p_boq_id::text);
end;
$$;
revoke all on function public.approve_boq(uuid, uuid) from public;
grant execute on function public.approve_boq(uuid, uuid) to authenticated;

create or replace function public.approve_measurement_book(p_organization_id uuid, p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner', 'accountant', 'project_manager']::text[]) then
    raise exception 'Only an owner, accountant, or project manager can approve a Measurement Book.';
  end if;
  if not exists (select 1 from public.measurement_entries i where i.measurement_book_id = p_book_id and i.organization_id = p_organization_id) then
    raise exception 'Add at least one reviewed measurement before approval.';
  end if;
  update public.measurement_books set status = 'approved' where id = p_book_id and organization_id = p_organization_id and status in ('draft', 'review');
  if not found then raise exception 'The Measurement Book is not available for approval.'; end if;
  update public.documents set status = 'approved', approved_by = auth.uid() where measurement_book_id = p_book_id and organization_id = p_organization_id;
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id)
  values (p_organization_id, auth.uid(), 'measurement_book.approved', 'measurement_book', p_book_id::text);
end;
$$;
revoke all on function public.approve_measurement_book(uuid, uuid) from public;
grant execute on function public.approve_measurement_book(uuid, uuid) to authenticated;

create or replace function public.approve_contractor_bill(p_organization_id uuid, p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner', 'accountant', 'project_manager']::text[]) then
    raise exception 'Only an owner, accountant, or project manager can approve a contractor bill.';
  end if;
  if not exists (
    select 1 from public.contractor_bill_items i
    where i.contractor_bill_id = p_bill_id and i.organization_id = p_organization_id
      and (
        exists (select 1 from public.boq_items bi join public.boqs b on b.id = bi.boq_id
          where bi.id = i.boq_item_id and bi.organization_id = p_organization_id and b.status = 'approved')
        or exists (select 1 from public.measurement_entries me join public.measurement_books mb on mb.id = me.measurement_book_id
          where me.id = i.measurement_entry_id and me.organization_id = p_organization_id and mb.status = 'approved')
      )
  ) then raise exception 'Link a bill line to an approved BOQ item or Measurement Book entry before approval.'; end if;
  update public.contractor_bills set status = 'approved' where id = p_bill_id and organization_id = p_organization_id and status in ('draft', 'review');
  if not found then raise exception 'The contractor bill is not available for approval.'; end if;
  update public.documents set status = 'approved', approved_by = auth.uid() where contractor_bill_id = p_bill_id and organization_id = p_organization_id;
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id)
  values (p_organization_id, auth.uid(), 'contractor_bill.approved', 'contractor_bill', p_bill_id::text);
end;
$$;
revoke all on function public.approve_contractor_bill(uuid, uuid) from public;
grant execute on function public.approve_contractor_bill(uuid, uuid) to authenticated;
