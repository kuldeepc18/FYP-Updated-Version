import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { adminApiClient, ADMIN_API_ENDPOINTS } from "@/config/api";

interface AdminUser {
  username: string;
  adminId: string;
  token?: string;
}

interface AdminAuthContextType {
  admin: AdminUser | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

interface LoginResponse {
  token: string;
  user: {
    email: string;
    name: string;
  };
}

// Use localStorage so the session survives browser refresh / tab close
const SESSION_KEY = "adminSession";

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(() => {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    try {
      // Authenticate against the QuestDB-backed admin API
      const response = await adminApiClient.post<LoginResponse>(
        ADMIN_API_ENDPOINTS.AUTH.LOGIN,
        { email: username, password }
      );

      const adminData: AdminUser = {
        username: response.data.user?.email || username,
        adminId:  response.data.user?.email || username,
        token:    response.data.token,
      };

      setAdmin(adminData);
      localStorage.setItem(SESSION_KEY, JSON.stringify(adminData));
      return true;
    } catch (error: any) {
      console.error("Admin login error:", error);
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminApiClient.post(ADMIN_API_ENDPOINTS.AUTH.LOGOUT);
    } catch {
      // ignore – we always clear the local session
    } finally {
      setAdmin(null);
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  return (
    <AdminAuthContext.Provider
      value={{
        admin,
        isAuthenticated: !!admin,
        login,
        logout,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (context === undefined) {
    throw new Error("useAdminAuth must be used within an AdminAuthProvider");
  }
  return context;
}
