/** 최소 토스트 (stage-13). 뮤테이션 실패를 조용히 삼키지 않기 위한 장치 — React 트리 밖 DOM 하나만 쓴다 */
let host: HTMLDivElement | null = null;

export function toast(message: string): void {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/** react-query onError용. Error로 받는다 — unknown이면 훅의 TError가 넓어져 error 렌더가 깨진다 */
export function toastError(prefix: string) {
  return (e: Error) => toast(`${prefix} — ${e.message || '알 수 없는 오류'}`);
}
