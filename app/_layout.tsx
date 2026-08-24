import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { handleAuthDeepLink, useSession } from '@/data/auth';
import { initNetListener } from '@/data/net';
import { QueryProvider } from '@/data/query';
import { serializeAlarmPayload } from '@/domain/alarm-payload';
import { ensureChannels, getInitialAlarm, subscribeAlarmDelivered } from '@/native/alarm';
import { restoreMissingAlarms } from '@/native/alarm-store';
import { useTheme } from '@/ui/theme';

// 스플래시는 폰트 로딩까지 유지 (stage-2 §1-2)
void SplashScreen.preventAutoHideAsync();

/** 세션 없으면 /auth로. 단 /alarm-ring은 예외 — payload 자립 알람은 세션과 무관 (master §3.5) */
function useAuthGuard() {
  const { session, loading } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const isPublic =
      pathname === '/auth' || pathname === '/alarm-ring' || pathname === '/auth-callback';
    if (!session && !isPublic) {
      router.replace('/auth');
    } else if (session && pathname === '/auth') {
      router.replace('/(tabs)/calendar');
    }
  }, [session, loading, pathname, router]);
}

function Root() {
  const router = useRouter();
  const url = Linking.useURL();
  const { colors } = useTheme();
  useAuthGuard();

  // 매직링크 딥링크 → 세션 확립
  useEffect(() => {
    if (!url) return;
    handleAuthDeepLink(url)
      .then((handled) => {
        if (handled) router.replace('/(tabs)/calendar');
      })
      .catch((e) => console.warn('[chrona] auth deep link failed:', e));
  }, [url, router]);

  // 알람 엔진 초기화 (Stage 0)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await ensureChannels();

      // 풀스크린 알람 cold start — payload만으로 /alarm-ring 진입 (master §3.5)
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

      await restoreMissingAlarms();
    })();

    const unsubscribeAlarm = subscribeAlarmDelivered((notificationId, payload) => {
      router.push({
        pathname: '/alarm-ring',
        params: { ...serializeAlarmPayload(payload), notificationId },
      });
    });
    const unsubscribeNet = initNetListener();

    return () => {
      cancelled = true;
      unsubscribeAlarm();
      unsubscribeNet();
    };
  }, [router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="alarm-ring" options={{ gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Pretendard: require('../assets/fonts/PretendardVariable.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null; // 스플래시 유지

  return (
    <GestureHandlerRootView style={styles.root}>
      <QueryProvider>
        <Root />
      </QueryProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
