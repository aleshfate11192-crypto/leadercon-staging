-- LeaderCon foundation: organization isolation and construction accounting tables.
-- Review the existing schema and RLS policies before applying this migration.
-- Legacy vendor rows intentionally receive a NULL organization_id and are denied
-- by the tenant-scoped policy until an administrator explicitly maps them.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'accountant', 'project_manager', 'site_engineer', 'auditor')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists organization_memberships_user_idx on public.organization_memberships(user_id, organization_id);

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(p_organization_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role = any(p_roles)
  );
$$;

create or replace function public.is_org_folder_member(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_org_member(p_folder::uuid)
    else false
  end;
$$;

create or replace function public.create_my_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Organization name must be between 2 and 120 characters.';
  end if;

  insert into public.organizations(name) values (v_name)
  returning id into v_organization_id;

  insert into public.organization_memberships(organization_id, user_id, role)
  values (v_organization_id, auth.uid(), 'owner');

  return v_organization_id;
end;
$$;
revoke all on function public.create_my_organization(text) from public;
grant execute on function public.create_my_organization(text) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
drop policy if exists organizations_member_read on public.organizations;
create policy organizations_member_read on public.organizations for select to authenticated
  using (public.is_org_member(id));
drop policy if exists memberships_self_or_owner_read on public.organization_memberships;
create policy memberships_self_or_owner_read on public.organization_memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.has_org_role(organization_id, array['owner']::text[]));

-- The established app already has this legacy table. A new staging project is
-- empty, so create its base shape here; on an existing database this is a no-op.
-- Existing rows and financial values are never replaced or backfilled here.
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  category text,
  opening_balance numeric(14,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

-- Tenant additions to the vendor table. Existing rows are not assigned.
alter table public.vendors add column if not exists organization_id uuid references public.organizations(id);
alter table public.vendors add column if not exists is_archived boolean not null default false;
alter table public.vendors add column if not exists contact_person text;
alter table public.vendors add column if not exists bank_account_holder text;
alter table public.vendors add column if not exists bank_name text;
alter table public.vendors add column if not exists bank_account_number text;
alter table public.vendors add column if not exists bank_ifsc text;
alter table public.vendors add column if not exists bank_branch text;
alter table public.vendors add column if not exists bank_account_type text;
alter table public.vendors add column if not exists created_by uuid references auth.users(id);
alter table public.vendors add column if not exists created_at timestamptz not null default now();
create index if not exists vendors_organization_active_idx on public.vendors(organization_id, is_archived);

alter table public.vendors enable row level security;
drop policy if exists vendors_organization_scope on public.vendors;
create policy vendors_organization_scope on public.vendors as restrictive for all to authenticated
  using (organization_id is not null and public.is_org_member(organization_id))
  with check (organization_id is not null and public.is_org_member(organization_id));
drop policy if exists vendors_member_read on public.vendors;
create policy vendors_member_read on public.vendors for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists vendors_finance_insert on public.vendors;
create policy vendors_finance_insert on public.vendors for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'accountant']::text[]));
drop policy if exists vendors_finance_update on public.vendors;
create policy vendors_finance_update on public.vendors for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'accountant']::text[]))
  with check (public.has_org_role(organization_id, array['owner', 'accountant']::text[]));

