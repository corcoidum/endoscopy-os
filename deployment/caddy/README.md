# Caddy 내부망 HTTPS 설정

이 설정은 Caddy만 Host의 HTTPS Port에 공개하고 `/api/*`를 내부
FastAPI Container로 전달합니다. React Build Artifact는 `frontend_static`
Named Volume에서 읽기 전용으로 제공합니다.

Compose는 2026년 보안 수정이 포함된 `caddy:2.11.4-alpine` 이미지를 고정해
사용합니다. Version 변경은 Release Note 검토와 내부망 회귀 Test 후 진행합니다.

## 운영 전 필수 확인

1. `.env`의 `CLINIC_HOSTNAME`, `CLINIC_SITE_ADDRESS`,
   `CLINIC_ALLOWED_HOSTS`를 내부 DNS 또는 직원 PC `hosts` 설정과 일치시킵니다.
2. Backend용 `CLINIC_ALLOWED_SUBNETS`와 Caddy용
   `CADDY_ALLOWED_SUBNETS`의 예시망을 실제 승인 Subnet으로 교체합니다.
   Backend 값은 쉼표, Caddy 값은 공백으로 구분합니다.
3. Windows Defender Firewall은 승인 Subnet에서 서버 TCP 443으로 들어오는
   연결만 허용합니다. 공유기 Port Forwarding, DMZ, UPnP 공개는 사용하지 않습니다.
4. Docker Desktop의 NAT 때문에 Caddy가 직원 PC 주소 대신 변환된 주소를 보는지
   Caddy의 403 응답으로 확인합니다. 변환 주소를 허용해야 하더라도 Windows
   Firewall의 실제 원내 Subnet 제한을 해제하면 안 됩니다.

## Caddy Internal CA 공개 Root 인증서

최초 기동 후 공개 Root 인증서를 서버 PC로 복사할 수 있습니다.

```powershell
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .\deployment\certificates\clinic-endoscopy-root.crt
```

이 파일은 **공개 인증서**이며 Private Key가 아닙니다. 승인된 직원 PC의
`Local Computer > Trusted Root Certification Authorities`에만 배포합니다.
CA Private Key가 들어 있는 `caddy_data` Volume을 일반 파일공유나 Git에
복사하면 안 됩니다.

개발 PC 한 대에서만 확인할 때는 `.env.example`의 localhost 설정을 사용하며,
운영 Hostname과 개발 Hostname을 한 환경에서 혼용하지 않습니다.
