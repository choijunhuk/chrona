/**
 * 기기 로컬 설정 (stage-11) — DB 마이그레이션 없이 AsyncStorage에만 저장.
 * 아침 브리핑·점진 볼륨·시험기간 모드는 기기 1대 전제라 서버 동기화가 필요 없다.
 * headless(재계산)에서도 읽어야 하므로 async 접근 + UI용 동기 캐시를 함께 둔다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'chrona.local-settings';

export type LocalSettings = {
  morningBriefingEnabled: boolean;
  morningBriefingTime: string; // 'HH:MM'
  gradualVolume: boolean;
  examMode: boolean;
};

export const LOCAL_DEFAULTS: LocalSettings = {
  morningBriefingEnabled: false,
  morningBriefingTime: '08:00',
  gradualVolume: false,
  examMode: false,
};

let cache: LocalSettings | null = null;

export async function getLocalSettings(): Promise<LocalSettings> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? { ...LOCAL_DEFAULTS, ...(JSON.parse(raw) as Partial<LocalSettings>) } : LOCAL_DEFAULTS;
  } catch {
    cache = LOCAL_DEFAULTS;
  }
  return cache;
}

export async function setLocalSettings(patch: Partial<LocalSettings>): Promise<LocalSettings> {
  const next = { ...(await getLocalSettings()), ...patch };
  cache = next;
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** UI 초기 렌더용 동기 캐시 (getLocalSettings 호출 이후에만 유효) */
export function localSettingsCache(): LocalSettings {
  return cache ?? LOCAL_DEFAULTS;
}
