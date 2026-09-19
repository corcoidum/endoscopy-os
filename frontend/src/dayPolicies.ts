import { useEffect, useState } from "react";
import { apiRequest } from "./api.ts";

// Backend가 한 번에 돌려주는 최대 기간(MAX_DAY_POLICY_DAYS)과 맞춘다.
// backend/app/services/schedule_overrides.py 참고.
export const MAX_DAY_POLICY_RANGE_DAYS = 62;

const LOCAL_FALLBACK_VERSION = "LOCAL-WEEKDAY-DEFAULT";

export type DayPolicy = {
  serviceDate: string;
  closed: boolean;
  morningStartMinute: number | null;
  morningEndMinute: number | null;
  upperCapacity: number | null;
  colonCapacity: number | null;
  afternoonAllowed: boolean;
  schedulePolicyVersion: string;
};

export type DayPolicyLookup = (date: string) => DayPolicy;

type DayPolicyResponse = {
  service_date: string;
  closed: boolean;
  morning_start_time: string | null;
  morning_end_time: string | null;
  upper_capacity: number | null;
  colon_capacity: number | null;
  afternoon_allowed: boolean;
  schedule_policy_version: string;
};

type DayPolicyListResponse = { items: DayPolicyResponse[] };

function minuteOf(value: string | null): number | null {
  if (value === null) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Backend 응답을 아직 받지 못했을 때만 쓰는 요일 기본 규칙이다.
 * 날짜별 휴진·운영시간·수용량 예외는 알 수 없으므로, 받은 규칙이 있으면 항상 그쪽이 이긴다.
 */
export function fallbackDayPolicy(date: string): DayPolicy {
  const weekday = new Date(`${date}T00:00:00`).getDay();
  if (weekday === 0) {
    return {
      serviceDate: date,
      closed: true,
      morningStartMinute: null,
      morningEndMinute: null,
      upperCapacity: null,
      colonCapacity: null,
      afternoonAllowed: false,
      schedulePolicyVersion: LOCAL_FALLBACK_VERSION,
    };
  }
  const shortMorning = weekday === 3 || weekday === 6;
  return {
    serviceDate: date,
    closed: false,
    morningStartMinute: 9 * 60,
    morningEndMinute: shortMorning ? 11 * 60 : 12 * 60,
    upperCapacity: shortMorning ? null : 5,
    colonCapacity: shortMorning ? null : 3,
    afternoonAllowed: false,
    schedulePolicyVersion: LOCAL_FALLBACK_VERSION,
  };
}

export function isFallbackPolicy(policy: DayPolicy): boolean {
  return policy.schedulePolicyVersion === LOCAL_FALLBACK_VERSION;
}

export function dayPolicyLookup(
  policies: ReadonlyMap<string, DayPolicy>,
): DayPolicyLookup {
  return (date) => policies.get(date) ?? fallbackDayPolicy(date);
}

/** 한도를 넘는 기간만 나눠서 조회한다. */
export function dayPolicyQueries(startDate: string, endDate: string) {
  const day = 86400000;
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  const parse = (value: string) => new Date(`${value}T00:00:00Z`);
  const queries: Array<{ startDate: string; endDate: string }> = [];
  const last = parse(endDate);
  for (let cursor = parse(startDate); cursor <= last; ) {
    const chunkEnd = new Date(
      Math.min(cursor.getTime() + MAX_DAY_POLICY_RANGE_DAYS * day, last.getTime()),
    );
    queries.push({ startDate: iso(cursor), endDate: iso(chunkEnd) });
    cursor = new Date(chunkEnd.getTime() + day);
  }
  return queries;
}

export async function fetchDayPolicies(
  startDate: string,
  endDate: string,
): Promise<Map<string, DayPolicy>> {
  const policies = new Map<string, DayPolicy>();
  for (const query of dayPolicyQueries(startDate, endDate)) {
    const params = new URLSearchParams({
      start_date: query.startDate,
      end_date: query.endDate,
    });
    const response = await apiRequest<DayPolicyListResponse>(
      `/api/schedule/day-policies?${params.toString()}`,
    );
    for (const item of response.items) {
      policies.set(item.service_date, {
        serviceDate: item.service_date,
        closed: item.closed,
        morningStartMinute: minuteOf(item.morning_start_time),
        morningEndMinute: minuteOf(item.morning_end_time),
        upperCapacity: item.upper_capacity,
        colonCapacity: item.colon_capacity,
        afternoonAllowed: item.afternoon_allowed,
        schedulePolicyVersion: item.schedule_policy_version,
      });
    }
  }
  return policies;
}

/**
 * 화면이 다루는 기간의 날짜별 규칙을 Backend에서 받아 lookup으로 돌려준다.
 * 조회에 실패해도 요일 기본 규칙으로 화면은 계속 그린다.
 */
export function useDayPolicies(
  startDate: string,
  endDate: string,
  revision: number,
): { dayPolicy: DayPolicyLookup; error: string } {
  const [policies, setPolicies] = useState<ReadonlyMap<string, DayPolicy>>(
    () => new Map(),
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchDayPolicies(startDate, endDate)
      .then((loaded) => {
        if (cancelled) return;
        setPolicies(loaded);
        setError("");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof Error
            ? `일정 규칙을 불러오지 못해 요일 기본값으로 표시합니다. ${cause.message}`
            : "일정 규칙을 불러오지 못해 요일 기본값으로 표시합니다.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, revision]);

  return { dayPolicy: dayPolicyLookup(policies), error };
}
