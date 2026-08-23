# Stage 0 — 알람 PoC (삼성 실기기 전체화면 알람 뚫기)

> **선행 조건**: `docs/00-MASTER.md`를 먼저 읽을 것.
> **브랜치**: `stage-0-alarm-poc`
> **이 스테이지의 목적**: 프로젝트 리스크의 전부를 여기서 제거한다. 삼성 기기에서 앱이 완전히 종료된 상태로 잠금화면 위에 전체화면 알람이 뜨고, 끌 때까지 소리가 나는 것을 실증한다.

---

## 0. 이 스테이지에서 하지 않는 것

명시적으로 **만들지 말 것**. 유혹이 있겠지만 전부 후속 스테이지 소관이다.

- Supabase 연결, 로그인, DB 스키마
- 캘린더 UI, 일정 목록, 어떤 형태의 앱 화면이든
- 디자인 토큰 적용, 애니메이션, 폰트
- 반복 일정, rrule
- 상태 관리 라이브러리(Zustand/TanStack Query)

**이 스테이지의 산출물은 "동작하는 앱"이 아니라 "동작이 증명된 알람 엔진"이다.** 화면은 디버그 화면 하나면 충분하다.

---

## 1. 작업 순서

### 1-1. 프로젝트 초기화

```
Expo + TypeScript + expo-router
```

- 패키지 매니저는 pnpm
- `src/` 폴더 구조는 마스터 §2대로 미리 만들어 둔다 (빈 폴더라도)
- ESLint에 `no-restricted-imports` 룰을 넣어 **`src/domain/`에서 `react-native`·`expo-*` import를 금지**한다. 지금 넣어야 나중에 안 새어 들어간다
- `.gitignore`, `tsconfig` paths(`@/*` → `src/*`) 설정

### 1-2. Dev client 준비

**Expo Go로는 이 스테이지가 불가능하다.** 처음부터 dev client로 간다.

- `expo-dev-client` 설치
- `app.config.ts`로 전환 (plugin 배열을 코드로 다루기 위해)
- EAS 설정: `eas.json`에 `development`(dev client, APK) / `production`(APK) 프로필
- **로컬 빌드와 EAS 클라우드 빌드 중 어느 쪽으로 갈지 사용자에게 먼저 물을 것.** 로컬 빌드는 Android Studio + JDK 환경이 필요하고, EAS 클라우드는 무료 티어 대기열이 있다. 각각의 트레이드오프를 설명하고 선택을 받는다

### 1-3. Notifee 연결

- `@notifee/react-native` 설치
- **config plugin 작성** (`plugins/withChronaAlarm.ts`) — 아래를 AndroidManifest에 주입:

```
권한:
  POST_NOTIFICATIONS
  USE_EXACT_ALARM
  USE_FULL_SCREEN_INTENT
  RECEIVE_BOOT_COMPLETED
  WAKE_LOCK
  FOREGROUND_SERVICE
  FOREGROUND_SERVICE_MEDIA_PLAYBACK
  VIBRATE

MainActivity 속성:
  android:showWhenLocked="true"
  android:turnScreenOn="true"
  android:launchMode="singleTask"
```

`showWhenLocked` / `turnScreenOn`이 없으면 잠금화면 위로 뜨지 않는다.

- 알람음 파일 4종 + 무음을 `res/raw/`에 복사하는 처리도 이 plugin에 포함
- 사운드 파일이 없으면 일단 시스템 기본음으로 진행하고, 파일 배치 위치와 네이밍 규칙만 확정해 둔다

### 1-4. 알림 채널 생성

앱 부팅 시 1회. 마스터 §3.3 그대로:

```
chrona.alarm     HIGH,    bypassDnd: true
chrona.reminder  DEFAULT
chrona.ongoing   LOW
chrona.timer     LOW
```

채널은 생성 후 속성 변경이 불가능하므로 **처음부터 정확하게** 만든다.

### 1-5. `src/native/alarm.ts` — 알람 엔진 래퍼

앱의 나머지 부분은 Notifee를 직접 부르지 않는다. 전부 이 모듈을 통한다.

