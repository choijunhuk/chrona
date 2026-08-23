# Chrona — 진행 기록

각 스테이지 완료 후 Claude Code가 이 파일에 추가한다.

## 형식

```
## Stage N — 제목
- 완료일:
- 브랜치 / 머지 커밋:
- 구현 요약:
- DoD 충족:
- 실기기 검증 결과:
- 미결 / 다음으로 넘긴 것:
- 발견한 함정 (다음 스테이지가 알아야 할 것):
```

---

## Stage 0 — 알람 PoC

- 완료일: 2026-08-23
- 브랜치 / 머지 커밋: `stage-0-alarm-poc` / `2a608e8`
- 구현 요약: Expo SDK 57 + dev client + Notifee. 알람 엔진(`src/native/alarm.ts`, 유일 Notifee 접점), payload 자립(§3.5) 알람 화면, config plugin 매니페스트 주입, 자정 앵커, 부팅 복구, `/debug` 화면. 삼성 실기기(SM-S928N)에서 앱 완전 종료 + 잠금 + 오프라인 상태 전체화면 알람 실증.
- DoD 충족: 9/9 (검증 13개 중 11개 조건부 — 아래 참고)
- 실기기 검증 결과: 11/13 통과. 9(스누즈 소진)·12(Doze 1시간)는 사용자 결정으로 미검증
- 미결 / 다음으로 넘긴 것: Doze 실증(Stage 3), 채널 사운드 간헐 무음 → FGS+ALARM 스트림 직접 재생 교체(Stage 3), 앵커 무음화(Stage 3)
- 발견한 함정: ① FSI는 화면 꺼짐/잠금에서만 액티비티 발동(Android 14+ 정책, 화면 켜짐 = 헤드업만) ② 채널 사운드는 notification 스트림이라 One UI가 간헐적으로 삼킴 ③ RN dev 메뉴가 알람 화면 터치 가로챔 — 실기기 테스트는 release 빌드로 ④ expo config 로더가 로컬 `.ts` plugin 해석 불가 — plugin만 `.js` ⑤ `git merge`는 Claude Code 분류기 차단 — 사용자가 직접 실행
