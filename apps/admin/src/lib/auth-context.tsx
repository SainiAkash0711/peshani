import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { apiClient, hasStoredSession, login as apiLogin, logout as apiLogout } from './api-client';

export interface CurrentUser {
  userId: string;
  storeId: string;
  email: string;
  type: 'CUSTOMER' | 'ADMIN';
  roles: string[];
  permissions: string[];
}

interface AuthContextValue {
  user: CurrentUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (key: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// /auth/login is shared with the customer storefront (same account, same
// endpoint, same valid credentials either way) - it has no way to know at
// that point which app is calling it, so a customer's email/password
// legitimately succeeds there. Enforcing "this account may actually use
// the admin panel" is this app's own job: a customer account can
// authenticate but has zero admin permissions, so every page here would
// otherwise fail with a generic "Failed to load X" error instead of a
// clear reason - confirmed by a real customer account reaching exactly
// that broken state before this check existed. Used both right after an
// explicit login and when reviving a previously-stored session on reload,
// so a customer never gets stuck in the broken shell either way.
async function fetchAdminOnlyUser(): Promise<CurrentUser | null> {
  const me = await apiClient.get<CurrentUser>('/auth/me');
  if (me.type !== 'ADMIN') {
    await apiLogout();
    return null;
  }
  return me;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadCurrentUser() {
    if (!hasStoredSession()) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      setUser(await fetchAdminOnlyUser());
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadCurrentUser();
  }, []);

  async function login(email: string, password: string) {
    await apiLogin(email, password);
    const me = await fetchAdminOnlyUser();
    setIsLoading(false);
    if (!me) {
      setUser(null);
      throw new Error('This account does not have admin access.');
    }
    setUser(me);
  }

  async function logout() {
    await apiLogout();
    setUser(null);
  }

  function hasPermission(key: string): boolean {
    return user?.permissions.includes(key) ?? false;
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