```ts
scheduleAlarm(payload: AlarmPayload, fireAt: Date): Promise<string>
scheduleReminder(payload, fireAt): Promise<string>
showOngoing(payload): Promise<void>
cancelOngoing(): Promise<void>
cancelAll(): Promise<void>
listScheduled(): Promise<ScheduledAlarm[]>
```

**`AlarmPayload` 타입은 `src/domain/`에 정의한다** (순수 타입이므로).
마스터 §3.5의 필드를 전부 포함해야 한다:

```ts
type AlarmPayload = {
  eventId: string
  occurrenceStart: string      // ISO
  title: string
  timeLabel: string            // '오후 9:00' — 미리 포맷해서 담는다
  colorHex: string
  snoozeMinutes: number
  maxSnooze: number
  currentSnoozeCount: number
  soundKey: string
}
```

알람(②) 예약 시 반드시:
```ts
android: {
  channelId: 'chrona.alarm',
  category: AndroidCategory.ALARM,
  importance: AndroidImportance.HIGH,
  fullScreenAction: { id: 'alarm-ring', launchActivity: 'default' },
  pressAction: { id: 'alarm-ring', launchActivity: 'default' },
  loopSound: true,
  ongoing: true,
  autoCancel: false,
  vibrationPattern: [...],
}
trigger: {
  type: TriggerType.TIMESTAMP,
  timestamp: fireAt.getTime(),
  alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
}
```

`SET_ALARM_CLOCK`이 **Doze 모드를 뚫는 유일한 경로**다. `SET_EXACT_AND_ALLOW_WHILE_IDLE`로 대체하지 말 것.

### 1-6. `/alarm-ring` 화면

**이 화면의 제약이 이 스테이지의 핵심이다.**

- 전체화면. 상태바 숨김, 잠금화면 위 표시
- **네트워크 호출, Supabase 조회, AsyncStorage 조회를 일절 하지 않는다.** payload만으로 렌더링
- 표시: 시각(거대하게) / 제목 / 색상 악센트
- 조작: **밀어서 해제**(슬라이드 제스처 필수 — 오조작 방지) / **탭해서 스누즈**
- 해제 시: 알림 취소 + 포그라운드 서비스 즉시 종료 + 소리 정지
- 스누즈 시: `currentSnoozeCount + 1`로 새 알람을 `snoozeMinutes` 뒤에 예약. `maxSnooze` 도달 시 스누즈 버튼 비활성 + "놓친 알람" 알림 1건

디자인은 이 스테이지에선 최소한으로. 검은 배경 + 흰 텍스트면 충분하다. 폴리싱은 Stage 8.

### 1-7. 포그라운드 서비스

Notifee `registerForegroundService`로 등록.
- 알람이 울리는 동안에만 생존
- 해제/스누즈 즉시 `stopForegroundService()`
- **여기서 서비스가 안 죽으면 배터리가 녹는다.** 종료 경로를 전부 확인할 것 (해제 / 스누즈 / 최대 스누즈 소진 / 새 알람이 덮어쓸 때)

### 1-8. 부팅 복구

`RECEIVE_BOOT_COMPLETED` 수신 시 재예약. Stage 0에서는 실제 일정이 없으므로, **AsyncStorage에 저장해 둔 테스트 알람을 복구하는 수준**으로만 구현하고 훅을 남겨둔다. 실제 재계산 로직은 Stage 3.

### 1-9. 자정 앵커 알람

매일 자정에 재계산을 돌리고 자기 자신을 다음 자정으로 재예약하는 알람.
Stage 0에서는 **앵커가 실제로 매일 발화하는지만 검증**한다 (재계산 로직은 비워두고 로그만).

### 1-10. `/debug` 화면

마스터 §10 그대로. 이 스테이지의 유일한 UI다.

```
[10초 뒤 알람 테스트]      ② 알람 모드
[10초 뒤 리마인더 테스트]  ① 조용한 알림
[상시 알림 표시 / 해제]    ③ ongoing
[예약된 알람 목록 덤프]
[권한 상태 전체 조회]
[모든 알람 취소]
[자정 앵커 즉시 예약(1분 뒤로 시뮬)]
```

