-- PostgreSQL grants EXECUTE to PUBLIC unless it is explicitly removed.
-- The application uses authenticated and service_role grants instead.

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

revoke execute on all functions in schema public from public;
