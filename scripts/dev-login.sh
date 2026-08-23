#!/bin/bash
# 개발용 로그인 우회: 매직링크 이메일 rate limit 회피.
# admin generate_link → 서버 verify로 세션 토큰 획득 → adb 딥링크로 앱에 주입.
# 비밀값은 .env.local에서 읽는다 (SUPABASE_SERVICE_ROLE_KEY).
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; source .env; source .env.local; set +a
SR="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set in .env.local}"
ANON="${SUPABASE_ANON_KEY:?}"
URL="${SUPABASE_URL:?}"
EMAIL='choijunhuk2007@gmail.com'

echo "== 1. 링크 생성 (이메일 발송 없음)"
HASH=$(curl -s -X POST "$URL/auth/v1/admin/generate_link" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR" -H 'Content-Type: application/json' \
  -d "{\"type\":\"magiclink\",\"email\":\"$EMAIL\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);if(!j.hashed_token){console.error(JSON.stringify(j));process.exit(1)}console.log(j.hashed_token)})")

echo "== 2. 서버 verify → 세션 토큰"
RESP=$(curl -s -X POST "$URL/auth/v1/verify" \
  -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d "{\"type\":\"magiclink\",\"token_hash\":\"$HASH\"}")
AT=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);if(!j.access_token){console.error(JSON.stringify(j).slice(0,300));process.exit(1)}console.log(j.access_token)})")
RT=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).refresh_token)})")

echo "== 3. 앱에 딥링크 주입"
# adb shell은 기기 셸에서 재파싱 — '#'가 주석 처리되지 않게 전체 인용
adb shell "am start -a android.intent.action.VIEW -d 'chrona://auth-callback#access_token=$AT&refresh_token=$RT'"
echo "== 완료: 앱이 debug 화면으로 넘어가면 성공"
