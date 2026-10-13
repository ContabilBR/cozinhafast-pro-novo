import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { BACKEND_URL, saveBearerToken, deleteBearerToken, getBearerToken, setMemoryToken } from "@/utils/api";

export type User = {
  id: string;
  nome: string;
  email: string;
  role: string;
  is_super_admin?: boolean;
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  // Legacy alias used by existing screens
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    restoreSession();
  }, []);

  const restoreSession = async () => {
    console.log("[Auth] Restoring session from storage");
    try {
      const stored = await getBearerToken();
      if (!stored) {
        console.log("[Auth] No stored token found");
        setIsLoading(false);
        return;
      }
      // Warm the in-memory cache immediately so any concurrent API calls work.
      setMemoryToken(stored);
      console.log("[Auth] GET /api/me");
      const response = await fetch(`${BACKEND_URL}/api/me`, {
        headers: {
          Authorization: `Bearer ${stored}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        console.warn("[Auth] /api/me returned", response.status, "— clearing token");
        await deleteBearerToken();
        setMemoryToken(null);
        setIsLoading(false);
        return;
      }
      const me: User = await response.json();
      console.log("[Auth] Session restored for:", me.email, "role:", me.role);
      setToken(stored);
      setUser(me);
    } catch (error) {
      console.error("[Auth] Failed to restore session:", error);
      await deleteBearerToken();
      setMemoryToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    console.log("[Auth] signIn called for:", email);
    console.log("[Auth] POST /api/login");
    const response = await fetch(`${BACKEND_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha: password }),
    });

    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        const json = JSON.parse(text);
        message = json.message || json.error || text;
      } catch {
        // use raw text
      }
      console.error("[Auth] Login failed:", response.status, message);
      throw new Error(message || "E-mail ou senha incorretos.");
    }

    const data = await response.json();
    const { token: newToken, user: newUser } = data;

    if (!newToken) {
      console.error("[Auth] Login response missing token:", JSON.stringify(data));
      throw new Error("Resposta de login inválida — token ausente.");
    }

    console.log("[Auth] Login successful for:", newUser?.email, "role:", newUser?.role);
    // Set memory token first so any immediate API calls after login work.
    setMemoryToken(newToken);
    await saveBearerToken(newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const signOut = async () => {
    console.log("[Auth] signOut called");
    setMemoryToken(null);
    await deleteBearerToken();
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        loading: isLoading,
        signIn,
        signInWithEmail: signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
