/** 쿼리 키 팩토리 (stage-1 §1-7). 키 문자열을 코드에 흩뿌리지 않는다. */
export const qk = {
  events: (range: { from: string; to: string }) => ['events', range] as const,
  allEvents: () => ['events'] as const,
  event: (id: string) => ['events', 'detail', id] as const,
  categories: () => ['categories'] as const,
  settings: () => ['settings'] as const,
  periodPresets: () => ['periodPresets'] as const,
} as const;
