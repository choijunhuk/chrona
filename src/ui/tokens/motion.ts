// master §5.2 — 스프링만 사용. duration 기반 easing 금지.
export const spring = { damping: 18, stiffness: 180, mass: 1 } as const;
export const springSoft = { damping: 22, stiffness: 120 } as const;
export const springSnappy = { damping: 15, stiffness: 260 } as const;

/**
 * 제스처 스냅용: rest 임계값 완화 필수.
 * 기본값(0.01px)은 서브픽셀 진동이 잦아들 때까지 완료 콜백을 수 초 지연시킨다
 * (스와이프 후 달 전환이 5초 늦던 실측 버그의 원인).
 */
export const springSnap = {
  damping: 20,
  stiffness: 220,
  mass: 1,
  overshootClamping: true,
  restDisplacementThreshold: 0.5,
  restSpeedThreshold: 1,
} as const;
