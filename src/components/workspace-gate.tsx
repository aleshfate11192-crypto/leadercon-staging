"use client";

import { usePathname } from "next/navigation";
import AuthGuard from "@/app/vendors/auth-guard";
import AppShell from "@/components/app-shell";
import { WorkspaceProvider } from "@/components/workspace-provider";

export default function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login" || pathname.startsWith("/login/")) return <>{children}</>;

  return (
    <AuthGuard>
      <WorkspaceProvider>
        <AppShell>{children}</AppShell>
      </WorkspaceProvider>
    </AuthGuard>
  );
}
