import {
  E2E_ADMIN_ID,
  E2E_ADMIN_INITIAL_PASSWORD,
  E2E_ADMIN_PASSWORD,
  E2E_API_URL,
  E2E_FRONTEND_ORIGIN,
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

export default async function globalSetup() {
  const session = await adminSession();
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

  // 월·화·목·금 오전(09:00~12:00) 중 오늘 이후 가장 가까운 날에 두 시각 이상 비어 있는 날을 고른다.
  const today = seoulToday();
  for (let offset = 1; offset <= 10; offset += 1) {
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
    if (availability.status !== 200 || starts.length < 2) continue;

    const booked = await session.expect("POST", "/api/appointments", 201, {
      patient_id: patientId,
      service_date: serviceDate,
      start_time: starts[0],
      care_type: "GENERAL",
      booking_bucket: "STANDARD_MORNING",
      procedures: [{ procedure_code: "UPPER", sedation_mode: "NON_SEDATED" }],
    });
    const seed: E2ESeed = {
      appointmentId: String(booked.id),
      patientName,
      chartNumber,
      serviceDate,
      startTime: starts[0],
      alternativeStartTime: starts[starts.length - 1],
    };
    process.env.E2E_SEED = JSON.stringify(seed);
    return;
  }
  throw new Error("E2E 합성 예약을 넣을 빈 날짜를 찾지 못했습니다.");
}
