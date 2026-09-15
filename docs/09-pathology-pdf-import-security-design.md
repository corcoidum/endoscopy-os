# 씨젠 병리결과 PDF Import 및 Follow-up 보안 설계안

## 1. 현재 범위

이 문서는 후속 구현을 위한 설계안이다. 실제 씨젠 계정 접속, 실제 환자 PDF 다운로드, 실환자 데이터 Import는 아직 수행하지 않는다. 먼저 공식 PDF Export 허용 여부, 병원 내부 승인, 계정 권한, 보존정책을 확인해야 한다.

첫 PoC(개념 검증)는 실제 양식과 구조만 같은 합성 PDF 5~10건으로 진행한다.

## 2. 권장 운영 흐름

```text
권한 있는 직원의 수동 PDF 선택
→ 격리 Inbox 저장
→ 파일 형식·크기·악성코드·SHA-256 검사
→ 로컬 PDF Parser/OCR
→ 최소 필드의 Import Candidate 생성
→ 검사기관 + 외부 접수번호 + 검체번호 규칙 매칭
→ 일치/중복/불일치 예외 Queue 분리
→ 권한 있는 직원의 환자·검체 연결 확인
→ 병리결과 Draft 저장
→ 담당 의사 결과 확인
→ 환자 통보 또는 재검 Follow-up Task 생성
→ 모든 단계 Append-only Audit Log
```

PDF를 읽은 결과는 즉시 확정 데이터가 아니라 `검토 대기 Draft`로 저장한다. 시스템이나 LLM이 임상적 의미, 환자 통보 내용, 재검 필요성을 자동 결정하지 않는다.

## 3. 입력·처리·출력·사람 승인

| 단계 | 입력 | 자동 처리 | 출력 | 사람 승인 |
|---|---|---|---|---|
| 파일 접수 | 공식 Export PDF | MIME/magic byte, 크기, 페이지, 암호화 여부, 악성코드 검사, SHA-256 | 격리된 Import Batch | 업로드 권한 확인 |
| 추출 | 검증된 PDF | 로컬 text extraction, 필요한 경우 로컬 OCR | 구조화 Candidate | 없음 |
| 매칭 | 기관, 외부 접수번호, 검체번호, 보고일 | 정확 일치, 중복·누락 탐지 | Match Candidate 또는 예외 | 환자·Case 연결 확인 필수 |
| 결과 반영 | 승인된 Match Candidate | 기존 결과 Version 확인, Draft 생성 | Pathology Result Draft | 담당 의사 확인 필수 |
| 후속 업무 | 의사 확인 결과 | 정해진 업무규칙으로 Task 초안 생성 | 통보/재검 Queue | 실제 통보·재검 계획 확정은 사람 |

## 4. 최소 추출 필드

- 검사기관 코드: `SEEGENE`
- 외부 접수번호
- 검체번호 또는 의뢰번호
- 결과 최초 게시일
- 검사명·검사코드
- 결과 상태: `FINAL`, `CORRECTED`, `PENDING` 등
- 결과 Version 또는 정정 여부
- 결과 요약 원문 후보
- 원본 PDF SHA-256

환자 이름이나 생년월일만으로 자동 연결하지 않는다. 기본 식별키는 `검사기관 + 외부 접수번호`이며, 내부 Pathology Case의 검체번호까지 일치해야 자동으로 “매칭 후보”가 될 수 있다. 최종 연결에는 사람 확인이 필요하다.

## 5. 권장 데이터 구조

```text
PathologyImportBatch
  id, sha256, source_lab, imported_by, imported_at, status

PathologyImportCandidate
  batch_id, accession_number, specimen_number,
  reported_on, result_status, extracted_payload, parse_warnings

PathologyMatchReview
  candidate_id, pathology_case_id, decision,
  reviewed_by, reviewed_at, reason

PathologyResultVersion
  pathology_case_id, source_batch_id, version,
  summary, reported_on, status, supersedes_id

PathologyFollowUpTask
  pathology_case_id, task_type, due_at, owner_id, status

AuditEvent
  actor_id, action, entity_type, entity_id,
  before_hash, after_hash, occurred_at, reason
```

정정 결과는 기존 결과를 덮어쓰지 않고 새 `PathologyResultVersion`으로 추가한다. 같은 SHA-256 PDF는 중복 Import하지 않는 Idempotency 규칙을 둔다.

## 6. 보안 통제

### 파일과 저장소

