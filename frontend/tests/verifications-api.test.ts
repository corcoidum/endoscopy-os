import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../src/api.ts";
import {
  subjectAgeSex,
  subjectProcedures,
  verificationQueue,
} from "../src/appointmentPresentation.ts";
import {
  VERIFICATION_STATE_LABELS,
  verificationErrorMessage,
  verificationNeedsReload,
  verificationsApi,
  type VerificationSubject,
} from "../src/verificationsApi.ts";

const subject: VerificationSubject = {
  name: "합성확인",
  chart_number: "SYN-VER-001",
  birth_date: "1980-12-31",
  sex: "FEMALE",
  service_date: "2026-09-24",
  start_time: "09:00",
  procedures: [
    { procedure_code: "COLON", sedation_mode: "NON_SEDATED" },
    { procedure_code: "UPPER", sedation_mode: "SEDATED" },
  ],
  procedure_set: "SET_90",
  care_type: "SCREENING",
  computed_age: 46,
  age_method: "SCREENING_YEAR_AGE",
  age_reference_date: "2026-09-24",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("1·2차 확인은 화면에 보인 핵심정보 지문과 방법·메모를 CSRF와 함께 보낸다", async (t) => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return jsonResponse({}, 201);
    },
  );
  const fingerprint = "a".repeat(64);

  await verificationsApi.verify("apt-1", "PRIMARY", fingerprint, "ID_DOCUMENT", "  신분증 대조 ", "csrf");
  await verificationsApi.verify("apt-1", "SECONDARY", fingerprint, "IN_PERSON", "   ", "csrf");

  assert.equal(calls[0].input, "/api/appointments/apt-1/verifications/primary");
  assert.equal(new Headers(calls[0].init?.headers).get("X-CSRF-Token"), "csrf");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    expected_fingerprint: fingerprint,
    method: "ID_DOCUMENT",
    memo: "신분증 대조",
  });
  assert.equal(calls[1].input, "/api/appointments/apt-1/verifications/secondary");
  // 비어 있는 메모는 보내지 않는다.
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
    expected_fingerprint: fingerprint,
    method: "IN_PERSON",
  });
});

test("2차 확인 정정은 대상 확인 ID와 다듬은 사유를 보낸다", async (t) => {
  let captured: { input: string; body: unknown } | null = null;
  const read = () => captured;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { input: String(input), body: JSON.parse(String(init?.body)) };
      return jsonResponse({});
    },
  );

  await verificationsApi.correctSecondary("apt-1", "ver-2", "  다른 환자 화면  ", "csrf");

  const call = read();
  assert.ok(call);
  assert.equal(call.input, "/api/appointments/apt-1/verifications/secondary/correct");
  assert.deepEqual(call.body, { verification_id: "ver-2", reason: "다른 환자 화면" });
});

test("동일인 2차 확인·권한 부족·정보 변경 충돌을 한국어로 안내하고 최신화 여부를 가린다", () => {
  const same = new ApiError(409, "server", "SECOND_REVIEWER_INVALID");
  const denied = new ApiError(403, "server", "PERMISSION_DENIED");
  const stale = new ApiError(409, "server", "VERIFICATION_STALE");

  assert.match(verificationErrorMessage(same), /1차 확인자와 다른 직원/);
  assert.match(verificationErrorMessage(denied), /권한이 없습니다/);
  assert.match(verificationErrorMessage(stale), /최신 정보를 다시 불러왔으니/);

  assert.equal(verificationNeedsReload(stale), true);
  assert.equal(verificationNeedsReload(new ApiError(409, "", "VERIFICATION_ALREADY_DONE")), true);
  // 동일인·권한 오류는 다시 불러와도 바뀌지 않으므로 다시 읽지 않는다.
  assert.equal(verificationNeedsReload(same), false);
  assert.equal(verificationNeedsReload(denied), false);
});

test("이중확인 완료를 검사 준비 완료처럼 표시하지 않는다", () => {
  for (const label of Object.values(VERIFICATION_STATE_LABELS)) {
    assert.doesNotMatch(label, /준비/);
  }
  assert.equal(VERIFICATION_STATE_LABELS.VERIFIED, "이중확인 완료");
});

test("확인 당시 나이는 계산방식과 함께 성별을 붙여 보여 준다", () => {
  assert.equal(subjectAgeSex(subject), "검진 46 · 여");
  assert.equal(
    subjectAgeSex({ ...subject, age_method: "FULL_AGE", computed_age: 45, sex: "MALE" }),
    "일반 만 45 · 남",
  );
  assert.equal(subjectProcedures(subject), "대장(비수면)·위(수면) · 세트90");
  assert.equal(
    subjectProcedures({ ...subject, procedures: [subject.procedures[1]], procedure_set: null }),
    "위(수면)",
  );
});

test("확인 업무 목록은 이중확인이 끝난 예약을 빼고 재확인·1차·2차 순으로 늘어놓는다", () => {
  const queue = verificationQueue([
    { date: "2026-09-24", start: "09:00", verificationState: "PRIMARY_DONE" as const },
    { date: "2026-09-25", start: "09:00", verificationState: "VERIFIED" as const },
    { date: "2026-09-25", start: "10:00", verificationState: "REVERIFY_REQUIRED" as const },
    { date: "2026-09-23", start: "11:00", verificationState: "UNVERIFIED" as const },
    { date: "2026-09-23", start: "09:30", verificationState: "UNVERIFIED" as const },
  ]);

  assert.deepEqual(
    queue.map((item) => `${item.verificationState} ${item.date} ${item.start}`),
    [
      "REVERIFY_REQUIRED 2026-09-25 10:00",
      "UNVERIFIED 2026-09-23 09:30",
      "UNVERIFIED 2026-09-23 11:00",
      "PRIMARY_DONE 2026-09-24 09:00",
    ],
  );
});
