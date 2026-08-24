import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';

// Stage 5에서 구현 (stage-4 §1-7 — 자리만)
export default function Timetable() {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <AppText color="textDim">시간표는 준비 중이에요</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
