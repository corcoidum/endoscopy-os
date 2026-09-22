export type Sex = "남" | "여";
import type { VerificationState } from "./verificationsApi";

export type CareCategory = "검진" | "일반";
export type ProcedureKind = "위" | "대장" | "위·대장";
export type ProcedureSet = "세트60" | "세트90";
export type CheckState = "완료" | "대기" | "불필요";
export type DepositPaymentMethod = "현금" | "카드";

export interface MedicationDiscontinuation {
  medicationName: string;
  discontinuationDays: number;
  doctorConfirmed: boolean;
}
export type AppointmentStatus =
  | "예약"
  | "D-1 확인 필요"
  | "내원"
  | "검사 준비"
  | "검사 중"
  | "검사 완료";

export interface Appointment {
  id: string;
  date: string;
  start: string;
  duration: 30 | 60 | 90;
  name: string;
  chartNumber: string;
  dateOfBirth: string;
  sex: Sex;
  careCategory: CareCategory;
  procedure: ProcedureKind;
  procedureSet?: ProcedureSet;
  upperSedation?: boolean;
  colonSedation?: boolean;
  deposit: CheckState;
  medication: CheckState;
  d1: CheckState;
  verification: CheckState;
  verificationCorrectionReason?: string;
  verificationCorrectedAt?: string;
  pacs: CheckState;
  status: AppointmentStatus;
  bowelPreparation?: string;
  screeningCopay?: "없음" | "10%";
  additionalExaminations?: string[];
  depositPaymentMethod?: DepositPaymentMethod;
  depositAmount?: 10000 | 20000 | 30000;
  depositUnpaidConfirmed?: boolean;
  generalScreening?: "미확인" | "실시" | "미실시";
  colorectalScreening?: "미확인" | "실시" | "미실시";
  colorectalScreeningResult?: "미확인" | "음성" | "양성";
  positiveScreeningColonoscopyMemo?: string;
  additionalPrepayment?: boolean;
  medicationDiscontinuationName?: string;
  medicationDiscontinuationDays?: number;
  medicationDoctorConfirmed?: boolean;
  medicationListMemo?: string;
  medicationDiscontinuations?: MedicationDiscontinuation[];
  afternoonException?: boolean;
  sameDay?: boolean;
  sameDayExtension?: boolean;
  additionalSlotId?: string;
  sameDayReason?: string;
  sameDayPreparationConfirmed?: boolean;
  sameDayClinicianConfirmed?: boolean;
  sameDayEscortConfirmed?: boolean;
  exceptionReason?: string;
  exceptionConfirmedBy?: string;
  memo?: string;
  backendManaged?: boolean;
  /** Backend 예약의 동시 수정 검사값. 변경·취소 요청에 그대로 돌려보낸다. */
  rowVersion?: number;
  /** 14:00 오후 예외가 아직 다른 직원의 확인을 기다리는지. */
  exceptionPending?: boolean;
  /** Backend 예약의 인적사항 1·2차 확인 상태. */
  verificationState?: VerificationState;
}

export interface PathologyCase {
  id: string;
  patientName: string;
  chartNumber: string;
  sex: Sex;
  dateOfBirth: string;
  examinationDate: string;
  caseType: "Biopsy" | "CLO";
  procedure: ProcedureKind;
  site: string;
  laboratory: string;
  accessionNumber: string;
  requestedDate: string;
  resultReportDate?: string;
  resultSummary?: string;
  doctorChecked: boolean;
  patientNotified: boolean;
  notificationDate?: string;
  notificationMethod?: "전화" | "내원" | "문자";
  followUpNeeded: boolean;
  followUpDate?: string;
  owner: string;
  completed: boolean;
  overdue: boolean;
  note?: string;
}

export type WeekDay = {
  readonly date: string;
  readonly label: string;
  readonly shortDay: string;
  readonly today?: boolean;
};

