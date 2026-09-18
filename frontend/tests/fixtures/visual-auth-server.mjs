// Local visual QA only: no real account, password, session, or patient API is used.
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

const appointments = [];
if (process.env.CALENDAR_QA === "1") {
  for (let day = 1; day <= 19; day++) {
    const date = `2026-09-${String(day).padStart(2, "0")}`;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 0) continue;
    for (let slot = 0; slot < ([3, 6].includes(weekday) ? 2 : 3); slot++) {
      appointments.push({
        id: `calendar-${day}-${slot}`, patient_id: `synthetic-${slot}`,
        patient_name: ["합성가람", "합성나래", "합성다온"][slot],
        chart_number: `SYN-PT-000${slot + 1}`, birth_date: "1980-01-01", sex: "FEMALE",
        service_date: date, start_time: ["09:00:00", "09:30:00", "10:30:00"][slot],
        duration_minutes: slot === 0 ? 30 : 60, procedure_set: slot === 2 ? "SET_60" : null,
        care_type: "GENERAL", booking_bucket: "STANDARD_MORNING", booking_origin: "ADVANCE",
        workflow_state: "BOOKED", exception_reason: null, exception_memo: null,
        procedures: (slot === 2 ? ["UPPER", "COLON"] : [slot === 0 ? "UPPER" : "COLON"])
          .map(procedure_code => ({ procedure_code, sedation_mode: "NON_SEDATED" })),
      });
    }
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:18080");
  const json = (status, body) => {
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(body));
  };

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    json(200, {
      user: {
        id: randomUUID(),
        login_id: "visual.qa",
        display_name: "화면검증 관리자",
        must_change_password: false,
        roles: ["admin"],
        permissions: [
          "appointment.read", "appointment.create", "appointment.update",
          "verification.secondary", "verification.pacs", "procedure.write",
          "pathology.read", "pathology.write", "patient.read", "patient.create",
          "patient.update", "statistics.read", "user.manage", "audit.read",
          "schedule_override.approve",
        ],
      },
      csrf_token: randomBytes(32).toString("hex"),
      idle_expires_at: expiresAt,
      absolute_expires_at: expiresAt,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/appointments") {
    const start = url.searchParams.get("start_date");
    const end = url.searchParams.get("end_date");
    const items = appointments.filter(item => (!start || item.service_date >= start) && (!end || item.service_date <= end));
    json(200, { items, total: items.length });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/appointments/availability") {
    const extension = url.searchParams.get("booking_bucket") === "SAME_DAY_EXTENSION";
    json(200, {
      service_date: url.searchParams.get("service_date"),
      booking_bucket: extension ? "SAME_DAY_EXTENSION" : "STANDARD_MORNING",
      duration_minutes: 30,
      procedure_set: null,
      schedule_policy_version: "SYNTHETIC-QA",
      slots: extension
        ? [{
            start_time: "12:00:00",
            end_time: "12:30:00",
            slot_type: "SAME_DAY_EXTENSION",
            additional_slot_id: "00000000-0000-0000-0000-000000000030",
          }]
        : [],
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/patients") {
    json(200, {
      items: [{
        id: "00000000-0000-0000-0000-000000000020",
        chart_number: "SYN-SAME-001",
        name: "합성당일환자",
        birth_date: "1980-01-01",
        sex: "FEMALE",
        is_active: true,
      }],
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/schedule/additional-slots") {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw || "{}");
      json(201, {
        id: "00000000-0000-0000-0000-000000000030",
        service_date: body.service_date,
        start_time: body.start_time,
        end_time: "12:30:00",
        reason: body.reason,
        status: "APPROVED",
      });
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/appointments") {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const appointment = {
        id: "00000000-0000-0000-0000-000000000040",
        patient_id: body.patient_id,
        patient_name: "합성당일환자",
        chart_number: "SYN-SAME-001",
        birth_date: "1980-01-01",
        sex: "FEMALE",
        service_date: body.service_date,
        start_time: body.start_time,
        duration_minutes: 30,
        procedure_set: null,
        care_type: body.care_type,
        booking_bucket: body.booking_bucket,
        booking_origin: body.booking_origin,
        additional_slot_id: body.additional_slot_id,
        same_day_reason: body.same_day_reason,
        same_day_preparation_confirmed: body.same_day_preparation_confirmed,
        same_day_clinician_confirmed: body.same_day_clinician_confirmed,
        same_day_escort_confirmed: body.same_day_escort_confirmed,
        same_day_confirmed_at: new Date().toISOString(),
        workflow_state: "BOOKED",
        exception_reason: null,
        exception_memo: null,
        procedures: body.procedures,
      };
      appointments.push(appointment);
      json(201, appointment);
    });
    return;
  }

  {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ detail: "Visual fixture endpoint only" }));
    return;
  }
});

server.listen(18080, "127.0.0.1", () => {
  console.log("Synthetic visual-auth fixture: http://127.0.0.1:18080");
});
