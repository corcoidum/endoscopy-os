import { useState } from "react";
import { calculateAge, type PathologyCase } from "./data";
import { Icon } from "./icons";

export function pathologyStatus(pathologyCase: PathologyCase) {
  if (pathologyCase.completed) return "완료";
  if (pathologyCase.overdue) return "Overdue";
  if (!pathologyCase.resultReportDate) return "결과 대기";
  if (!pathologyCase.doctorChecked) return "의사 확인 대기";
  if (!pathologyCase.patientNotified) return "환자 통보 대기";
  if (pathologyCase.followUpNeeded) return "Follow-up 예정";
  return "완료 처리 대기";
}

export function PathologyLedger({
  cases,
  onSelect,
}: {
  cases: PathologyCase[];
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState("전체");
  const statuses = [
    "전체",
    "결과 대기",
    "의사 확인 대기",
    "환자 통보 대기",
    "Follow-up 예정",
    "Overdue",
    "완료",
  ];
  const visibleCases =
    filter === "전체"
      ? cases
      : cases.filter((pathologyCase) => pathologyStatus(pathologyCase) === filter);

  return (
    <section className="view-surface">
      <div className="view-title">
        <div>
          <span className="eyebrow">Biopsy · CLO</span>
          <h1>조직검체 관리대장</h1>
          <p>
            결과보고일은 최초 게시일만 기록하며, 기관+접수번호로 중복을
            방지합니다.
          </p>
        </div>
        <span className="data-chip">과거 Excel 조회용 보관</span>
      </div>
      <div className="filter-tabs" role="tablist" aria-label="조직검체 상태 필터">
        {statuses.map((status) => {
          const count = cases.filter(
            (pathologyCase) => pathologyStatus(pathologyCase) === status,
          ).length;
          return (
            <button
              role="tab"
              aria-selected={filter === status}
              className={filter === status ? "is-active" : ""}
              onClick={() => setFilter(status)}
              key={status}
            >
              {status}
              {status !== "전체" && <span>{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="table-card">
        <div className="data-table data-table--pathology">
          <div className="data-table__head">
            <span>상태</span>
            <span>환자</span>
            <span>검사일 / 종류</span>
            <span>채취 부위</span>
            <span>기관 · 접수번호</span>
            <span>결과보고일</span>
            <span>환자 통보</span>
            <span>Follow-up</span>
          </div>
          {visibleCases.map((pathologyCase) => (
            <button
              className="data-table__row"
              key={pathologyCase.id}
              onClick={() => onSelect(pathologyCase.id)}
            >
              <span>
                <span
                  className={`pathology-status pathology-status--${pathologyStatus(
                    pathologyCase,
                  )
                    .replaceAll(" ", "-")
                    .toLowerCase()}`}
                >
                  {pathologyStatus(pathologyCase)}
                </span>
              </span>
              <span>
                <strong>{pathologyCase.patientName}</strong>
                <small>
                  {pathologyCase.chartNumber} ·{" "}
                  {calculateAge(
                    pathologyCase.dateOfBirth,
                    pathologyCase.examinationDate,
                    "일반",
                  )}{" "}
                  · {pathologyCase.sex}
                </small>
              </span>
              <span>
                {pathologyCase.examinationDate}
                <small>
                  {pathologyCase.caseType} · {pathologyCase.procedure}
                </small>
              </span>
              <span>{pathologyCase.site}</span>
              <span>
                {pathologyCase.laboratory}
                <small>{pathologyCase.accessionNumber}</small>
              </span>
              <span>{pathologyCase.resultReportDate ?? "미도착"}</span>
              <span>{pathologyCase.patientNotified ? "완료" : "대기"}</span>
              <span>{pathologyCase.followUpDate ?? "해당 없음"}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PathologyDrawer({
  pathologyCase,
  onClose,
  onUpdate,
  canWrite,
}: {
  pathologyCase: PathologyCase;
  onClose: () => void;
  onUpdate: (patch: Partial<PathologyCase>) => void;
  canWrite: boolean;
}) {
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="조직검체 Case 상세"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="detail-drawer__header">
          <div>
            <span className="eyebrow">{pathologyCase.caseType} Case</span>
            <h2>{pathologyCase.patientName}</h2>
            <p>
              {pathologyCase.chartNumber} ·{" "}
              {calculateAge(
                pathologyCase.dateOfBirth,
                pathologyCase.examinationDate,
                "일반",
              )}{" "}
              · {pathologyCase.sex}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </header>
        <div className="detail-drawer__content">
          <span className="pathology-status">
            {pathologyStatus(pathologyCase)}
          </span>
          <dl className="drawer-definition">
            <div>
              <dt>검사일</dt>
              <dd>{pathologyCase.examinationDate}</dd>
            </div>
            <div>
              <dt>채취 부위</dt>
              <dd>{pathologyCase.site}</dd>
            </div>
            <div>
              <dt>기관</dt>
              <dd>{pathologyCase.laboratory}</dd>
            </div>
            <div>
              <dt>접수번호</dt>
              <dd>{pathologyCase.accessionNumber}</dd>
            </div>
            <div>
              <dt>결과보고일</dt>
              <dd>{pathologyCase.resultReportDate ?? "결과 대기"}</dd>
            </div>
            <div>
              <dt>관리자 기록</dt>
              <dd>{pathologyCase.owner}</dd>
            </div>
          </dl>
          <div className="policy-callout">
            <Icon name="info" />
            <span>
              결과보고일은 씨젠 사이트에 최초 게시된 일자입니다. 원내 도착일은
              별도로 관리하지 않습니다.
            </span>
          </div>
          {pathologyCase.resultSummary && (
            <div className="result-summary">
              <span>결과 요약</span>
              <p>{pathologyCase.resultSummary}</p>
            </div>
          )}
          {canWrite ? (
            <div className="case-actions">
              <button
                className={pathologyCase.doctorChecked ? "is-complete" : ""}
                onClick={() => onUpdate({ doctorChecked: true })}
              >
                <Icon name="check" />
                의사 확인 {pathologyCase.doctorChecked ? "완료" : "기록"}
              </button>
              <button
                className={pathologyCase.patientNotified ? "is-complete" : ""}
                onClick={() =>
                  onUpdate({
                    patientNotified: true,
                    notificationDate: "2026-07-30",
                    notificationMethod: "전화",
                  })
                }
              >
                <Icon name="phone" />
                환자 통보 {pathologyCase.patientNotified ? "완료" : "기록"}
              </button>
              <button
                className={pathologyCase.completed ? "is-complete" : ""}
                onClick={() => onUpdate({ completed: true, overdue: false })}
              >
                <Icon name="check" />
                Follow-up 완료
              </button>
            </div>
          ) : (
            <div className="permission-note">
              <Icon name="lock" />
              <span>조회 권한으로 열었습니다. 기록 변경은 허용되지 않습니다.</span>
            </div>
          )}
        </div>
        <footer className="detail-drawer__footer">
          <button className="secondary-button" onClick={onClose}>
            닫기
          </button>
        </footer>
      </aside>
    </div>
  );
}