- 내부망 HTTPS와 역할 기반 권한(`pathology.import`, `pathology.review`, `pathology.physician_confirm`)을 분리한다.
- PDF와 Database는 암호화된 로컬 Disk/Volume에 저장하고 Backup도 별도 암호화한다.
- 원본 파일명에 환자명을 유지하지 않고 내부 UUID 파일명으로 바꾼다.
- 원본 PDF와 추출본문을 일반 Application Log, Browser LocalStorage, Analytics, Error Tracking에 기록하지 않는다.
- 허용 크기, 최대 페이지 수, PDF magic byte를 검사하고 실행파일·첨부파일·JavaScript 포함 PDF는 격리한다.
- 악성코드 검사 실패, 암호 PDF, 손상 PDF는 처리하지 않고 예외 Queue로 보낸다.

### 외부 전송과 AI

- 초기 버전은 Cloud OCR, 외부 LLM API, 이메일 자동전송을 사용하지 않는다.
- PDF Parsing/OCR은 병원 내부 PC 또는 서버에서 로컬 실행한다.
- 추후 외부 AI 사용을 검토하려면 별도 계약·위탁처리·국외이전·보존·삭제 조건을 먼저 승인해야 한다.

### 감사와 운영

- 업로드, 추출, 매칭 제안, 승인·거절, 결과 정정, 의사 확인, 환자 통보를 모두 Append-only Audit로 기록한다.
- 권한 없는 사용자는 병리 원문을 조회할 수 없고 목록에는 업무상 최소 상태만 표시한다.
- PDF 보존기간, 결과 원문 보존 범위, Backup 세대, 폐기 승인자를 운영정책으로 확정한다.
- Import 실패가 기존 Pathology Case나 결과를 변경하지 않도록 한 Batch 단위 Transaction과 Rollback을 사용한다.

## 7. 예외 Queue

- 접수번호 또는 검체번호 누락
- 한 PDF에 여러 환자/검체 포함
- 동일 기관+접수번호 중복
- 기존 결과와 다른 정정본
- 보고일 역전
- Case 미생성 또는 이미 무효화된 Case
- 이름은 같지만 식별키 불일치
- Parser 신뢰도 부족 또는 OCR 필요
- 암호화·손상·악성 의심 PDF

예외는 자동 보정하지 않고 `미매칭`, `중복`, `정정본`, `판독 실패` 등으로 분리해 담당자가 처리한다.

## 8. 단계별 구현 제안

### 1단계 — 합성 PDF 수동 Import PoC

- 직원이 한 번에 PDF를 선택하는 수동 Upload만 제공한다.
- 합성 Case 5~10건으로 정상, 중복, 미매칭, 정정본, 손상 파일을 검증한다.
- Parsing 결과와 원본 PDF를 나란히 보여주고 반영 전 승인받는다.

### 2단계 — 내부 운영 Pilot

- 공식 Export 권한과 병원 승인 후 제한된 역할만 사용한다.
- 매일 담당자가 다운로드한 PDF를 승인된 내부 Inbox에 넣고 Import Batch를 실행한다.
- 2~4주 동안 자동 확정 없이 전건 사람 검토하며 누락·오매칭률을 측정한다.

### 3단계 — 선택적 자동 감지

- Pilot 지표가 기준을 충족한 뒤에만 승인된 폴더 감시를 추가한다.
- 새 파일 감지는 자동화하되 결과 반영·의사 확인·환자 통보는 자동화하지 않는다.
- 씨젠 공식 API 또는 표준 Export가 제공되고 계약상 허용될 때만 포털 자동화보다 우선 검토한다.

## 9. 실제 환자자료 사용 전 결정 Gate

1. 씨젠 공식 PDF Export와 시스템 반입이 계정·계약상 허용되는가?
2. 담당 역할별 조회·Import·검토·의사확인 권한은 누구에게 있는가?
3. PDF 원본 전체를 저장할지, 결과 요약만 저장할지?
4. 보존기간과 폐기 승인자는 누구인가?
5. Text PDF와 Scan PDF의 실제 비율은 어느 정도인가?
6. 외부 접수번호·검체번호가 기존 Pathology Case에 안정적으로 기록되는가?
7. 정정 결과와 중복 결과의 실제 표시 형식은 무엇인가?

이 Gate가 확정되기 전에는 합성 데이터 PoC 범위를 넘지 않는다.

## 10. 완료 기준

- 합성 PDF 정상건이 올바른 Case의 Draft로 연결된다.
- 이름만 같은 환자는 자동 연결되지 않는다.
- 중복 PDF와 정정본이 구분된다.
- 미매칭·손상·암호 PDF가 기존 데이터 변경 없이 예외 Queue로 이동한다.
- 의사 확인 전 환자 통보·재검 완료 상태로 진행할 수 없다.
- 모든 Import와 승인·거절·정정에 사용자, 시각, 사유, 파일 Hash가 남는다.
