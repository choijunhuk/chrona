import { Redirect } from 'expo-router';

// Stage 0의 유일한 UI는 /debug (Stage 0 §0)
export default function Index() {
  return <Redirect href="/debug" />;
}
