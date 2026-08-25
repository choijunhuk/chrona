/**
 * 위젯 데이터 브릿지 (stage-9 §1-2).
 * JS: filesDir/widget-data.json 에 write → 네이티브 모듈로 갱신 브로드캐스트.
 * 호출 시점 = rescheduleAll 마지막 단계 (CRUD/앵커/포그라운드 — master §6).
 */
import { NativeModules } from 'react-native';
import { File, Paths } from 'expo-file-system';

import type { Occurrence } from '@/domain/schedule';
import { formatKoreanDate } from '@/domain/calendar';
import { dDayLabel, daysUntilDue } from '@/domain/task';
import { formatTimeLabel, toDateOnly } from '@/domain/time';
import type { ChronaEvent } from '@/domain/types';

type WidgetPayload = {
  updatedAt: string;
  today: string;
  events: { id: string; time: string; title: string; color: string; allDay: boolean }[];
  nextClass: { label: string; time: string; room: string | null } | null;
  tasks: { dday: string; title: string; urgent: boolean }[];
};

export async function pushWidgetData(
  occurrences: Occurrence[],
  events: ChronaEvent[],
  tz: string
): Promise<void> {
  try {
    const now = new Date();
    const today = toDateOnly(now, tz);
    const eventById = new Map(events.map((e) => [e.id, e]));

    const todays = occurrences
      .filter((o) => toDateOnly(o.start, tz) === today)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(0, 8);

    const nextClassOcc = occurrences
      .filter((o) => eventById.get(o.eventId)?.kind === 'timetable' && o.start > now)
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

    const openTasks = events
      .filter((e) => e.kind === 'task' && !e.isDone && e.dueAt)
      .map((e) => ({ e, days: daysUntilDue(e.dueAt!, now, tz) }))
      .sort((a, b) => a.days - b.days)
      .slice(0, 3);

    const payload: WidgetPayload = {
      updatedAt: now.toISOString(),
      today: formatKoreanDate(today),
      events: todays.map((o) => ({
        id: o.eventId,
        time: formatTimeLabel(o.start, tz),
        title: o.title,
        color: o.colorHex ?? '#6C7BFF',
        allDay: false,
      })),
      nextClass: nextClassOcc
        ? {
            label: nextClassOcc.title,
            time:
              toDateOnly(nextClassOcc.start, tz) === today
                ? formatTimeLabel(nextClassOcc.start, tz)
                : `내일 ${formatTimeLabel(nextClassOcc.start, tz)}`,
            room: eventById.get(nextClassOcc.eventId)?.location ?? null,
          }
        : null,
      tasks: openTasks.map(({ e, days }) => ({
        dday: dDayLabel(days),
        title: e.title,
        urgent: days <= 1,
      })),
    };

    const file = new File(Paths.document, 'widget-data.json');
    file.write(JSON.stringify(payload));

    // 갱신 브로드캐스트 (모듈 없는 빌드에서도 조용히 통과)
    const mod = NativeModules.ChronaWidget as { updateWidgets?: () => Promise<number> } | undefined;
    if (mod?.updateWidgets) await mod.updateWidgets();
  } catch (e) {
    console.warn('[chrona] widget push failed:', e);
  }
}
