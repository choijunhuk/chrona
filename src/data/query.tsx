/**
 * TanStack Query 세팅 (stage-1 §1-7).
 * staleTime 30초 / gcTime 24시간 + AsyncStorage persist → 오프라인 읽기.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { ReactNode } from 'react';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
    },
  },
});

// 캐시 복원 시 Date 되살리기 — JSON은 Date를 ISO 문자열로 저장한다.
// 이거 없으면 오프라인 복원 직후 .getTime() 호출에서 앱이 죽는다 (Stage 2에서 실제 발생).
// 'T'를 포함하는 완전한 ISO timestamp만 변환 — DateOnly('YYYY-MM-DD')는 문자열 유지 (§7.2).
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'chrona.query-cache', // Stage 0의 알람 저장 키와 네임스페이스 분리
  deserialize: (cached) =>
    JSON.parse(cached, (_key, value) =>
      typeof value === 'string' && ISO_RE.test(value) ? new Date(value) : value
    ),
});

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000 }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
