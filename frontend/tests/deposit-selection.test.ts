import assert from "node:assert/strict";
import test from "node:test";

import { isDepositSelectionComplete } from "../src/scheduler.ts";

test("예약금 상태를 선택하지 않으면 예약금 확인이 완료되지 않는다", () => {
  assert.equal(
    isDepositSelectionComplete({
      depositStatus: "UNSELECTED",
      depositAmount: undefined,
      depositPaymentMethod: "미확인",
    }),
    false,
  );
});

test("미납으로 예약을 명시하면 예약금 확인이 완료된다", () => {
  assert.equal(
    isDepositSelectionComplete({
      depositStatus: "UNPAID",
      depositAmount: undefined,
      depositPaymentMethod: "미확인",
    }),
    true,
  );
});

test("납부 완료는 금액과 수납 방법이 모두 필요하다", () => {
  assert.equal(
    isDepositSelectionComplete({
      depositStatus: "PAID",
      depositAmount: 20000,
      depositPaymentMethod: "미확인",
    }),
    false,
  );
  assert.equal(
    isDepositSelectionComplete({
      depositStatus: "PAID",
      depositAmount: 20000,
      depositPaymentMethod: "카드",
    }),
    true,
  );
});
