// Local visual QA only: no real account, password, session, or patient API is used.
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

const server = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/api/auth/me") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ detail: "Visual fixture endpoint only" }));
    return;
  }

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify({
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
      ],
    },
    csrf_token: randomBytes(32).toString("hex"),
    idle_expires_at: expiresAt,
    absolute_expires_at: expiresAt,
  }));
});

server.listen(18080, "127.0.0.1", () => {
  console.log("Synthetic visual-auth fixture: http://127.0.0.1:18080");
});
