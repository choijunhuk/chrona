/**
 * 알람음 피커 (stage-14). 내장 5종 + 시스템 알람 벨소리 목록.
 * 행을 누르면 즉시 선택 + 3초 미리듣기. 닫으면 미리듣기 정지.
 * 설정·일정 편집기·순수 알람 폼이 공용으로 쓴다.
 */
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';

import { getSoundOptions, previewSound, stopPreview } from '@/native/alarm';
import { haptics } from '@/ui/components/haptics';
import { AppText } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type ThemeColors } from '@/ui/tokens';

type Props = {
  visible: boolean;
  value: string | undefined;
  onPick: (key: string) => void;
  onClose: () => void;
  title?: string;
};

export function SoundPicker({ visible, value, onPick, onClose, title = '알람음' }: Props) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [options, setOptions] = useState<{ key: string; label: string }[]>([]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void getSoundOptions().then((o) => {
      if (alive) setOptions(o);
    });
    return () => {
      alive = false;
      void stopPreview();
    };
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.card} onStartShouldSetResponder={() => true}>
          <AppText variant="title">{title}</AppText>
          <FlatList
            data={options}
            keyExtractor={(o) => o.key}
            style={styles.list}
            renderItem={({ item }) => {
              const on = item.key === value;
              return (
                <Pressable
                  style={styles.row}
                  onPress={() => {
                    haptics.selection();
                    onPick(item.key);
                    void previewSound(item.key);
                  }}
                >
                  <AppText color={on ? 'accent' : 'text'}>{item.label}</AppText>
                  {on ? <AppText color="accent">✓</AppText> : null}
                </Pressable>
              );
            }}
          />
          <Pressable style={styles.done} onPress={onClose}>
            <AppText color="accent">완료</AppText>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: `${colors.black}88`,
      justifyContent: 'center',
      padding: spacing.xl,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.xl,
      gap: spacing.xs,
      maxHeight: '70%',
    },
    list: { flexGrow: 0 },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
      minHeight: 44,
      alignItems: 'center',
    },
    done: { alignSelf: 'flex-end', paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  });
