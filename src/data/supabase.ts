/**
 * Supabase 클라이언트 — 앱에서 유일한 인스턴스 (stage-1 §1-1).
 * 키는 .env → app.config.ts extra로 주입. 하드코딩 금지.
 */
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { AppState } from 'react-native';

import type { Database } from './database.types';

const extra = Constants.expoConfig?.extra as
  | { supabaseUrl?: string; supabaseAnonKey?: string }
  | undefined;

const url = extra?.supabaseUrl;
const anonKey = extra?.supabaseAnonKey;

if (!url || !anonKey) {
  throw new Error(
    'Supabase 설정 누락: .env에 SUPABASE_URL / SUPABASE_ANON_KEY를 넣고 다시 빌드하세요.'
  );
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // RN — URL 세션 감지는 딥링크 핸들러에서 수동 처리
  },
});

// RN 권장 패턴: 포그라운드일 때만 토큰 자동 갱신 (배터리 정책 §6과도 일치)
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
