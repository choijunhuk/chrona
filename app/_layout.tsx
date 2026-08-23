import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { serializeAlarmPayload } from '@/domain/alarm-payload';
import {
  ensureChannels,
  getInitialAlarm,
  subscribeAlarmDelivered,
} from '@/native/alarm';
import { restoreMissingAlarms } from '@/native/alarm-store';

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await ensureChannels();

      // 풀스크린 알람으로 cold start 된 경우 — payload만으로 /alarm-ring 진입 (마스터 §3.5)
      const initial = await getInitialAlarm();
      if (initial && !cancelled) {
        router.replace({
          pathname: '/alarm-ring',
          params: {
            ...serializeAlarmPayload(initial.payload),
            notificationId: initial.notificationId,
          },
        });
        return;
      }

      // 부팅 복구 훅 (Stage 0: AsyncStorage 테스트 알람 수준, Stage 3에서 재계산으로 교체)
      await restoreMissingAlarms();
    })();

    // 앱이 떠 있는 동안 알람이 도착하면 알람 화면으로 이동
    const unsubscribe = subscribeAlarmDelivered((notificationId, payload) => {
      router.push({
        pathname: '/alarm-ring',
        params: { ...serializeAlarmPayload(payload), notificationId },
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [router]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0E0F13' },
        }}
      >
        <Stack.Screen name="alarm-ring" options={{ gestureEnabled: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
