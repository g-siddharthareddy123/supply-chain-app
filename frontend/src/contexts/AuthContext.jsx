import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api";
import {
  clearAccessToken,
  getAccessToken,
  SESSION_EXPIRED_EVENT,
  setAccessToken,
} from "../auth/session";

const AuthContext = createContext(null);
let profileRequest;

function getCurrentProfile() {
  if (!profileRequest) {
    profileRequest = api.auth.me().finally(() => {
      profileRequest = null;
    });
  }
  return profileRequest;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const handleExpiredSession = () => {
      clearAccessToken();
      setUser(null);
      setLoading(false);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpiredSession);

    if (!getAccessToken()) {
      setLoading(false);
    } else {
      getCurrentProfile()
        .then((profile) => {
          if (active) setUser(profile);
        })
        .catch(() => {
          clearAccessToken();
          if (active) setUser(null);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => {
      active = false;
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpiredSession);
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const result = await api.auth.login({ email, password });
    setAccessToken(result.access_token);
    try {
      const profile = await api.auth.me();
      setUser(profile);
      return profile;
    } catch (error) {
      clearAccessToken();
      throw error;
    }
  }, []);

  const logout = useCallback(() => {
    clearAccessToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
