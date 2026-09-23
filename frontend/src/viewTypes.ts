// 좌측 Navigation과 Drawer가 함께 쓰는 화면 식별자.

export type ViewId =
  | "today"
  | "month"
  | "week"
  | "day"
  | "confirmation"
  | "pathology"
  | "patient"
  | "statistics"
  | "admin";

export type StatisticsPeriod = "week" | "month" | "year";

export type DrawerState =
  // tab을 주면 예약 상세를 그 탭으로 연다(예: 약제 확인 대기에서 준비·약제).
  | { kind: "appointment"; id: string; tab?: string }
  | { kind: "pathology"; id: string }
  | null;
