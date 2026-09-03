import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { getLocalSettings } from '@/data/local-settings';
import { setWeekStartsOn } from '@/domain/calendar';
import { setTimeFormat } from '@/domain/time';
import { UndoSnackbar } from '@/ui/components/undo-snackbar';
import { useTheme } from '@/ui/theme';

// Stage 2: calendar + more만. index(홈)/timetable/alarms 탭은 해당 스테이지에서 추가 (master §8)
export default function TabsLayout() {
  const { colors } = useTheme();
  // 도메인은 설정 저장소를 모른다 — 탭 진입 시 1회 주입 (stage-15)
  useEffect(() => {
    void getLocalSettings().then((s) => {
      setWeekStartsOn(s.weekStartsOn);
      setTimeFormat(s.timeFormat);
    });
  }, []);
  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textDim,
          tabBarLabelStyle: { fontSize: 12, fontFamily: 'Pretendard' },
          tabBarIconStyle: { display: 'none' },
        }}
      >
        <Tabs.Screen name="index" options={{ title: '홈' }} />
        <Tabs.Screen name="calendar" options={{ title: '캘린더' }} />
        <Tabs.Screen name="timetable" options={{ title: '시간표' }} />
        <Tabs.Screen name="alarms" options={{ title: '알람' }} />
        <Tabs.Screen name="more" options={{ title: '더보기' }} />
      </Tabs>
      {/* 탭 바 위에 뜨는 되돌리기 — 삭제한 화면이 닫혀도 살아 있어야 해서 여기에 한 번만 */}
      <UndoSnackbar />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
