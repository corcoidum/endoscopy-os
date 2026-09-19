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
  | { kind: "appointment"; id: string }
  | { kind: "pathology"; id: string }
  | null;
