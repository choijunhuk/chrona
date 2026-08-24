/** 햅틱 래퍼 (master §5.3). 설정에서 전체 끄기 가능 (stage-8 §1-2) */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoHaptics from 'expo-haptics';

let enabled = true;
void AsyncStorage.getItem('chrona.haptics').then((v) => {
  if (v === 'off') enabled = false;
});

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
  void AsyncStorage.setItem('chrona.haptics', on ? 'on' : 'off');
}

export function hapticsEnabled(): boolean {
  return enabled;
}

export const haptics = {
  selection: () => (enabled ? ExpoHaptics.selectionAsync() : Promise.resolve()),
  impact: () =>
    enabled ? ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium) : Promise.resolve(),
  success: () =>
    enabled
      ? ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success)
      : Promise.resolve(),
  warning: () =>
    enabled
      ? ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning)
      : Promise.resolve(),
} as const;
