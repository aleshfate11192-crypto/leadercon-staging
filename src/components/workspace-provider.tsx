"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, supabaseReady } from "@/lib/supabase";

export type Organization = {
  id: string;
  name: string;
  role: string;
};

type WorkspaceContextValue = {
  user: User | null;
  organizations: Organization[];
  organization: Organization | null;
  setOrganizationId: (id: string) => void;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

type MembershipRow = {
  organization_id: string;
  role: string;
  organization: { id: string; name: string } | Array<{ id: string; name: string }> | null;
};

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [loading, setLoading] = useState(supabaseReady);
  const [error, setError] = useState(supabaseReady ? "" : "Supabase configuration is missing.");

  const reload = useCallback(async () => {
    if (!supabaseReady) {
      return;
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setUser(null);
      setOrganizations([]);
      setLoading(false);
      setError(authError?.message || "Sign in to continue.");
      return;
    }

    setUser(authData.user);
    const { data, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("organization_id, role, organization:organizations(id, name)")
      .eq("user_id", authData.user.id)
      .order("created_at", { ascending: true });

    if (membershipError) {
      setOrganizations([]);
      setError(membershipError.message);
      setLoading(false);
      return;
    }

    const mapped = ((data ?? []) as MembershipRow[]).flatMap((row) => {
      const joined = Array.isArray(row.organization)
        ? row.organization[0]
        : row.organization;
      return joined
        ? [{ id: joined.id, name: joined.name, role: row.role }]
        : [];
    });
    setOrganizations(mapped);
    setSelectedOrganizationId((current) =>
      mapped.some((org) => org.id === current) ? current : mapped[0]?.id ?? "",
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void reload(), 0);
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      window.setTimeout(() => void reload(), 0);
    });
    return () => { window.clearTimeout(initialLoad); data.subscription.unsubscribe(); };
  }, [reload]);

  const organization = useMemo(
    () => organizations.find((item) => item.id === selectedOrganizationId) ?? null,
    [organizations, selectedOrganizationId],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      user,
      organizations,
      organization,
      setOrganizationId: setSelectedOrganizationId,
      loading,
      error,
      reload,
    }),
    [user, organizations, organization, loading, error, reload],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return value;
}
