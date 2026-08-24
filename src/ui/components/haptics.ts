/** 햅틱 래퍼 (master §5.3: 일정 생성 / 알람 해제 / 뷰 전환 / 타이머 완료) */
import * as ExpoHaptics from 'expo-haptics';

export const haptics = {
  selection: () => ExpoHaptics.selectionAsync(),
  impact: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium),
  success: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success),
} as const;
