// Chrona 진입점.
// 알람 엔진(포그라운드 서비스 runner + background 이벤트 핸들러)은
// React 트리 밖에서 등록해야 앱이 죽은 상태의 headless 발화를 받을 수 있다.
const { registerAlarmEngine } = require('./src/native/alarm');

registerAlarmEngine();

require('expo-router/entry');
