import { Redirect } from 'expo-router';

// 첫 화면 = 홈 (stage-4 §1-7)
export default function Index() {
  return <Redirect href="/(tabs)" />;
}
