import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Component, useEffect, type ReactNode } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { handleAuthDeepLink, useSession } from '@/data/auth';
import { autoBackupIfDue } from '@/data/backup';
import { initNetListener } from '@/data/net';
import { QueryProvider } from '@/data/query';
import { serializeAlarmPayload } from '@/domain/alarm-payload';
import { ensureChannels, getInitialAlarm, subscribeAlarmDelivered } from '@/native/alarm';
import { rescheduleAll } from '@/native/rescheduler';
import { maybeWeeklyCheck } from '@/native/permissions';
import { restoreTimer } from '@/native/timer';
import { useTheme } from '@/ui/theme';
import { darkColors } from '@/ui/tokens';

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

      // 앱 시작 = 포그라운드 진입 → 재계산 (master §3.6 트리거 1. Stage 0의 부팅 복구도 대체)
      await rescheduleAll();
      await maybeWeeklyCheck();
      await restoreTimer(); // 진행 중이던 타이머 복원 (stage-6)
      void autoBackupIfDue(); // 주1회 로컬 자동 백업 (stage-11) — 실패해도 무시
    })();

    const unsubscribeAlarm = subscribeAlarmDelivered((notificationId, payload) => {
      router.push({
        pathname: '/alarm-ring',
        params: { ...serializeAlarmPayload(payload), notificationId },
      });
    });
    const unsubscribeNet = initNetListener();
    // 백그라운드 → 포그라운드 복귀 시 재계산 (master §3.6 트리거 1)
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void rescheduleAll();
        void maybeWeeklyCheck(); // 주1회 권한 재확인 (master §4.2)
        void autoBackupIfDue();
      }
    });

    return () => {
      cancelled = true;
      unsubscribeAlarm();
      unsubscribeNet();
      appStateSub.remove();
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

/** 화면 크래시 시 흰 화면 대신 복구 UI (stage-8 §6). 토큰 밖 정적 색 — 테마 훅도 죽었을 수 있음 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <View style={styles.crash}>
          <Text style={styles.crashTitle}>문제가 생겼어요</Text>
          <Text style={styles.crashBody}>{String(this.state.error)}</Text>
          <Pressable style={styles.crashBtn} onPress={() => this.setState({ error: null })}>
            <Text style={styles.crashBtnText}>다시 시도</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
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
      <ErrorBoundary>
        <QueryProvider>
          <Root />
        </QueryProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

// ErrorBoundary는 테마 훅이 죽어도 동작해야 하므로 정적 다크 팔레트 사용
const styles = StyleSheet.create({
  root: { flex: 1 },
  crash: {
    flex: 1,
    backgroundColor: darkColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  crashTitle: { color: darkColors.text, fontSize: 20, fontWeight: '600' },
  crashBody: { color: darkColors.textSub, fontSize: 13, textAlign: 'center' },
  crashBtn: {
    backgroundColor: darkColors.accent,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 12,
  },
  crashBtnText: { color: darkColors.white, fontWeight: '600' },
});
