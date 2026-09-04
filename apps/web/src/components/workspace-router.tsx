"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { type AccountType, useAuth } from "@/components/auth-provider";

export function WorkspaceRouter() {
  const router = useRouter();
  const { workspaceHome } = useAuth();

  useEffect(() => {
    router.replace(workspaceHome);
  }, [router, workspaceHome]);

  return <p className="sr-only" role="status">Opening your workspace</p>;
}

export function AudienceGate({
  audience,
  children,
}: {
  audience: AccountType;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { accountType, workspaceHome } = useAuth();
  const allowed = accountType === audience;

  useEffect(() => {
    if (!allowed) router.replace(workspaceHome);
  }, [allowed, router, workspaceHome]);

  if (!allowed) return <p className="sr-only" role="status">Opening your account workspace</p>;
  return children;
}
