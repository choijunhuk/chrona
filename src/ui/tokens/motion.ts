// master §5.2 — 스프링만 사용. duration 기반 easing 금지.
export const spring = { damping: 18, stiffness: 180, mass: 1 } as const;
export const springSoft = { damping: 22, stiffness: 120 } as const;
export const springSnappy = { damping: 15, stiffness: 260 } as const;
