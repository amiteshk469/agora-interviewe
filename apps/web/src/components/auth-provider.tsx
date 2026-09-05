"use client";

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "error";
export type AccountType = "candidate" | "recruiter";

type AuthResult = { confirmationRequired: boolean };

export type CandidatePreferences = {
  targetRole: string;
  durationMinutes: number;
  difficulty: "supportive" | "balanced" | "challenging" | "executive";
  panelSize: number;
  allowInterruption: boolean;
};

export type CandidateProfileUpdate = {
  displayName: string;
  preferences: CandidatePreferences;
};

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  accountType: AccountType;
  workspaceHome: "/candidate" | "/recruiter";
  displayName: string;
  initials: string;
  error: string;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, accountType: AccountType, nextPath?: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  updateProfile: (updates: CandidateProfileUpdate) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Authentication could not be completed.";
}

function identityFor(user: User | null) {
  const metadata = user?.user_metadata ?? {};
  const name = String(metadata.display_name || metadata.full_name || "").trim();
  const fallback = user?.email?.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Candidate";
  const displayName = name || fallback.replace(/\b\w/g, (letter) => letter.toUpperCase());
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "C";
  return { displayName, initials };
}

function accountTypeFor(user: User | null): AccountType {
  return user?.user_metadata?.roundcraft_account_type === "recruiter" ? "recruiter" : "candidate";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");

  const applySession = useCallback((nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    setError("");
    setStatus(nextSession ? "authenticated" : "anonymous");
  }, []);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const client = getSupabaseBrowserClient();
      const current = await client.auth.getSession();
      if (current.error) throw current.error;

      if (!current.data.session) {
        applySession(null);
        return;
      }

      const validated = await client.auth.getUser();
      if (validated.error) throw validated.error;
      setSession(current.data.session);
      setUser(validated.data.user);
      setStatus("authenticated");
    } catch (cause) {
      setSession(null);
      setUser(null);
      setError(messageFrom(cause));
      setStatus("error");
    }
  }, [applySession]);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    let hydrationTimer: number | undefined;

    try {
      const client = getSupabaseBrowserClient();
      const listener = client.auth.onAuthStateChange((_event, nextSession) => {
        if (active) applySession(nextSession);
      });
      unsubscribe = () => listener.data.subscription.unsubscribe();
      hydrationTimer = window.setTimeout(() => void refresh(), 0);
    } catch (cause) {
      const setupError = messageFrom(cause);
      hydrationTimer = window.setTimeout(() => {
        if (!active) return;
        setError(setupError);
        setStatus("error");
      }, 0);
    }

    return () => {
      active = false;
      if (hydrationTimer !== undefined) window.clearTimeout(hydrationTimer);
      unsubscribe();
    };
  }, [applySession, refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await getSupabaseBrowserClient().auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    applySession(result.data.session);
  }, [applySession]);

  const signUp = useCallback(async (name: string, email: string, password: string, accountType: AccountType, nextPath = accountType === "recruiter" ? "/recruiter" : "/candidate") => {
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const result = await getSupabaseBrowserClient().auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name.trim(), full_name: name.trim(), roundcraft_account_type: accountType },
        emailRedirectTo: redirectTo,
      },
    });
    if (result.error) throw result.error;
    applySession(result.data.session);
    return { confirmationRequired: !result.data.session };
  }, [applySession]);

  const signOut = useCallback(async () => {
    const result = await getSupabaseBrowserClient().auth.signOut();
    if (result.error) throw result.error;
    applySession(null);
  }, [applySession]);

  const sendPasswordReset = useCallback(async (email: string) => {
    const result = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });
    if (result.error) throw result.error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const result = await getSupabaseBrowserClient().auth.updateUser({ password });
    if (result.error) throw result.error;
    setUser(result.data.user);
  }, []);

  const updateProfile = useCallback(async ({ displayName, preferences }: CandidateProfileUpdate) => {
    const result = await getSupabaseBrowserClient().auth.updateUser({
      data: {
        display_name: displayName.trim(),
        full_name: displayName.trim(),
        target_role: preferences.targetRole.trim(),
        roundcraft_preferences: {
          duration_minutes: preferences.durationMinutes,
          difficulty: preferences.difficulty,
          panel_size: preferences.panelSize,
          allow_interruption: preferences.allowInterruption,
        },
      },
    });
    if (result.error) throw result.error;
    setUser(result.data.user);
  }, []);

  const identity = useMemo(() => identityFor(user), [user]);
  const accountType = accountTypeFor(user);
  const workspaceHome = accountType === "recruiter" ? "/recruiter" as const : "/candidate" as const;
  const value = useMemo<AuthContextValue>(() => ({
    status,
    session,
    user,
    accountType,
    workspaceHome,
    error,
    refresh,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
    updatePassword,
    updateProfile,
    ...identity,
  }), [accountType, error, identity, refresh, sendPasswordReset, session, signIn, signOut, signUp, status, updatePassword, updateProfile, user, workspaceHome]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
