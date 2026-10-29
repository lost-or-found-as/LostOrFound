// src/contexts/AuthContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { ensureProfileRow } from "../lib/profile";
import { claimPendingGuestReports, rememberGuestForClaim } from "../lib/guestClaim";

export type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

type AuthProviderProps = {
  children: ReactNode;
};

function isAnonymousUser(user: any): boolean {
  return (
    user?.is_anonymous === true ||
    user?.isAnonymous === true ||
    user?.app_metadata?.provider === "anonymous" ||
    user?.user_metadata?.is_anonymous === true
  );
}


async function ensureProfileBestEffort(session: Session | null) {
  const uid = session?.user?.id;
  if (!uid) return;

  try {
    await ensureProfileRow(uid);
  } catch (e) {
    console.warn("[AuthContext] ensureProfileRow warning", e);
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const applySession = useCallback((nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
  }, []);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    applySession(data.session ?? null);
  }, [applySession]);

  useEffect(() => {
    let mounted = true;

    async function initializeSession() {
      try {
        setLoading(true);
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!mounted) return;
        applySession(data.session ?? null);
      } catch {
        if (!mounted) return;
        applySession(null);
      } finally {
        if (!mounted) return;
        setInitialized(true);
        setLoading(false);
      }
    }

    void initializeSession();

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      applySession(nextSession ?? null);
      // T1.9A: move found reports from an earlier guest session on this phone.
      if (nextSession?.user && !isAnonymousUser(nextSession.user)) {
        void claimPendingGuestReports(nextSession.access_token);
      }
      setInitialized(true);
      setLoading(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [applySession]);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      throw new Error("E-post og passord må fylles ut.");
    }

    setLoading(true);
    try {
      // T1.9A: keep the guest session alive on the server. Signing it out would revoke the
      // token that proves which found reports to move; the new sign-in replaces it locally.
      await rememberGuestForClaim();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) throw error;
      applySession(data.session ?? null);
      await ensureProfileBestEffort(data.session ?? null);
    } finally {
      setInitialized(true);
      setLoading(false);
    }
  }, [applySession]);

  const signUpWithPassword = useCallback(async (email: string, password: string) => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      throw new Error("E-post og passord må fylles ut.");
    }
    if (password.length < 6) {
      throw new Error("Passord må være minst 6 tegn.");
    }

    setLoading(true);
    try {
      // T1.9A: keep the guest session alive on the server. Signing it out would revoke the
      // token that proves which found reports to move; the new sign-in replaces it locally.
      await rememberGuestForClaim();

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      });

      if (error) throw error;
      applySession(data.session ?? null);
      await ensureProfileBestEffort(data.session ?? null);

      return { needsEmailConfirmation: !data.session };
    } finally {
      setInitialized(true);
      setLoading(false);
    }
  }, [applySession]);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      applySession(null);
    } finally {
      setInitialized(true);
      setLoading(false);
    }
  }, [applySession]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      session,
      loading,
      initialized,
      signInWithPassword,
      signUpWithPassword,
      signOut,
      refresh,
    }),
    [user, session, loading, initialized, signInWithPassword, signUpWithPassword, signOut, refresh]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
