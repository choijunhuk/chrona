/**
 * 1회성 순수 알람(weekdays 빈 배열)은 한 번 울리면 꺼져야 한다 (stage-15 실기기 발견).
 * 재계산은 "다음 발화"만 보므로 울린 뒤 다시 예약돼 사실상 매일 반복되던 버그.
 * 알람 발화(DELIVERED) 시 headless에서 호출 — 세션 없으면(로그아웃) 조용히 무시.
 */
import { supabase } from '@/data/supabase';

export async function disableOneShotAlarmIfNeeded(eventId: string): Promise<void> {
  if (!eventId.startsWith('standalone:')) return;
  const id = eventId.slice('standalone:'.length);
  try {
    const { data } = await supabase
      .from('standalone_alarms')
      .select('weekdays')
      .eq('id', id)
      .maybeSingle();
    if (!data || (data.weekdays?.length ?? 0) > 0) return;
    await supabase.from('standalone_alarms').update({ enabled: false }).eq('id', id);
  } catch {
    /* 오프라인·세션 없음 — 다음 포그라운드 재계산 때 사용자가 끄면 된다 */
  }
}
