export type AuthUser = {
  id: string;
  login_id: string;
  display_name: string;
  must_change_password: boolean;
  roles: string[];
  permissions: string[];
};

export type AuthResponse = {
  user: AuthUser;
  csrf_token: string;
  idle_expires_at: string;
  absolute_expires_at: string;
};

export type LoginRequest = {
  login_id: string;
  password: string;
};

export type ChangePasswordRequest = {
  current_password: string;
  new_password: string;
};

type ApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  csrfToken?: string | null;
  broadcastUnauthorized?: boolean;
};

export const SESSION_EXPIRED_EVENT = "clinic-auth-session-expired";
export const SESSION_REFRESHED_EVENT = "clinic-auth-session-refreshed";
const SESSION_EXPIRES_AT_HEADER = "X-Session-Expires-At";

export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function extractError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return { message: fallback, code: null };
  }

  const candidate = payload as {
    detail?: unknown;
    message?: unknown;
    code?: unknown;
  };
  const message =
    typeof candidate.detail === "string"
      ? candidate.detail
      : typeof candidate.message === "string"
        ? candidate.message
        : fallback;
  return {
    message,
    code: typeof candidate.code === "string" ? candidate.code : null,
  };
}

export async function apiRequest<ResponseBody>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ResponseBody> {
  const method = options.method ?? "GET";
  const headers = new Headers({ Accept: "application/json" });

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.csrfToken && method !== "GET") {
    headers.set("X-CSRF-Token", options.csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "include",
      cache: "no-store",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(
      0,
      "원내 서버에 연결할 수 없습니다. 서버 실행 상태와 네트워크 연결을 확인해 주세요.",
    );
  }

  const sessionExpiresAt = response.headers.get(SESSION_EXPIRES_AT_HEADER);
  if (response.ok && sessionExpiresAt && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<string>(SESSION_REFRESHED_EVENT, {
        detail: sessionExpiresAt,
      }),
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json().catch(() => undefined)
    : undefined;

  if (!response.ok) {
    if (
      response.status === 401 &&
      options.broadcastUnauthorized !== false &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }

    const fallback =
      response.status === 401
        ? "로그인이 필요하거나 세션이 만료되었습니다."
        : response.status === 403
          ? "이 작업을 수행할 권한이 없습니다."
          : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    const error = extractError(payload, fallback);
    throw new ApiError(response.status, error.message, error.code);
  }

  return payload as ResponseBody;
}

let currentUserRequest: Promise<AuthResponse> | null = null;

export const authApi = {
  me() {
    if (!currentUserRequest) {
      currentUserRequest = apiRequest<AuthResponse>("/api/auth/me", {
        broadcastUnauthorized: false,
      }).finally(() => {
        currentUserRequest = null;
      });
    }
    return currentUserRequest;
  },

  login(credentials: LoginRequest) {
    return apiRequest<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: credentials,
      broadcastUnauthorized: false,
    });
  },

  logout(csrfToken: string | null) {
    return apiRequest<void>("/api/auth/logout", {
      method: "POST",
      csrfToken,
      broadcastUnauthorized: false,
    });
  },

  changePassword(payload: ChangePasswordRequest, csrfToken: string | null) {
    return apiRequest<{ message: string }>("/api/auth/change-password", {
      method: "POST",
      body: payload,
      csrfToken,
    });
  },
};
