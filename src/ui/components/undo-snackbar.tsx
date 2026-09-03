/**
 * 삭제 되돌리기 스낵바 (stage-15). 탭 바 위에 떠서 6초 뒤 자동으로 사라진다.
 * 탭 레이아웃에 한 번만 렌더한다 — 화면이 닫혀도 되돌리기가 살아 있어야 하기 때문.
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';
import { UNDO_DURATION_MS, useUndoStore } from '@/ui/undo-store';

export function UndoSnackbar() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const label = useUndoStore((s) => s.label);
  const expiresAt = useUndoStore((s) => s.expiresAt);
  const clear = useUndoStore((s) => s.clear);

  useEffect(() => {
    if (!label) return;
    const remain = Math.max(expiresAt - Date.now(), 0) || UNDO_DURATION_MS;
    const t = setTimeout(clear, remain);
    return () => clearTimeout(t);
  }, [label, expiresAt, clear]);

  if (!label) return null;

  return (
    <Animated.View
      entering={FadeInDown}
      exiting={FadeOutDown}
      // 탭 바(약 52) + 제스처 인셋 위로 띄운다
      style={[styles.wrap, { bottom: insets.bottom + 60 }]}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        <AppText variant="caption" numberOfLines={1} style={styles.label}>
          {label}
        </AppText>
        <Pressable
          hitSlop={8}
          onPress={() => {
            const { onUndo } = useUndoStore.getState();
            clear();
            haptics.success();
            onUndo?.();
          }}
        >
          <AppText variant="caption" color="accent">
            되돌리기
          </AppText>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: spacing.xl,
      right: spacing.xl,
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      minHeight: 48,
    },
    label: { flex: 1 },
  });
