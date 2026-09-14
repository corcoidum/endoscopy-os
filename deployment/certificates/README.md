# 내부 CA 공개 인증서 보관 위치

이 폴더는 Caddy Internal CA의 **공개 Root 인증서**를 직원 PC에 배포하기 전
임시로 두는 위치입니다. 실제 인증서 파일과 CA Private Key는 Git에 Commit하지
않습니다.

CA Private Key는 `caddy_data` Docker Named Volume 안에 유지하며, Backup 시에도
암호화된 Configuration Backup과 제한된 관리자 절차로만 취급합니다.
