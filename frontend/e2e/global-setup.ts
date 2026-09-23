import {
  E2E_ADMIN_ID,
  E2E_ADMIN_INITIAL_PASSWORD,
  E2E_ADMIN_PASSWORD,
  E2E_API_URL,
  E2E_DOCTOR_NAME,
  E2E_FRONTEND_ORIGIN,
  E2E_STAFF_ID,
  E2E_STAFF_INITIAL_PASSWORD,
  E2E_STAFF_NAME,
  E2E_STAFF_PASSWORD,
  type E2ESeed,
} from "./env";

type ApiResult = { status: number; payload: Record<string, unknown> | undefined };

/** Browser 없이 Backend API를 부르는 최소 Session. Cookie와 CSRF를 직접 들고 다닌다. */
class ApiSession {
  private cookies = new Map<string, string>();
  private csrfToken = "";

  async request(method: string, path: string, body?: unknown): Promise<ApiResult> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      // Backend는 변경 요청의 Origin을 허용 목록과 대조한다.
      Origin: E2E_FRONTEND_ORIGIN,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.csrfToken && method !== "GET") headers["X-CSRF-Token"] = this.csrfToken;
    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    const response = await fetch(`${E2E_API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0];
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    const payload = (await response.json().catch(() => undefined)) as
      | Record<string, unknown>
      | undefined;
    if (typeof payload?.csrf_token === "string") this.csrfToken = payload.csrf_token;
    return { status: response.status, payload };
  }

  async expect(method: string, path: string, status: number, body?: unknown) {
    const result = await this.request(method, path, body);
    if (result.status !== status) {
      throw new Error(
        `${method} ${path}: ${status}을 기대했지만 ${result.status} ${JSON.stringify(result.payload)}`,
      );
    }
    return result.payload ?? {};
  }
}

function seoulToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** 최초 비밀번호 변경까지 마친 관리자 Session을 만든다. 다시 실행해도 된다. */
async function adminSession(): Promise<ApiSession> {
  const session = new ApiSession();
  const login = await session.request("POST", "/api/auth/login", {
    login_id: E2E_ADMIN_ID,
    password: E2E_ADMIN_INITIAL_PASSWORD,
  });
  if (login.status === 200) {
    const user = login.payload?.user as { must_change_password?: boolean } | undefined;
    if (user?.must_change_password) {
      await session.expect("POST", "/api/auth/change-password", 200, {
        current_password: E2E_ADMIN_INITIAL_PASSWORD,
        new_password: E2E_ADMIN_PASSWORD,
      });
    }
  }
  const ready = new ApiSession();
  await ready.expect("POST", "/api/auth/login", 200, {
    login_id: E2E_ADMIN_ID,
    password: E2E_ADMIN_PASSWORD,
  });
  return ready;
}

/** 2차 확인용 합성 내시경 담당 계정을 만들고 최초 비밀번호 변경까지 마친다. */
async function ensureStaff(admin: ApiSession): Promise<void> {
  const probe = new ApiSession();
  const ready = await probe.request("POST", "/api/auth/login", {
    login_id: E2E_STAFF_ID,
    password: E2E_STAFF_PASSWORD,
  });
  if (ready.status === 200) return;

  const roles = (await admin.expect("GET", "/api/users/roles", 200)) as unknown as Array<{
    id: string;
    code: string;
  }>;
  const endoscopy = roles.find((role) => role.code === "ENDOSCOPY_STAFF");
  if (!endoscopy) throw new Error("ENDOSCOPY_STAFF 역할이 없습니다. seed-identity를 확인해 주세요.");
  await admin.expect("POST", "/api/users", 201, {
    login_id: E2E_STAFF_ID,
    password: E2E_STAFF_INITIAL_PASSWORD,
    display_name: E2E_STAFF_NAME,
    role_ids: [endoscopy.id],
  });
  const staff = new ApiSession();
  await staff.expect("POST", "/api/auth/login", 200, {
    login_id: E2E_STAFF_ID,
    password: E2E_STAFF_INITIAL_PASSWORD,
  });
  await staff.expect("POST", "/api/auth/change-password", 200, {
    current_password: E2E_STAFF_INITIAL_PASSWORD,
    new_password: E2E_STAFF_PASSWORD,
  });
}

/** 복용약 의사 결정에 쓸 활성 의사 Profile을 하나 둔다(원장 1인 운영). */
async function ensureDoctor(admin: ApiSession): Promise<void> {
  const listed = await admin.expect("GET", "/api/staff-profiles?staff_type=DOCTOR", 200);
  const active = (listed.items as Array<{ display_name: string }>) ?? [];
  if (active.some((profile) => profile.display_name === E2E_DOCTOR_NAME)) return;
  if (active.length > 0) {
    throw new Error("다른 활성 의사 Profile이 있어 E2E 의사 결정을 기록할 수 없습니다.");
  }
  await admin.expect("POST", "/api/staff-profiles", 201, {
    display_name: E2E_DOCTOR_NAME,
    staff_type: "DOCTOR",
  });
}

export default async function globalSetup() {
  const session = await adminSession();
  await ensureStaff(session);
  await ensureDoctor(session);
  const stamp = Date.now().toString(36).toUpperCase();
  const chartNumber = `SYN-E2E-${stamp}`;
  const patientName = "합성이투이";
  const created = await session.expect("POST", "/api/patients", 201, {
    chart_number: chartNumber,
    name: patientName,
    birth_date: "1980-01-01",
    sex: "FEMALE",
  });
  const patientId = (created.patient as { id: string }).id;
  // 일정 예외 시험 예약은 다른 환자로 만들어 변경 시험의 카드와 구분한다.
  const otherPatient = await session.expect("POST", "/api/patients", 201, {
    chart_number: `${chartNumber}-B`,
    name: "합성이투비",
    birth_date: "1975-05-05",
    sex: "MALE",
  });
  const otherPatientId = (otherPatient.patient as { id: string }).id;
  const verificationChartNumber = `${chartNumber}-C`;
  const verificationPatient = await session.expect("POST", "/api/patients", 201, {
    chart_number: verificationChartNumber,
    name: "합성이투씨",
    birth_date: "1985-06-15",
    sex: "FEMALE",
  });
  const verificationPatientId = (verificationPatient.patient as { id: string }).id;
  const medicationChartNumber = `${chartNumber}-D`;
  const medicationPatient = await session.expect("POST", "/api/patients", 201, {
    chart_number: medicationChartNumber,
    name: "합성이투디",
    birth_date: "1968-03-03",
    sex: "MALE",
  });
  const medicationPatientId = (medicationPatient.patient as { id: string }).id;

  // 월·화·목·금 오전(09:00~12:00) 중 오늘 이후 두 시각 이상 비어 있는 날을 차례로 고른다.
  const today = seoulToday();
  const openDates: Array<{ serviceDate: string; starts: string[] }> = [];
  for (let offset = 1; offset <= 28 && openDates.length < 5; offset += 1) {
    const serviceDate = addDays(today, offset);
    const weekday = new Date(`${serviceDate}T00:00:00Z`).getUTCDay();
    if (![1, 2, 4, 5].includes(weekday)) continue;
    const params = new URLSearchParams({ service_date: serviceDate, procedures: "UPPER" });
    const availability = await session.request(
      "GET",
      `/api/appointments/availability?${params.toString()}`,
    );
    const starts = ((availability.payload?.slots as Array<{ start_time: string }>) ?? []).map(
      (slot) => slot.start_time.slice(0, 5),
    );
    if (availability.status === 200 && starts.length >= 2) {
      openDates.push({ serviceDate, starts });
    }
  }
  if (openDates.length < 5) {
    throw new Error("E2E 합성 예약을 넣을 빈 날짜를 찾지 못했습니다.");
  }

  const book = async (bookedPatientId: string, serviceDate: string, startTime: string) =>
    session.expect("POST", "/api/appointments", 201, {
      patient_id: bookedPatientId,
      service_date: serviceDate,
      start_time: startTime,
      care_type: "GENERAL",
      booking_bucket: "STANDARD_MORNING",
      procedures: [{ procedure_code: "UPPER", sedation_mode: "NON_SEDATED" }],
    });

  const [changeDay, overrideDay, verificationDay, medicationDay, medicationNewDay] = openDates;
  // 확인 업무 화면은 오늘부터 14일만 보여 준다.
  if (verificationDay.serviceDate > addDays(today, 13)) {
    throw new Error("확인 시험 예약이 확인 업무 조회 기간(14일) 밖에 잡혔습니다.");
  }
  const booked = await book(patientId, changeDay.serviceDate, changeDay.starts[0]);
  await book(otherPatientId, overrideDay.serviceDate, overrideDay.starts[0]);
  await book(verificationPatientId, verificationDay.serviceDate, verificationDay.starts[0]);
  // 복용약 확인은 대장내시경 예약이 대상이다. 다른 시험과 겹치지 않는 날에 둔다.
  const medicationBooking = await session.expect("POST", "/api/appointments", 201, {
    patient_id: medicationPatientId,
    service_date: medicationDay.serviceDate,
    start_time: medicationDay.starts[0],
    care_type: "GENERAL",
    booking_bucket: "STANDARD_MORNING",
    procedures: [{ procedure_code: "COLON", sedation_mode: "SEDATED" }],
  });

  const seed: E2ESeed = {
    appointmentId: String(booked.id),
    patientName,
    chartNumber,
    serviceDate: changeDay.serviceDate,
    startTime: changeDay.starts[0],
    alternativeStartTime: changeDay.starts[changeDay.starts.length - 1],
    overrideDate: overrideDay.serviceDate,
    overrideStartTime: overrideDay.starts[0],
    verificationChartNumber,
    verificationDate: verificationDay.serviceDate,
    verificationStartTime: verificationDay.starts[0],
    verificationAlternativeStartTime: verificationDay.starts[verificationDay.starts.length - 1],
    medicationAppointmentId: String(medicationBooking.id),
    medicationChartNumber,
    medicationDate: medicationDay.serviceDate,
    medicationStartTime: medicationDay.starts[0],
    medicationNewDate: medicationNewDay.serviceDate,
    runStamp: stamp,
  };
  process.env.E2E_SEED = JSON.stringify(seed);
}
