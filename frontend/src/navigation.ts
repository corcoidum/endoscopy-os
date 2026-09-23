import type { AuthUser } from "./api";
import type { ViewId } from "./viewTypes";

export const NAVIGATION: Array<{
  id: ViewId | "booking";
  label: string;
  icon: string;
  permissions: string[];
}> = [
  { id: "today", label: "오늘", icon: "today", permissions: ["appointment.read"] },
  { id: "month", label: "월간", icon: "month", permissions: ["appointment.read"] },
  { id: "week", label: "주간", icon: "week", permissions: ["appointment.read"] },
  { id: "day", label: "일간", icon: "day", permissions: ["appointment.read"] },
  {
    id: "booking",
    label: "예약 등록",
    icon: "add",
    permissions: ["appointment.create"],
  },
  {
    id: "confirmation",
    label: "확인 업무",
    icon: "confirmation",
    permissions: [
      "appointment.update",
      "verification.primary",
      "verification.secondary",
      "verification.pacs",
      "procedure.write",
      "medication.read",
    ],
  },
  {
    id: "pathology",
    label: "조직검체",
    icon: "pathology",
    permissions: ["pathology.read"],
  },
  {
    id: "patient",
    label: "환자 History",
    icon: "patient",
    permissions: ["patient.read"],
  },
  {
    id: "statistics",
    label: "통계",
    icon: "statistics",
    permissions: ["appointment.read"],
  },
  {
    id: "admin",
    label: "관리자",
    icon: "admin",
    permissions: [
      "schedule_override.approve",
      "identity.manage",
      "audit.read",
      "backup.read",
      "backup.run",
    ],
  },
];

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "관리자",
  FRONT_DESK: "원무 담당자",
  ENDOSCOPY_STAFF: "내시경 담당자",
  READ_ONLY: "조회 전용",
};

export function hasAnyPermission(user: AuthUser, permissions: string[]) {
  return (
    user.permissions.includes("*") ||
    permissions.some((permission) => user.permissions.includes(permission))
  );
}

export function roleLabel(roles: string[]) {
  if (roles.length === 0) return "권한 확인 필요";
  return roles.map((role) => ROLE_LABELS[role] ?? role).join(" · ");
}
