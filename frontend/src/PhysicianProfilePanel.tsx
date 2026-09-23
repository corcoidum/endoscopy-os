import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "./api";

type StaffProfile = {
  id: string;
  display_name: string;
  staff_type: "DOCTOR" | "NURSE" | "ASSISTANT" | "ADMINISTRATIVE" | "OTHER";
  employee_code: string | null;
  is_active: boolean;
  deactivated_at: string | null;
};

type ListResult = { key: number; items: StaffProfile[]; error: string };

export const staffProfilesApi = {
  async doctors() {
    const response = await apiRequest<{ items: StaffProfile[] }>(
      "/api/staff-profiles?staff_type=DOCTOR&include_inactive=true",
    );
    return response.items;
  },

  create(displayName: string, csrfToken: string) {
    return apiRequest<StaffProfile>("/api/staff-profiles", {
      method: "POST",
      csrfToken,
      body: { display_name: displayName.trim(), staff_type: "DOCTOR" },
    });
  },

  setActive(profileId: string, isActive: boolean, csrfToken: string) {
    return apiRequest<StaffProfile>(`/api/staff-profiles/${profileId}/activation`, {
      method: "PATCH",
      csrfToken,
      body: { is_active: isActive },
    });
  },
};

/**
 * 복용약 의사 결정의 결정 주체가 되는 의사 명부. 로그인 계정과 따로 둔다(DEC-07).
 * 원장 1인 운영이라 의사 선택기를 두지 않으므로 활성 의사 Profile은 한 명만 둔다.
 */
export function PhysicianProfilePanel({
  csrfToken,
  onChanged,
}: {
  csrfToken: string | null;
  onChanged: (message: string) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<ListResult | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void staffProfilesApi
      .doctors()
      .then((items) => {
        if (!cancelled) setResult({ key: revision, items, error: "" });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setResult({
          key: revision,
          items: [],
          error: cause instanceof ApiError ? cause.message : "의사 명부를 불러오지 못했습니다.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  const run = async (action: (csrf: string) => Promise<unknown>, message: string) => {
    if (!csrfToken) {
      setError("보안 세션이 없어 저장할 수 없습니다. 다시 로그인해 주세요.");
      return false;
    }
    setBusy(true);
    setError("");
    try {
      await action(csrfToken);
      setRevision((current) => current + 1);
      onChanged(message);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "의사 명부를 저장하지 못했습니다.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const loaded = result?.key === revision;
  const items = loaded ? result.items : [];
  const activeCount = items.filter((item) => item.is_active).length;

  return (
    <section className="override-panel" aria-labelledby="physician-panel-title">
      <div className="override-panel__heading">
        <h2 id="physician-panel-title">의사 Profile</h2>
        <p>
          복용약 중단·지속 결정을 기록할 때 결정한 의사로 남는 명부입니다. 로그인 계정과 따로
          관리하며, 원장 1인 운영이라 활성 의사 Profile은 한 명만 둡니다.
        </p>
      </div>

      <form
        className="override-form"
        aria-label="의사 Profile 등록"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void run(
            (csrf) => staffProfilesApi.create(name, csrf),
            `${name.trim()} 의사 Profile을 등록했습니다.`,
          ).then((saved) => {
            if (saved) setName("");
          });
        }}
      >
        <label className="field">
          <span>의사 표시 이름</span>
          <input
            value={name}
            maxLength={100}
            placeholder="예: 합성 원장"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="submit" className="primary-button" disabled={busy || !name.trim()}>
          의사 Profile 등록
        </button>
      </form>

      {activeCount > 1 && (
        <p className="schedule-action-dialog__error" role="alert">
          활성 의사 Profile이 {activeCount}명입니다. 의사 선택 항목을 두지 않으므로 한 명만 활성으로
          두어야 복용약 의사 결정을 기록할 수 있습니다.
        </p>
      )}
      {error && (
        <p className="schedule-action-dialog__error" role="alert">
          {error}
        </p>
      )}

      {!loaded ? (
        <p className="field-note">의사 명부를 불러오는 중입니다.</p>
      ) : result.error ? (
        <p className="schedule-action-dialog__error" role="alert">
          {result.error}
        </p>
      ) : items.length === 0 ? (
        <p className="field-note">
          등록된 의사 Profile이 없습니다. 등록 전에는 복용약 의사 결정을 기록할 수 없습니다.
        </p>
      ) : (
        <ul className="override-list" aria-label="의사 Profile 목록">
          {items.map((item) => (
            <li
              key={item.id}
              className={`override-row ${item.is_active ? "override-row--approved" : "override-row--revoked"}`}
            >
              <div className="override-row__main">
                <strong>{item.display_name}</strong>
                <span>의사</span>
              </div>
              <em>{item.is_active ? "활성" : "비활성"}</em>
              <div className="override-row__actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      (csrf) => staffProfilesApi.setActive(item.id, !item.is_active, csrf),
                      item.is_active
                        ? `${item.display_name} 의사 Profile을 비활성화했습니다.`
                        : `${item.display_name} 의사 Profile을 다시 활성화했습니다.`,
                    )
                  }
                >
                  {item.is_active ? "비활성화" : "다시 활성화"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
