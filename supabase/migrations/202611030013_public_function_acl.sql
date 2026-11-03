-- Supabase's default ACL grants new public-schema functions directly to anon.
-- Keep those defaults private and remove direct anon execution from existing
-- public functions while preserving grants to authenticated and service_role.

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

revoke execute on all functions in schema public from anon;