-- Upgrade or create the existing ledger table without guessing old row meanings.
create table if not exists public.vendor_transactions (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  organization_id uuid references public.organizations(id),
  project_id uuid,
  transaction_type text,
  transaction_date date,
  reference_number text,
  description text,
  amount numeric(14,2),
  due_date date,
  status text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.vendor_transactions add column if not exists organization_id uuid references public.organizations(id);
alter table public.vendor_transactions add column if not exists project_id uuid;
alter table public.vendor_transactions add column if not exists transaction_type text;
alter table public.vendor_transactions add column if not exists transaction_date date;
alter table public.vendor_transactions add column if not exists reference_number text;
alter table public.vendor_transactions add column if not exists description text;
alter table public.vendor_transactions add column if not exists amount numeric(14,2);
alter table public.vendor_transactions add column if not exists due_date date;
-- Leave legacy transactions unclassified. New app entries set status explicitly
-- through the posting RPC so a schema upgrade never changes old ledger meaning.
alter table public.vendor_transactions add column if not exists status text;
alter table public.vendor_transactions add column if not exists created_by uuid references auth.users(id);
alter table public.vendor_transactions add column if not exists created_at timestamptz not null default now();
create index if not exists vendor_transactions_org_date_idx on public.vendor_transactions(organization_id, transaction_date desc);
create index if not exists vendor_transactions_vendor_idx on public.vendor_transactions(vendor_id, transaction_date desc);

alter table public.vendor_transactions enable row level security;
drop policy if exists vendor_transactions_organization_scope on public.vendor_transactions;
create policy vendor_transactions_organization_scope on public.vendor_transactions as restrictive for all to authenticated
  using (organization_id is not null and public.is_org_member(organization_id))
  with check (organization_id is not null and public.is_org_member(organization_id));
drop policy if exists vendor_transactions_member_read on public.vendor_transactions;
create policy vendor_transactions_member_read on public.vendor_transactions for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists vendor_transactions_finance_write on public.vendor_transactions;
create policy vendor_transactions_finance_write on public.vendor_transactions for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'accountant']::text[]));
drop policy if exists vendor_transactions_finance_update on public.vendor_transactions;
create policy vendor_transactions_finance_update on public.vendor_transactions for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'accountant']::text[]))
  with check (public.has_org_role(organization_id, array['owner', 'accountant']::text[]));

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_code text,
  name text not null,
  client_department text,
  contract_number text,
  location text,
  start_date date,
  expected_completion_date date,
  contract_value numeric(14,2) not null default 0,
  budget numeric(14,2) not null default 0,
  project_manager text,
  status text not null default 'active' check (status in ('planning', 'active', 'on_hold', 'completed', 'archived')),
  notes text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_org_status_idx on public.projects(organization_id, status);

create table if not exists public.project_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  department text,
  location text,
  status text not null default 'active',
  notes text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists project_sites_project_idx on public.project_sites(organization_id, project_id);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploader_id uuid references auth.users(id),
  project_id uuid references public.projects(id),
  site_id uuid references public.project_sites(id),
  vendor_id uuid references public.vendors(id),
  transaction_id uuid references public.vendor_transactions(id),
  document_type text not null default 'other',
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size_bytes bigint,
  content_hash text,
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'review', 'approved', 'rejected', 'failed')),
  ai_extraction jsonb,
  reviewed_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists documents_org_created_idx on public.documents(organization_id, created_at desc);

create table if not exists public.boqs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id),
  site_id uuid references public.project_sites(id),
  document_id uuid references public.documents(id),
  name text not null,
  version_number integer not null default 1,
  revision_date date,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'superseded')),
  change_summary text,
  total_amount numeric(14,2) not null default 0,
  created_by uuid references auth.users(id) default auth.uid(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists boqs_org_project_idx on public.boqs(organization_id, project_id, created_at desc);

create table if not exists public.boq_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  boq_id uuid not null references public.boqs(id) on delete cascade,
  item_number text,
  description text not null,
  unit text,
  quantity numeric(16,4),
  rate numeric(14,2),
  amount numeric(14,2),
  specification text,
  source_ref text,
  confidence numeric(4,3),
  created_at timestamptz not null default now()
);
create index if not exists boq_items_boq_item_idx on public.boq_items(boq_id, item_number);

create table if not exists public.measurement_books (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id),
  site_id uuid references public.project_sites(id),
  document_id uuid references public.documents(id),
  number text not null,
  measured_on date,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'rejected')),
  notes text,
  created_by uuid references auth.users(id) default auth.uid(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.measurement_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  measurement_book_id uuid not null references public.measurement_books(id) on delete cascade,
  boq_item_id uuid references public.boq_items(id),
  item_number text,
  description text,
  length numeric(16,4),
  width numeric(16,4),
  height_depth numeric(16,4),
  units_count numeric(16,4),
  quantity numeric(16,4) not null default 0,
  unit text,
  source_ref text,
  created_at timestamptz not null default now()
);
create index if not exists measurement_entries_book_idx on public.measurement_entries(measurement_book_id, item_number);

create table if not exists public.contractor_bills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id),
  site_id uuid references public.project_sites(id),
  vendor_id uuid references public.vendors(id),
  bill_number text not null,
  bill_date date not null,
  previous_amount numeric(14,2) not null default 0,
  current_amount numeric(14,2) not null default 0,
  deductions numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  net_payable numeric(14,2) generated always as (previous_amount + current_amount - deductions + tax_amount) stored,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'paid', 'rejected')),
  notes text,
  created_by uuid references auth.users(id) default auth.uid(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.contractor_bill_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contractor_bill_id uuid not null references public.contractor_bills(id) on delete cascade,
  boq_item_id uuid references public.boq_items(id),
  measurement_entry_id uuid references public.measurement_entries(id),
  item_number text,
  description text not null,
  quantity numeric(16,4) not null default 0,
  rate numeric(14,2) not null default 0,
  amount numeric(14,2) generated always as (quantity * rate) stored,
  source_ref text
);

