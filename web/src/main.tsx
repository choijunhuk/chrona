import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

/**
 * 라우팅이 여기 있는 이유 (stage-13): 참여자는 계정이 없고 캘린더를 볼 일도 없다.
 * 두 화면을 각각 lazy로 나눠 `#/meet/<token>`으로 들어온 사람이 캘린더 번들
 * (반복 전개·통계·월간 격자)을 내려받지 않게 한다.
 */
const App = lazy(() => import('./App'));
const MeetPage = lazy(() => import('./Meet').then((m) => ({ default: m.MeetPage })));

/** '#/meet/<uuid>' 해시에서 토큰을 뽑는다. 매직링크 복귀 해시(#access_token=…)와 섞이지 않게 엄격히 */
function meetTokenFromHash(hash: string): string | null {
  const m = /^#\/meet\/([0-9a-f-]{36})$/i.exec(hash);
  return m ? m[1] : null;
}

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function Root() {
  const token = meetTokenFromHash(useHash());
  return (
    <Suspense fallback={<div className="meetpage"><p className="hint">불러오는 중…</p></div>}>
      {token ? <MeetPage token={token} /> : <App />}
    </Suspense>
  );
}

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <Root />
    </QueryClientProvider>
  </StrictMode>
);
