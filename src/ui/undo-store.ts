/**
 * 삭제 되돌리기 스낵바 상태 (stage-15).
 * 확인 다이얼로그가 있어도 "잘못 눌렀다"는 뒤늦게 온다 — 6초의 여지를 준다.
 * onUndo는 삭제를 실행한 화면이 넘긴다 (그 화면이 이미 닫혔어도 mutation은 그대로 돈다).
 */
import { create } from 'zustand';

export const UNDO_DURATION_MS = 6000;

type UndoState = {
  label: string | null;
  onUndo: (() => void) | null;
  expiresAt: number;
  show: (label: string, onUndo: () => void) => void;
  clear: () => void;
};

export const useUndoStore = create<UndoState>((set) => ({
  label: null,
  onUndo: null,
  expiresAt: 0,
  show: (label, onUndo) =>
    set({ label, onUndo, expiresAt: Date.now() + UNDO_DURATION_MS }),
  clear: () => set({ label: null, onUndo: null, expiresAt: 0 }),
}));

/** 화면에서 부르는 진입점 — 훅 없이 어디서나 */
export function showUndo(label: string, onUndo: () => void): void {
  useUndoStore.getState().show(label, onUndo);
}
