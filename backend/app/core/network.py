from __future__ import annotations

from ipaddress import ip_address, ip_network

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

from app.core.config import Settings


def _belongs_to_any(address: str, networks: tuple[str, ...]) -> bool:
    try:
        parsed_address = ip_address(address)
    except ValueError:
        return False
    return any(
        parsed_address in ip_network(network, strict=False) for network in networks
    )


def resolve_client_ip(request: Request, settings: Settings) -> str:
    direct_ip = request.client.host if request.client else ""
    forwarded_for = request.headers.get("x-forwarded-for")
    if (
        settings.trust_proxy_headers
        and forwarded_for
        and _belongs_to_any(direct_ip, settings.trusted_proxy_subnets)
    ):
        # 가장 가까운 Proxy(오른쪽)부터 거슬러 올라가 신뢰 Proxy가 아닌 첫 주소를 쓴다.
        # 왼쪽 값은 Client가 임의로 넣을 수 있으므로 그대로 믿지 않는다.
        hops = [hop.strip() for hop in forwarded_for.split(",") if hop.strip()]
        for hop in reversed(hops):
            if not _belongs_to_any(hop, settings.trusted_proxy_subnets):
                return hop
        if hops:
            return hops[0]
    return direct_ip


class InternalNetworkMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        super().__init__(app)
        self.settings = settings

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        client_ip = resolve_client_ip(request, self.settings)
        if self.settings.enforce_internal_subnet and not _belongs_to_any(
            client_ip, self.settings.allowed_subnets
        ):
            return JSONResponse(
                status_code=403,
                content={
                    "code": "NETWORK_NOT_ALLOWED",
                    "message": "원내 내부망에서만 접속할 수 있습니다.",
                },
            )
        return await call_next(request)