create table if not exists public.procurement_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id),
  site_id uuid references public.project_sites(id),
  vendor_id uuid references public.vendors(id),
  material_name text not null,
  category text,
  quantity numeric(16,4) not null default 0,
  unit text,
  unit_rate numeric(14,2) not null default 0,
  amount numeric(14,2) generated always as (quantity * unit_rate) stored,
  order_date date not null default current_date,
  reference_number text,
  status text not null default 'requested' check (status in ('requested', 'ordered', 'part_received', 'received', 'cancelled')),
  notes text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.labour_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id),
  site_id uuid references public.project_sites(id),
  vendor_id uuid references public.vendors(id),
  category text not null,
  work_date date not null default current_date,
  workers_count integer not null default 0 check (workers_count >= 0),
  days numeric(8,2) not null default 0 check (days >= 0),
  rate numeric(14,2) not null default 0,
  amount numeric(14,2) generated always as (workers_count * days * rate) stored,
  work_description text,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid')),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- RLS for new organization-owned data.
do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'project_sites', 'documents', 'boqs', 'boq_items',
    'measurement_books', 'measurement_entries', 'contractor_bills',
    'contractor_bill_items', 'procurement_records', 'labour_records', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))', t || '_member_read', t);

    if t <> 'audit_logs' then
      execute format('drop policy if exists %I on public.%I', t || '_member_insert', t);
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.has_org_role(organization_id, array[''owner'', ''accountant'', ''project_manager'', ''site_engineer'']::text[]))',
        t || '_member_insert', t
      );
      execute format('drop policy if exists %I on public.%I', t || '_member_update', t);
      execute format(
        'create policy %I on public.%I for update to authenticated using (public.has_org_role(organization_id, array[''owner'', ''accountant'', ''project_manager'', ''site_engineer'']::text[])) with check (public.has_org_role(organization_id, array[''owner'', ''accountant'', ''project_manager'', ''site_engineer'']::text[]))',
        t || '_member_update', t
      );
    else
      execute format('drop policy if exists %I on public.%I', t || '_member_insert', t);
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.is_org_member(organization_id) and actor_id = (select auth.uid()))',
        t || '_member_insert', t
      );
    end if;
  end loop;
end $$;

-- Scope the legacy vendor-document metadata through its parent vendor if present.
do $$
begin
  if to_regclass('public.vendor_documents') is not null then
    execute 'alter table public.vendor_documents enable row level security';
    execute 'drop policy if exists vendor_documents_organization_scope on public.vendor_documents';
    execute $policy$
      create policy vendor_documents_organization_scope on public.vendor_documents as restrictive for all to authenticated
      using (exists (
        select 1 from public.vendors v
        where v.id = vendor_documents.vendor_id
          and v.organization_id is not null
          and public.is_org_member(v.organization_id)
      ))
      with check (exists (
        select 1 from public.vendors v
        where v.id = vendor_documents.vendor_id
          and v.organization_id is not null
          and public.is_org_member(v.organization_id)
      ))
    $policy$;
  end if;
end $$;

-- The existing bucket remains private. Existing user-id-prefixed uploads remain
-- accessible only to their uploader; organization-id-prefixed uploads are shared
-- only with members of that organization.
insert into storage.buckets(id, name, public, file_size_limit)
values ('sumanik-documents', 'sumanik-documents', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

create or replace function public.can_access_leadercon_document_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] = (select auth.uid())::text then true
    else public.is_org_folder_member((storage.foldername(p_name))[1])
  end;
$$;

drop policy if exists leadercon_documents_scope on storage.objects;
create policy leadercon_documents_scope on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'sumanik-documents' or public.can_access_leadercon_document_path(name))
  with check (bucket_id <> 'sumanik-documents' or public.can_access_leadercon_document_path(name));
drop policy if exists leadercon_documents_read on storage.objects;
create policy leadercon_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'sumanik-documents' and public.can_access_leadercon_document_path(name));
drop policy if exists leadercon_documents_insert on storage.objects;
create policy leadercon_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sumanik-documents' and public.can_access_leadercon_document_path(name));
drop policy if exists leadercon_documents_update on storage.objects;
create policy leadercon_documents_update on storage.objects for update to authenticated
  using (bucket_id = 'sumanik-documents' and public.can_access_leadercon_document_path(name))
  with check (bucket_id = 'sumanik-documents' and public.can_access_leadercon_document_path(name));
drop policy if exists leadercon_documents_delete on storage.objects;
create policy leadercon_documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sumanik-documents' and public.can_access_leadercon_document_path(name));