export const WEEK_DAYS: readonly WeekDay[] = [
  { date: "2026-07-27", label: "월 7/27", shortDay: "월" },
  { date: "2026-07-28", label: "화 7/28", shortDay: "화" },
  { date: "2026-07-29", label: "수 7/29", shortDay: "수" },
  { date: "2026-07-30", label: "목 7/30", shortDay: "목", today: true },
  { date: "2026-07-31", label: "금 7/31", shortDay: "금" },
  { date: "2026-08-01", label: "토 8/1", shortDay: "토" },
];

export const initialAppointments: Appointment[] = [
  {
    id: "APT-001",
    date: "2026-07-27",
    start: "09:00",
    duration: 30,
    name: "정다은",
    chartNumber: "S-260730-021",
    dateOfBirth: "1979-05-13",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    additionalExaminations: ["복부초음파"],
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "내원",
    memo: "합성 데이터",
  },
  {
    id: "APT-002",
    date: "2026-07-27",
    start: "09:30",
    duration: 60,
    name: "최민수",
    chartNumber: "S-260727-009",
    dateOfBirth: "1970-11-03",
    sex: "남",
    careCategory: "일반",
    procedure: "위·대장",
    upperSedation: true,
    colonSedation: false,
    deposit: "완료",
    medication: "대기",
    d1: "완료",
    verification: "완료",
    pacs: "대기",
    status: "검사 준비",
    bowelPreparation: "원프렙",
  },
  {
    id: "APT-003",
    date: "2026-07-27",
    start: "10:30",
    duration: 30,
    name: "김하늘",
    chartNumber: "S-260730-005",
    dateOfBirth: "1974-04-22",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    additionalExaminations: ["갑상선초음파"],
    deposit: "완료",
    medication: "불필요",
    d1: "대기",
    verification: "완료",
    pacs: "완료",
    status: "예약",
  },
  {
    id: "APT-004",
    date: "2026-07-27",
    start: "11:00",
    duration: 60,
    name: "박지우",
    chartNumber: "S-260730-012",
    dateOfBirth: "1977-12-18",
    sex: "남",
    careCategory: "일반",
    procedure: "위·대장",
    upperSedation: false,
    colonSedation: false,
    deposit: "대기",
    medication: "완료",
    d1: "완료",
    verification: "완료",
    pacs: "완료",
    status: "예약",
    bowelPreparation: "수클리어산",
  },
  {
    id: "APT-005",
    date: "2026-07-27",
    start: "14:00",
    duration: 30,
    name: "정서연",
    chartNumber: "S-260727-014",
    dateOfBirth: "1981-02-02",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "예약",
    afternoonException: true,
    exceptionReason: "원장 승인 예외",
    exceptionConfirmedBy: "관리자",
  },
  {
    id: "APT-006",
    date: "2026-07-28",
    start: "09:00",
    duration: 30,
    name: "이도윤",
    chartNumber: "S-260728-003",
    dateOfBirth: "1976-08-19",
    sex: "남",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "예약",
  },
  {
    id: "APT-007",
    date: "2026-07-28",
    start: "09:30",
    duration: 30,
    name: "정유진",
    chartNumber: "S-260728-018",
    dateOfBirth: "1978-06-01",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "예약",
  },
  {
    id: "APT-008",
    date: "2026-07-28",
    start: "10:00",
    duration: 60,
    name: "김태현",
    chartNumber: "S-260728-006",
    dateOfBirth: "1972-03-29",
    sex: "남",
    careCategory: "일반",
    procedure: "대장",
    colonSedation: false,
    additionalExaminations: ["복부초음파"],
    deposit: "완료",
    medication: "완료",
    d1: "완료",
    verification: "완료",
    pacs: "대기",
    status: "예약",
    bowelPreparation: "수프렙미니에스정",
  },
  {
    id: "APT-009",
    date: "2026-07-28",
    start: "11:00",
    duration: 30,
    name: "송민아",
    chartNumber: "S-260728-021",
    dateOfBirth: "1980-04-06",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    additionalExaminations: ["심장초음파"],
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "완료",
    pacs: "완료",
    status: "예약",
  },
  {
    id: "APT-010",
    date: "2026-07-28",
    start: "14:00",
    duration: 60,
    name: "이준호",
    chartNumber: "S-260728-011",
    dateOfBirth: "1975-09-02",
    sex: "남",
    careCategory: "일반",
    procedure: "위·대장",
    upperSedation: false,
    colonSedation: false,
    additionalExaminations: ["경동맥초음파"],
    deposit: "완료",
    medication: "완료",
    d1: "완료",
    verification: "완료",
    pacs: "완료",
    status: "예약",
    afternoonException: true,
    exceptionReason: "장정결 불량 재검",
    exceptionConfirmedBy: "관리자",
    bowelPreparation: "원프렙",
  },
  {
    id: "APT-011",
    date: "2026-07-29",
    start: "09:00",
    duration: 30,
    name: "윤서진",
    chartNumber: "S-260729-017",
    dateOfBirth: "1982-01-11",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "예약",
  },
  {
    id: "APT-012",
    date: "2026-07-29",
    start: "09:30",
    duration: 30,
    name: "서가람",
    chartNumber: "S-260729-019",
    dateOfBirth: "1979-10-10",
    sex: "남",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "예약",
  },
  {
    id: "APT-013",
    date: "2026-07-29",
    start: "10:00",
    duration: 30,
    name: "김은채",
    chartNumber: "S-260729-024",
    dateOfBirth: "1973-07-12",
    sex: "여",
    careCategory: "일반",
    procedure: "위",
    upperSedation: true,
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "완료",
    pacs: "완료",
    status: "예약",
  },
  {
    id: "APT-014",
    date: "2026-07-30",
    start: "09:00",
    duration: 30,
    name: "김지훈",
    chartNumber: "S-260730-002",
    dateOfBirth: "1975-05-20",
    sex: "남",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    additionalExaminations: ["복부초음파"],
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "내원",
  },
  {
    id: "APT-015",
    date: "2026-07-30",
    start: "09:30",
    duration: 30,
    name: "이소연",
    chartNumber: "S-260730-008",
    dateOfBirth: "1983-03-03",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    additionalExaminations: ["갑상선초음파"],
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "예약",
  },
  {
    id: "APT-016",
    date: "2026-07-30",
    start: "10:00",
    duration: 60,
    name: "권민재",
    chartNumber: "S-260730-010",
    dateOfBirth: "1974-01-16",
    sex: "남",
    careCategory: "일반",
    procedure: "대장",
    colonSedation: false,
    additionalExaminations: ["복부초음파"],
    deposit: "완료",
    medication: "완료",
    d1: "완료",
    verification: "완료",
    pacs: "완료",
    status: "검사 준비",
    bowelPreparation: "원프렙",
  },
  {
    id: "APT-017",
    date: "2026-07-30",
    start: "11:00",
    duration: 30,
    name: "정다은",
    chartNumber: "S-260730-013",
    dateOfBirth: "1979-05-13",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    additionalExaminations: ["심장초음파"],
    deposit: "완료",
    medication: "완료",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "내원",
  },
  {
    id: "APT-018",
    date: "2026-07-30",
    start: "14:00",
    duration: 60,
    name: "한지우",
    chartNumber: "S-260730-016",
    dateOfBirth: "1972-08-31",
    sex: "남",
    careCategory: "일반",
    procedure: "위·대장",
    upperSedation: true,
    colonSedation: false,
    additionalExaminations: ["경동맥초음파"],
    deposit: "완료",
    medication: "완료",
    d1: "완료",
    verification: "완료",
    pacs: "완료",
    status: "예약",
    afternoonException: true,
    exceptionReason: "원장 승인 예외",
    exceptionConfirmedBy: "관리자",
    bowelPreparation: "수프렙미니에스정",
  },
  {
    id: "APT-019",
    date: "2026-07-31",
    start: "09:00",
    duration: 30,
    name: "박수빈",
    chartNumber: "S-260731-001",
    dateOfBirth: "1982-12-01",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "예약",
  },
  {
    id: "APT-020",
    date: "2026-07-31",
    start: "09:30",
    duration: 60,
    name: "오세훈",
    chartNumber: "S-260731-004",
    dateOfBirth: "1975-06-25",
    sex: "남",
    careCategory: "일반",
    procedure: "대장",
    colonSedation: false,
    deposit: "완료",
    medication: "완료",
    d1: "완료",
    verification: "완료",
    pacs: "완료",
    status: "예약",
    bowelPreparation: "수클리어산",
  },
  {
    id: "APT-021",
    date: "2026-07-31",
    start: "10:30",
    duration: 30,
    name: "배지은",
    chartNumber: "S-260731-007",
    dateOfBirth: "1980-02-14",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "완료",
    pacs: "완료",
    status: "예약",
  },
  {
    id: "APT-022",
    date: "2026-07-31",
    start: "11:00",
    duration: 60,
    name: "나현우",
    chartNumber: "S-260731-008",
    dateOfBirth: "1971-03-09",
    sex: "남",
    careCategory: "일반",
    procedure: "위·대장",
    upperSedation: false,
    colonSedation: false,
    deposit: "완료",
    medication: "완료",
    d1: "완료",
    verification: "완료",
    pacs: "완료",
    status: "예약",
    bowelPreparation: "원프렙",
  },
  {
    id: "APT-023",
    date: "2026-07-31",
    start: "14:00",
    duration: 30,
    name: "유승민",
    chartNumber: "S-260731-012",
    dateOfBirth: "1978-07-17",
    sex: "남",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "완료",
    pacs: "완료",
    status: "예약",
    afternoonException: true,
    exceptionReason: "일정상 예외",
    exceptionConfirmedBy: "관리자",
  },
  {
    id: "APT-024",
    date: "2026-08-01",
    start: "09:00",
    duration: 30,
    name: "최유리",
    chartNumber: "S-260801-001",
    dateOfBirth: "1981-09-09",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "예약",
  },
  {
    id: "APT-025",
    date: "2026-08-01",
    start: "09:30",
    duration: 30,
    name: "황민서",
    chartNumber: "S-260801-002",
    dateOfBirth: "1979-04-02",
    sex: "여",
    careCategory: "검진",
    procedure: "위",
    upperSedation: true,
    deposit: "완료",
    medication: "불필요",
    d1: "완료",
    verification: "대기",
    pacs: "대기",
    status: "예약",
  },
];

