-- Database-backed AI rate limits, retry-safe vendor posting, and stricter
-- private-storage write controls. This migration adds no financial records.

create table if not exists public.ai_request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);
alter table public.ai_request_limits enable row level security;
revoke all on table public.ai_request_limits from public, anon, authenticated;

create or replace function public.consume_ai_request_limit(
  p_max_requests integer default 6,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_started_at timestamptz;
  v_request_count integer;
begin
  if v_user_id is null then raise exception 'Sign in is required.'; end if;
  if p_max_requests is null or p_window_seconds is null
    or p_max_requests < 1 or p_max_requests > 60
    or p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'Invalid rate limit parameters.';
  end if;

  insert into public.ai_request_limits(user_id, window_started_at, request_count)
  values (v_user_id, v_now, 1)
  on conflict (user_id) do update set
    window_started_at = case
      when public.ai_request_limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now then v_now
      else public.ai_request_limits.window_started_at
    end,
    request_count = case
      when public.ai_request_limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now then 1
      else least(public.ai_request_limits.request_count + 1, p_max_requests + 1)
    end
  returning window_started_at, request_count into v_started_at, v_request_count;

  return v_request_count <= p_max_requests
    and v_started_at + make_interval(secs => p_window_seconds) > v_now;
end;
$$;
revoke all on function public.consume_ai_request_limit(integer, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_request_limit(integer, integer) to authenticated;

create table if not exists public.vendor_transaction_idempotency (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  transaction_id uuid not null unique references public.vendor_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, idempotency_key)
);
alter table public.vendor_transaction_idempotency enable row level security;
revoke all on table public.vendor_transaction_idempotency from public, anon, authenticated;

-- All application writes now go through the wrapper. The original function
-- remains available to this SECURITY DEFINER wrapper, but not to browser RPCs.
revoke all on function public.create_vendor_transaction(
  uuid, uuid, text, date, numeric, text, text, date, uuid, text, jsonb
) from public, anon, authenticated;

create or replace function public.create_vendor_transaction_idempotent(
  p_idempotency_key uuid,
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
  v_user_id uuid := auth.uid();
  v_existing_request jsonb;
  v_transaction_id uuid;
  v_request_payload jsonb;
begin
  if v_user_id is null then raise exception 'Sign in is required.'; end if;
  if p_idempotency_key is null then raise exception 'A retry key is required.'; end if;
  if not public.has_org_role(p_organization_id, array['owner', 'accountant']::text[]) then
    raise exception 'You do not have permission to post financial records.';
  end if;

  v_request_payload := jsonb_build_object(
    'vendor_id', p_vendor_id,
    'transaction_type', p_transaction_type,
    'transaction_date', p_transaction_date,
    'amount', p_amount,
    'reference_number', p_reference_number,
    'description', p_description,
    'due_date', p_due_date,
    'project_id', p_project_id,
    'status', p_status,
    'allocations', coalesce(p_allocations, '[]'::jsonb)
  );

  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':' || p_organization_id::text || ':' || p_idempotency_key::text, 0
  ));

  select i.request_payload, i.transaction_id into v_existing_request, v_transaction_id
  from public.vendor_transaction_idempotency i
  where i.organization_id = p_organization_id
    and i.user_id = v_user_id
    and i.idempotency_key = p_idempotency_key;
  if found then
    if v_existing_request <> v_request_payload then
      raise exception 'This retry key was already used with different transaction details.';
    end if;
    return v_transaction_id;
  end if;

  v_transaction_id := public.create_vendor_transaction(
    p_organization_id, p_vendor_id, p_transaction_type, p_transaction_date,
    p_amount, p_reference_number, p_description, p_due_date, p_project_id,
    p_status, p_allocations
  );
  insert into public.vendor_transaction_idempotency(
    organization_id, user_id, idempotency_key, request_payload, transaction_id
  ) values (
    p_organization_id, v_user_id, p_idempotency_key, v_request_payload, v_transaction_id
  );
  return v_transaction_id;
end;
$$;
revoke all on function public.create_vendor_transaction_idempotent(
  uuid, uuid, uuid, text, date, numeric, text, text, date, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_vendor_transaction_idempotent(
  uuid, uuid, uuid, text, date, numeric, text, text, date, uuid, text, jsonb
) to authenticated;

-- Supabase Storage enforces these content types and the existing 20 MiB limit.
update storage.buckets
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = array[
      'application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'text/csv',
      'application/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]::text[]
where id = 'sumanik-documents';

-- Make upload, replacement, and deletion role-aware even if another permissive
-- storage policy exists. A user can still clean up their own in-flight upload.
drop policy if exists leadercon_documents_insert_roles on storage.objects;
create policy leadercon_documents_insert_roles on storage.objects as restrictive for insert to authenticated
  with check (
    bucket_id = 'sumanik-documents'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (storage.foldername(name))[2] = (select auth.uid())::text
            and public.has_org_role((storage.foldername(name))[1]::uuid, array['owner', 'accountant', 'project_manager', 'site_engineer']::text[])
        else false
      end
    )
  );

drop policy if exists leadercon_documents_update_roles on storage.objects;
create policy leadercon_documents_update_roles on storage.objects as restrictive for update to authenticated
  using (
    bucket_id = 'sumanik-documents'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then public.has_org_role((storage.foldername(name))[1]::uuid, array['owner', 'accountant', 'project_manager']::text[])
        else false
      end
    )
  )
  with check (
    bucket_id = 'sumanik-documents'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then public.has_org_role((storage.foldername(name))[1]::uuid, array['owner', 'accountant', 'project_manager']::text[])
        else false
      end
    )
  );

drop policy if exists leadercon_documents_delete_roles on storage.objects;
create policy leadercon_documents_delete_roles on storage.objects as restrictive for delete to authenticated
  using (
    bucket_id = 'sumanik-documents'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then public.has_org_role((storage.foldername(name))[1]::uuid, array['owner', 'accountant', 'project_manager']::text[])
        else false
      end
    )
  );
