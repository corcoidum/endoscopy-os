import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  SESSION_EXPIRED_EVENT,
  authApi,
  type AuthUser,
  type ChangePasswordRequest,
  type LoginRequest,
} from "./api";

type AuthPhase =
  | "checking"
  | "unauthenticated"
  | "authenticating"
  | "authenticated"
  | "unavailable";

type AuthContextValue = {
  phase: AuthPhase;
  user: AuthUser | null;
  csrfToken: string | null;
  loginError: string;
  logoutError: string;
  sessionNotice: string;
  passwordChangeError: string;
  passwordChangePending: boolean;
  login: (credentials: LoginRequest) => Promise<boolean>;
  changePassword: (payload: ChangePasswordRequest) => Promise<boolean>;
  logout: () => Promise<boolean>;
  retrySessionCheck: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function loginErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "ID 또는 Password가 올바르지 않습니다.";
    }
    if (error.status === 429) {
      return "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    }
    return error.message;
  }
  return "로그인 중 알 수 없는 오류가 발생했습니다.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [loginError, setLoginError] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const [sessionNotice, setSessionNotice] = useState("");
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const [passwordChangePending, setPasswordChangePending] = useState(false);
  const [checkSequence, setCheckSequence] = useState(0);

  useEffect(() => {
    let active = true;
    setPhase("checking");

    void authApi
      .me()
      .then((response) => {
        if (!active) return;
        setUser(response.user);
        setCsrfToken(response.csrf_token);
        setSessionExpiresAt(
          Date.parse(response.idle_expires_at) <=
            Date.parse(response.absolute_expires_at)
            ? response.idle_expires_at
            : response.absolute_expires_at,
        );
        setPasswordChangeError("");
        setPasswordChangePending(false);
        setSessionNotice("");
        setPhase("authenticated");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setUser(null);
        setCsrfToken(null);
        setSessionExpiresAt(null);
        setPasswordChangePending(false);
        if (error instanceof ApiError && error.status === 401) {
          setPhase("unauthenticated");
          return;
        }
        setSessionNotice(
          error instanceof Error
            ? error.message
            : "로그인 상태를 확인하지 못했습니다.",
        );
        setPhase("unavailable");
      });

    return () => {
      active = false;
    };
  }, [checkSequence]);

  useEffect(() => {
    const expireSession = () => {
      setUser(null);
      setCsrfToken(null);
      setSessionExpiresAt(null);
      setLoginError("");
      setLogoutError("");
      setPasswordChangeError("");
      setPasswordChangePending(false);
      setSessionNotice("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
      setPhase("unauthenticated");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expireSession);
    return () =>
      window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession);
  }, []);

  useEffect(() => {
    if (phase !== "authenticated" || !sessionExpiresAt) return;

    const remaining = Date.parse(sessionExpiresAt) - Date.now();
    const expireSession = () => {
      setUser(null);
      setCsrfToken(null);
      setSessionExpiresAt(null);
      setLoginError("");
      setLogoutError("");
      setPasswordChangeError("");
      setPasswordChangePending(false);
      setSessionNotice("미사용 시간이 지나 자동 로그아웃되었습니다.");
      setPhase("unauthenticated");
    };

    if (!Number.isFinite(remaining) || remaining <= 0) {
      expireSession();
      return;
    }

    const timer = window.setTimeout(expireSession, remaining);
    return () => window.clearTimeout(timer);
  }, [phase, sessionExpiresAt]);

  const login = useCallback(async (credentials: LoginRequest) => {
    const loginId = credentials.login_id.trim();
    if (!loginId || !credentials.password) {
      setLoginError("ID와 Password를 모두 입력해 주세요.");
      return false;
    }

    setPhase("authenticating");
    setLoginError("");
    setLogoutError("");
    setPasswordChangeError("");
    try {
      const response = await authApi.login({
        login_id: loginId,
        password: credentials.password,
      });
      setUser(response.user);
      setCsrfToken(response.csrf_token);
      setSessionExpiresAt(
        Date.parse(response.idle_expires_at) <=
          Date.parse(response.absolute_expires_at)
          ? response.idle_expires_at
          : response.absolute_expires_at,
      );
      setSessionNotice("");
      setPhase("authenticated");
      return true;
    } catch (error) {
      setUser(null);
      setCsrfToken(null);
      setSessionExpiresAt(null);
      setPasswordChangePending(false);
      setLoginError(loginErrorMessage(error));
      setPhase("unauthenticated");
      return false;
    }
  }, []);

  const changePassword = useCallback(
    async (payload: ChangePasswordRequest) => {
      if (!payload.current_password || !payload.new_password) {
        setPasswordChangeError(
          "현재 Password와 새 Password를 모두 입력해 주세요.",
        );
        return false;
      }
      if (
        payload.new_password.length < 12 ||
        payload.new_password.length > 128
      ) {
        setPasswordChangeError("새 Password는 12~128자로 입력해 주세요.");
        return false;
      }
      if (payload.current_password === payload.new_password) {
        setPasswordChangeError(
          "새 Password는 현재 Password와 다르게 입력해 주세요.",
        );
        return false;
      }
      if (!csrfToken) {
        setPasswordChangeError(
          "보안 확인값이 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
        );
        return false;
      }

      setPasswordChangePending(true);
      setPasswordChangeError("");
      try {
        await authApi.changePassword(payload, csrfToken);
        setUser((current) =>
          current ? { ...current, must_change_password: false } : current,
        );
        return true;
      } catch (error) {
        setPasswordChangeError(
          error instanceof Error
            ? error.message
            : "Password를 변경하지 못했습니다. 다시 시도해 주세요.",
        );
        return false;
      } finally {
        setPasswordChangePending(false);
      }
    },
    [csrfToken],
  );

  const logout = useCallback(async () => {
    setLogoutError("");
    setPasswordChangeError("");
    setPasswordChangePending(false);
    try {
      await authApi.logout(csrfToken);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        setUser(null);
        setCsrfToken(null);
        setSessionExpiresAt(null);
        setLogoutError("");
        setSessionNotice(
          "화면은 잠갔지만 서버의 Session 종료를 확인하지 못했습니다. 네트워크 복구 후 다시 확인해 주세요.",
        );
        setPhase("unavailable");
        return false;
      }
    }

    setUser(null);
    setCsrfToken(null);
    setSessionExpiresAt(null);
    setSessionNotice("안전하게 로그아웃했습니다.");
    setPhase("unauthenticated");
    return true;
  }, [csrfToken]);

  const retrySessionCheck = useCallback(() => {
    setSessionNotice("");
    setCheckSequence((current) => current + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      phase,
      user,
      csrfToken,
      loginError,
      logoutError,
      sessionNotice,
      passwordChangeError,
      passwordChangePending,
      login,
      changePassword,
      logout,
      retrySessionCheck,
    }),
    [
      phase,
      user,
      csrfToken,
      loginError,
      logoutError,
      sessionNotice,
      passwordChangeError,
      passwordChangePending,
      login,
      changePassword,
      logout,
      retrySessionCheck,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth는 AuthProvider 안에서 사용해야 합니다.");
  }
  return context;
}
