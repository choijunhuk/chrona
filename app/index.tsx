import { Redirect } from 'expo-router';

// 첫 화면은 캘린더 (사용자 확정. 홈 탭은 Stage 4에서 교체 검토)
export default function Index() {
  return <Redirect href="/(tabs)/calendar" />;
}