export const initialPathologyCases: PathologyCase[] = [
  {
    id: "PATH-001",
    patientName: "정다은",
    chartNumber: "S-260730-013",
    sex: "여",
    dateOfBirth: "1979-05-13",
    examinationDate: "2026-07-30",
    caseType: "Biopsy",
    procedure: "위",
    site: "위 전정부",
    laboratory: "씨젠의료재단",
    accessionNumber: "SG-260730-1042",
    requestedDate: "2026-07-30",
    resultReportDate: "2026-07-31",
    resultSummary: "만성 위염 소견 — 합성 결과",
    doctorChecked: true,
    patientNotified: false,
    followUpNeeded: true,
    followUpDate: "2026-08-07",
    owner: "관리자",
    completed: false,
    overdue: false,
    note: "결과보고일은 씨젠 사이트 최초 게시일",
  },
  {
    id: "PATH-002",
    patientName: "김태현",
    chartNumber: "S-260728-006",
    sex: "남",
    dateOfBirth: "1972-03-29",
    examinationDate: "2026-07-28",
    caseType: "Biopsy",
    procedure: "대장",
    site: "상행결장",
    laboratory: "씨젠의료재단",
    accessionNumber: "SG-260728-0918",
    requestedDate: "2026-07-28",
    doctorChecked: false,
    patientNotified: false,
    followUpNeeded: false,
    owner: "관리자",
    completed: false,
    overdue: true,
  },
  {
    id: "PATH-003",
    patientName: "이소연",
    chartNumber: "S-260730-008",
    sex: "여",
    dateOfBirth: "1983-03-03",
    examinationDate: "2026-07-30",
    caseType: "CLO",
    procedure: "위",
    site: "위 전정부",
    laboratory: "원내",
    accessionNumber: "CLO-260730-03",
    requestedDate: "2026-07-30",
    resultReportDate: "2026-07-30",
    resultSummary: "음성 — 합성 결과",
    doctorChecked: false,
    patientNotified: false,
    followUpNeeded: false,
    owner: "관리자",
    completed: false,
    overdue: false,
  },
  {
    id: "PATH-004",
    patientName: "박수빈",
    chartNumber: "S-260731-001",
    sex: "여",
    dateOfBirth: "1982-12-01",
    examinationDate: "2026-07-31",
    caseType: "Biopsy",
    procedure: "위",
    site: "위 체부",
    laboratory: "씨젠의료재단",
    accessionNumber: "SG-260731-1110",
    requestedDate: "2026-07-31",
    doctorChecked: false,
    patientNotified: false,
    followUpNeeded: false,
    owner: "관리자",
    completed: false,
    overdue: false,
  },
  {
    id: "PATH-005",
    patientName: "송민아",
    chartNumber: "S-260728-021",
    sex: "여",
    dateOfBirth: "1980-04-06",
    examinationDate: "2026-07-28",
    caseType: "CLO",
    procedure: "위",
    site: "위 전정부",
    laboratory: "원내",
    accessionNumber: "CLO-260728-01",
    requestedDate: "2026-07-28",
    resultReportDate: "2026-07-28",
    resultSummary: "양성 — 합성 결과",
    doctorChecked: true,
    patientNotified: true,
    notificationDate: "2026-07-29",
    notificationMethod: "전화",
    followUpNeeded: true,
    followUpDate: "2026-08-03",
    owner: "관리자",
    completed: true,
    overdue: false,
  },
];

