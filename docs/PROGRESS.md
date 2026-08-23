# Chrona — 진행 기록

## Stage 0 — 알람 PoC (2026-08-23 완료, main 머지)

**목적 달성: 삼성 실기기(SM-S928N)에서 앱 완전 종료 + 잠금 상태로 전체화면 알람 실증.**

- Expo SDK 57 + dev client + Notifee, pnpm, 마스터 §2 폴더 구조
- 알람 엔진: `src/native/alarm.ts` (유일 Notifee 접점), payload 자립(§3.5) 준수
- 검증 11/13 통과. 미검증: 9(스누즈 소진), 12(Doze 1시간) — 사용자 결정으로 스킵
- 핵심 발견: FSI는 화면 꺼짐/잠금에서만 발동(OS 정책), 채널 사운드 간헐 무음
  → Stage 3에서 FGS + ALARM 스트림 직접 재생으로 교체 예정
- 상세: `docs/ARCHITECTURE.md` Stage 0 섹션
