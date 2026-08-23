import { Tabs } from 'expo-router';

import { colors } from '@/ui/tokens';

// Stage 2: calendar + more만. index(홈)/timetable/alarms 탭은 해당 스테이지에서 추가 (master §8)
export default function TabsLayout() {
  return (
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
      <Tabs.Screen name="calendar" options={{ title: '캘린더' }} />
      <Tabs.Screen name="more" options={{ title: '더보기' }} />
    </Tabs>
  );
}