export function calculateAge(
  dateOfBirth: string,
  examinationDate: string,
  careCategory: CareCategory,
): number {
  const birth = new Date(`${dateOfBirth}T00:00:00`);
  const examination = new Date(`${examinationDate}T00:00:00`);

  if (careCategory === "검진") {
    return examination.getFullYear() - birth.getFullYear();
  }

  let age = examination.getFullYear() - birth.getFullYear();
  const birthdayHasPassed =
    examination.getMonth() > birth.getMonth() ||
    (examination.getMonth() === birth.getMonth() &&
      examination.getDate() >= birth.getDate());
  if (!birthdayHasPassed) age -= 1;
  return age;
}

export function formatAgeSex(appointment: Appointment): string {
  const age = calculateAge(
    appointment.dateOfBirth,
    appointment.date,
    appointment.careCategory,
  );
  const ageLabel =
    appointment.careCategory === "검진" ? `${age}` : `만 ${age}`;
  return `${appointment.careCategory} ${ageLabel} · ${appointment.sex}`;
}

export function procedureLabel(appointment: Appointment): string {
  if (appointment.procedure === "위") {
    return `위 ${appointment.upperSedation ? "수면" : "비수면"}`;
  }
  if (appointment.procedure === "대장") {
    return `대장 ${appointment.colonSedation ? "수면" : "비수면"}`;
  }
  return `위 ${appointment.upperSedation ? "수면" : "비수면"} · 대장 ${
    appointment.colonSedation ? "수면" : "비수면"
  }`;
}
