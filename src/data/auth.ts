/**
 * 인증 (stage-1 §1-2) — 매직링크 전용. OAuth 없음 (개인용).
 */
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { supabase } from './supabase';

const REDIRECT_URL = 'chrona://auth-callback';

export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: REDIRECT_URL },
  });
  if (error) throw error;
}

/**
 * 매직링크 딥링크 처리: chrona://auth-callback#access_token=...&refresh_token=...
 * (Supabase verify 엔드포인트가 redirectTo로 토큰을 fragment에 실어 보낸다)
 */
export async function handleAuthDeepLink(url: string): Promise<boolean> {
  if (!url.startsWith(REDIRECT_URL)) return false;
  const fragment = url.split('#')[1];
  if (!fragment) return false;
  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return false;
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  return true;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** 세션 상태 훅 — 라우트 가드용. loading 동안엔 리다이렉트 판단 금지 */
export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}
