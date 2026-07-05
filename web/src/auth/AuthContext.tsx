// Session state for the console (REQ-012/014). On mount it asks GET /api/auth/me who the current
// staff is; it registers a global 401 handler so that ANY unauthorized response anywhere in the
// app clears session state and drops the user back to the login screen (REQ-014). A session is
// only ever established by the BFF setting its cookie after both auth factors pass (REQ-016); the
// FSM login flow calls `login(staff)` once the BFF has done so.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import * as api from '../api/client';
import { setUnauthorizedHandler } from '../api/client';
import type { Staff } from '../api/types';

interface AuthContextValue {
  staff: Staff | null;
  loading: boolean;
  login: (staff: Staff) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { staff: current } = await api.me();
      setStaff(current);
    } catch {
      // Not authenticated (401 handled globally too) or transient failure — treat as logged out.
      setStaff(null);
    }
  }, []);

  const login = useCallback((next: Staff) => {
    setStaff(next);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setStaff(null);
    }
  }, []);

  useEffect(() => {
    // Any 401 clears session state → App renders the login screen (REQ-014).
    setUnauthorizedHandler(() => setStaff(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ staff, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
