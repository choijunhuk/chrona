/**
 * 매직링크 복귀 라우트. 토큰 처리는 _layout의 딥링크 핸들러가 하고,
 * 여기는 세션 확립까지 로딩만 보여준다 (없으면 expo-router가 Unmatched Route를 띄움).
 */
import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useSession } from '@/data/auth';
import { colors } from '@/ui/tokens';

export default function AuthCallback() {
  const { session, loading } = useSession();

  if (!loading && session) return <Redirect href="/(tabs)/calendar" />;
  if (!loading && !session) return <Redirect href="/auth" />;

  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
