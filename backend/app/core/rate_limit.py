from __future__ import annotations

import math
import threading
import time
from collections import deque
from collections.abc import Callable


class LoginFailureThrottle:
    """Client IP별 로그인 실패 횟수를 Process Memory에서 제한한다.

    계정 잠금만 있으면 한 PC에서 여러 직원 계정을 차례로 잠글 수 있으므로 IP 기준
    한도를 함께 둔다. Uvicorn Worker를 여러 개 띄우면 Worker마다 따로 계산되고,
    Backend 재시작 시 초기화된다.
    """

    def __init__(
        self,
        *,
        max_failures: int,
        window_seconds: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._clock = clock
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _recent_failures(self, client_ip: str, now: float) -> deque[float]:
        failures = self._failures.get(client_ip)
        if failures is None:
            return deque()
        while failures and now - failures[0] >= self.window_seconds:
            failures.popleft()
        if not failures:
            del self._failures[client_ip]
        return failures

    def retry_after_seconds(self, client_ip: str) -> int | None:
        with self._lock:
            now = self._clock()
            failures = self._recent_failures(client_ip, now)
            if len(failures) < self.max_failures:
                return None
            return max(1, math.ceil(self.window_seconds - (now - failures[0])))

    def record_failure(self, client_ip: str) -> None:
        with self._lock:
            now = self._clock()
            self._recent_failures(client_ip, now)
            self._failures.setdefault(client_ip, deque()).append(now)

    def reset(self, client_ip: str) -> None:
        with self._lock:
            self._failures.pop(client_ip, None)