권한 상태 조회는 마스터 §4.1의 1~4번(API로 확인 가능한 것)을 표시한다.

---

## 2. 삼성 실기기 검증 (사용자가 직접 수행)

구현이 끝나면 아래 체크리스트를 사용자에게 제시하고, **전부 통과할 때까지 이 스테이지를 완료로 보고하지 않는다.**

각 항목마다 실패 시 어디를 의심해야 하는지도 함께 안내할 것.

| # | 검증 항목 | 통과 기준 |
|---|---|---|
| 1 | 앱 포그라운드 상태에서 알람 | 전체화면 뜨고 소리 남 |
| 2 | 앱 백그라운드 상태에서 알람 | 동일 |
| 3 | **앱 완전 종료(최근앱에서 스와이프) 후 알람** | 동일. 제목·시각이 정상 표시 |
| 4 | **화면 꺼짐 + 잠금 상태에서 알람** | 화면이 켜지고 잠금 위에 뜸 |
| 5 | 방해 금지 모드 ON 상태에서 알람 | 울림 (`bypassDnd`) |
| 6 | 해제할 때까지 소리 지속 | `loopSound` 동작 |
| 7 | 해제 후 소리·서비스 즉시 종료 | 알림창에 잔여 없음 |
| 8 | 스누즈 5분 → 재발화 | 카운트 증가 확인 |
| 9 | 스누즈 3회 후 자동 해제 | "놓친 알람" 알림 생성 |
| 10 | 재부팅 후 예약 복구 | 테스트 알람 유지 |
| 11 | **비행기 모드 + 오프라인에서 알람** | 정상 (네트워크 의존 없음 증명) |
| 12 | **1시간 이상 방치(Doze 진입) 후 알람** | 정확한 시각에 발화 |
| 13 | 자정 앵커 발화 | 로그 확인 |

**12번이 가장 중요하다.** Doze를 뚫지 못하면 이 앱은 알람 앱으로서 실패다. 실패 시 확인 순서:
1. `SET_ALARM_CLOCK`을 실제로 쓰고 있는지
2. 배터리 최적화 "제한 없음"이 적용됐는지
3. 삼성 「미사용 앱 절전」 목록에서 제외됐는지
4. 디바이스 케어 자동 최적화가 꺼져 있는지

3·4번은 API로 확인이 안 되므로 사용자에게 수동 설정을 안내해야 한다.

---

## 3. 완료 기준 (DoD)

- [ ] dev client APK가 삼성 기기에 설치되고 실행됨
- [ ] `/debug` 화면의 모든 버튼이 동작
- [ ] §2의 검증 항목 13개 전부 통과
- [ ] `src/native/alarm.ts`가 유일한 Notifee 접점 (다른 파일에서 직접 import 없음)
- [ ] `AlarmPayload` 타입이 `src/domain/`에 있고 RN 의존이 없음
- [ ] `/alarm-ring`이 네트워크·DB·스토리지 조회 없이 렌더링됨 (코드로 확인 가능)
- [ ] 포그라운드 서비스가 모든 종료 경로에서 정상 종료됨
- [ ] config plugin이 매니페스트에 권한·액티비티 속성을 정확히 주입 (`npx expo prebuild` 후 생성된 매니페스트로 확인)
- [ ] `docs/ARCHITECTURE.md`에 알람 엔진 구조와 삼성 대응 노하우가 기록됨

---

## 4. 이 스테이지에서 사용자에게 물어야 할 것

작업 시작 전에 확인:
1. **빌드 방식** — EAS 클라우드 빌드 vs 로컬 빌드 (§1-2)
2. **기기 모델과 One UI 버전** — 삼성 설정 화면 경로 안내가 버전마다 다르다
3. **알람음 파일** — 직접 준비할지, 시스템 기본음으로 시작할지

---

## 5. 다음 스테이지로 넘길 항목

- 부팅 복구 시 실제 재계산 로직 (Stage 3)
- 자정 앵커의 재계산 본체 (Stage 3)
- 권한 온보딩 UI 및 주 1회 재확인 (Stage 3)
- 알람 화면 디자인 폴리싱 (Stage 8)
