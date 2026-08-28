# Stage 12 — 약속 잡기 (when2meet)

> 승인된 설계 (2026-08-28). 주최자가 후보 날짜·시간 범위로 폴을 만들고 링크를 공유하면,
> 친구들이 **계정 없이** 가능한 시간을 칠한다. 히트맵에서 겹치는 시간을 보고 확정하면
> Chrona 일정으로 등록된다. AI/유료 API 없음 — Supabase RPC + 웹/앱만.

## 1. 데이터 모델 (`0005_meet.sql`)

- `meet_polls`: id, user_id(주최자), title, dates date[], time_start/time_end time,
  slot_minutes(30), share_token uuid unique, confirmed_start timestamptz, created_at, deleted_at
- `meet_responses`: id, poll_id fk cascade, participant_name, slots text[]
  ('YYYY-MM-DDTHH:MM' 키), updated_at, unique(poll_id, participant_name)

## 2. 접근 모델 (핵심 결정)

- RLS: 두 테이블 모두 주최자(`auth.uid() = user_id` — select 서브쿼리로 캐시)만 직접 접근.
  responses는 부모 poll 경유 확인
- 익명 참여자는 **security definer RPC 두 개로만** 접근:
  - `meet_get_poll(token uuid)` → title/dates/시간범위/confirmed_start/응답 목록(JSON).
    주최자 정보 미노출
  - `meet_submit_response(token uuid, name text, slots text[])` → 같은 이름이면 교체(upsert)
- RPC 방어: 이름 1~20자, slots ≤ 500개, poll당 응답자 ≤ 50명. `set search_path = ''`
- 토큰은 URL로만 전달되는 추측 불가 uuid. 그 이상의 방어는 개인용 YAGNI

## 3. 도메인 (`packages/domain/src/meet.ts` — 순수, 앱·웹 공유)

- `slotKeys(dates, timeStart, timeEnd, slotMinutes)`: 폴의 전체 슬롯 키 생성
- `heatmap(responses)`: 슬롯 키 → 응답자 이름 배열 집계
- `bestSlots(heatmap, limit)`: 겹침 많은 순 정렬 (동률이면 이른 시각)
- vitest 테스트

## 4. 웹 (`#/meet/<token>` 해시 라우트)

- 참여자: 이름 입력 → 날짜×시간 그리드 드래그 토글 → 저장(RPC). 히트맵 배경 항상 표시
- 주최자: 로그인 상태면 자기 폴에서 슬롯 클릭 → 확정 → events에 일정 생성
- 폴 생성 폼: 로그인 상태의 메인 화면에서 진입

## 5. 앱 (더보기 → 약속 잡기)

- 폴 목록/생성(제목, 날짜 다중 선택, 시간 범위) — 웹 링크 공유 시트
- 상세: 응답 현황(도메인 heatmap 상위 슬롯 리스트) + 확정 버튼 → 일정 생성
- 그리드 페인팅 UI는 웹 전용 (앱은 조회·확정 중심)

## 6. DoD

- [ ] 마이그레이션 적용 + 타입 재생성
- [ ] 도메인 테스트 green
- [ ] RPC 익명 왕복 (curl, anon key) 검증
- [ ] 웹: 생성→링크 접속→응답→히트맵→확정→일정 생성 흐름 브라우저 검증
- [ ] 앱: typecheck/lint/테스트 + 릴리스 빌드
- [ ] 배포(웹) 후 실링크 확인
