import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signOut } from '@/data/auth';
import { Button } from '@/ui/components/button';
import { AppText } from '@/ui/components/text';
import { colors, spacing } from '@/ui/tokens';

// Stage 2: 로그아웃 + debug 진입만. 통계/브리핑/권한/백업/테마는 해당 스테이지에서 (master §8)
export default function More() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
      <AppText variant="title">더보기</AppText>
      <Button label="디버그 화면" variant="ghost" onPress={() => router.push('/debug')} />
      <Button
        label="로그아웃"
        variant="danger"
        onPress={() => {
          void signOut();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.lg },
});
