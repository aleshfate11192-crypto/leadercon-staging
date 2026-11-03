-- Owner-controlled member administration for existing authenticated accounts.

create or replace function public.get_organization_members(p_organization_id uuid)
returns table(member_user_id uuid, email text, role text, joined_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner']::text[]) then
    raise exception 'Only a workspace owner can view the member directory.';
  end if;
  return query
    select m.user_id, coalesce(u.email, ''), m.role, m.created_at
    from public.organization_memberships m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id
    order by m.created_at;
end;
$$;
revoke all on function public.get_organization_members(uuid) from public;
grant execute on function public.get_organization_members(uuid) to authenticated;

create or replace function public.add_organization_member(p_organization_id uuid, p_email text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner']::text[]) then
    raise exception 'Only a workspace owner can add members.';
  end if;
  if p_role not in ('owner', 'accountant', 'project_manager', 'site_engineer', 'auditor') then
    raise exception 'Choose a supported workspace role.';
  end if;
  if v_email = '' then raise exception 'Enter the email address of an existing account.'; end if;
  select u.id into v_user_id from auth.users u where lower(u.email) = v_email limit 1;
  if v_user_id is null then raise exception 'No account exists for this email. Invite or create the account in Supabase Auth first.'; end if;
  insert into public.organization_memberships(organization_id, user_id, role)
  values (p_organization_id, v_user_id, p_role)
  on conflict (organization_id, user_id) do update set role = excluded.role;
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'membership.added_or_updated', 'organization_membership', v_user_id::text, jsonb_build_object('email', v_email, 'role', p_role));
  return v_user_id;
end;
$$;
revoke all on function public.add_organization_member(uuid, text, text) from public;
grant execute on function public.add_organization_member(uuid, text, text) to authenticated;

create or replace function public.set_organization_member_role(p_organization_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner']::text[]) then
    raise exception 'Only a workspace owner can change member roles.';
  end if;
  if p_role not in ('owner', 'accountant', 'project_manager', 'site_engineer', 'auditor') then
    raise exception 'Choose a supported workspace role.';
  end if;
  if p_user_id = auth.uid() and p_role <> 'owner'
    and (select count(*) from public.organization_memberships m where m.organization_id = p_organization_id and m.role = 'owner') <= 1 then
    raise exception 'The last owner cannot be demoted.';
  end if;
  update public.organization_memberships
  set role = p_role
  where organization_id = p_organization_id and user_id = p_user_id;
  if not found then raise exception 'Workspace member was not found.'; end if;
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'membership.role_changed', 'organization_membership', p_user_id::text, jsonb_build_object('role', p_role));
end;
$$;
revoke all on function public.set_organization_member_role(uuid, uuid, text) from public;
grant execute on function public.set_organization_member_role(uuid, uuid, text) to authenticated;

create or replace function public.rename_organization(p_organization_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null or not public.has_org_role(p_organization_id, array['owner']::text[]) then
    raise exception 'Only a workspace owner can rename the organization.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'Name must be between 2 and 120 characters.'; end if;
  update public.organizations set name = v_name where id = p_organization_id;
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'organization.renamed', 'organization', p_organization_id::text, jsonb_build_object('name', v_name));
end;
$$;
revoke all on function public.rename_organization(uuid, text) from public;
grant execute on function public.rename_organization(uuid, text) to authenticated;
