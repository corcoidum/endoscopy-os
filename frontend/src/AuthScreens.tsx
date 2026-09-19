import { useState } from "react";
import type {
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
} from "./api";
import { Icon } from "./icons";
import { BrandMark } from "./uiPrimitives";

export function LoginScreen({
  onLogin,
  isSubmitting,
  error,
  notice,
}: {
  onLogin: (credentials: LoginRequest) => Promise<boolean>;
  isSubmitting: boolean;
  error: string;
  notice: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");

  return (
    <main className="login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card__brand">
          <BrandMark />
          <div>
            <strong>내시경 운영 시스템</strong>
            <span>Clinic Endoscopy Operations</span>
          </div>
        </div>
        <div className="login-card__intro">
          <span className="eyebrow">원내 내부망 전용</span>
          <h1 id="login-title">직원 로그인</h1>
          <p>등록된 ID와 Password를 입력하세요.</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onLogin({ login_id: loginId, password });
          }}
        >
          <label className="field">
            <span>ID</span>
            <input
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={isSubmitting}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Password</span>
            <span className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="text-button"
                onClick={() => setShowPassword((current) => !current)}
                disabled={isSubmitting}
              >
                {showPassword ? "숨김" : "표시"}
              </button>
            </span>
          </label>
          {notice ? (
            <div className="login-feedback login-feedback--notice" role="status">
              <Icon name="info" />
              <span>{notice}</span>
            </div>
          ) : null}
          {error ? (
            <div className="login-feedback login-feedback--error" role="alert">
              <Icon name="warning" />
              <span>{error}</span>
            </div>
          ) : null}
          <div className="login-card__notice">
            <Icon name="clock" />
            <span>30분 동안 사용하지 않으면 자동 로그아웃됩니다.</span>
          </div>
          <button
            className="primary-button primary-button--wide"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "로그인 확인 중…" : "로그인"}
          </button>
        </form>
        <p className="prototype-note">
          합성 데이터 Prototype · 실제 환자정보를 입력하지 마세요.
        </p>
      </section>
    </main>
  );
}

export function ForcedPasswordChangeScreen({
  user,
  onChangePassword,
  onLogout,
  isSubmitting,
  error,
}: {
  user: AuthUser;
  onChangePassword: (payload: ChangePasswordRequest) => Promise<boolean>;
  onLogout: () => Promise<boolean>;
  isSubmitting: boolean;
  error: string;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [localError, setLocalError] = useState("");

  const submitPasswordChange = async () => {
    setLocalError("");
    if (!currentPassword || !newPassword || !newPasswordConfirmation) {
      setLocalError("모든 Password 입력란을 작성해 주세요.");
      return;
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      setLocalError("새 Password는 12~128자로 입력해 주세요.");
      return;
    }
    if (currentPassword === newPassword) {
      setLocalError("새 Password는 현재 Password와 달라야 합니다.");
      return;
    }
    if (newPassword !== newPasswordConfirmation) {
      setLocalError("새 Password와 확인 입력값이 일치하지 않습니다.");
      return;
    }

    await onChangePassword({
      current_password: currentPassword,
      new_password: newPassword,
    });
  };

  return (
    <main className="login-screen">
      <section
        className="login-card password-change-card"
        aria-labelledby="password-change-title"
      >
        <div className="login-card__brand">
          <BrandMark />
          <div>
            <strong>내시경 운영 시스템</strong>
            <span>Clinic Endoscopy Operations</span>
          </div>
        </div>
        <div className="login-card__intro">
          <span className="eyebrow">최초 로그인 보안 설정</span>
          <h1 id="password-change-title">Password 변경 필요</h1>
          <p>
            임시 Password를 변경한 후 원내 업무 화면을 사용할 수 있습니다.
          </p>
        </div>
        <div className="password-change-user" aria-label="현재 로그인 사용자">
          <span className="avatar avatar--small">
            {user.display_name.slice(0, 1)}
          </span>
          <span>
            <strong>{user.display_name}</strong>
            <small>{user.login_id}</small>
          </span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitPasswordChange();
          }}
        >
          <label className="field">
            <span>현재 Password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              maxLength={128}
              disabled={isSubmitting}
              autoFocus
            />
          </label>
          <label className="field">
            <span>새 Password</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              aria-describedby="password-policy"
              disabled={isSubmitting}
            />
          </label>
          <label className="field">
            <span>새 Password 확인</span>
            <input
              type="password"
              value={newPasswordConfirmation}
              onChange={(event) =>
                setNewPasswordConfirmation(event.target.value)
              }
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              disabled={isSubmitting}
            />
          </label>
          <div className="password-policy" id="password-policy">
            <Icon name="shield" />
            <span>
              12~128자로 입력하고 현재 Password와 다르게 설정해 주세요.
            </span>
          </div>
          {localError || error ? (
            <div className="login-feedback login-feedback--error" role="alert">
              <Icon name="warning" />
              <span>{localError || error}</span>
            </div>
          ) : null}
          <button
            className="primary-button primary-button--wide"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Password 변경 중…" : "변경하고 업무 시작"}
          </button>
          <button
            className="secondary-button secondary-button--wide"
            type="button"
            onClick={() => void onLogout()}
            disabled={isSubmitting}
          >
            <Icon name="logout" />
            로그아웃
          </button>
        </form>
        <p className="prototype-note">
          Password는 Browser 저장소에 보관하지 않습니다.
        </p>
      </section>
    </main>
  );
}

export function AuthLoadingScreen() {
  return (
    <main className="login-screen">
      <section
        className="login-card auth-status-card"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="login-card__brand">
          <BrandMark />
          <div>
            <strong>내시경 운영 시스템</strong>
            <span>Clinic Endoscopy Operations</span>
          </div>
        </div>
        <div className="auth-status-card__content">
          <span className="auth-spinner" aria-hidden="true" />
          <h1>로그인 상태 확인 중</h1>
          <p>원내 서버의 보안 세션을 확인하고 있습니다.</p>
        </div>
      </section>
    </main>
  );
}

export function AuthUnavailableScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="login-screen">
      <section className="login-card auth-status-card" role="alert">
        <div className="login-card__brand">
          <BrandMark />
          <div>
            <strong>내시경 운영 시스템</strong>
            <span>Clinic Endoscopy Operations</span>
          </div>
        </div>
        <div className="auth-status-card__content auth-status-card__content--error">
          <Icon name="warning" />
          <h1>원내 서버 연결 확인 필요</h1>
          <p>{message}</p>
          <button className="primary-button" type="button" onClick={onRetry}>
            <Icon name="refresh" />
            다시 확인
          </button>
        </div>
      </section>
    </main>
  );
}
