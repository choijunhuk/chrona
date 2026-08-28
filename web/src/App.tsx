/**
 * Chrona 웹 (stage-10). 주간 타임그리드가 기본 — 데스크톱 UX 우선.
 * 알람은 웹에서 울리지 않는다 (구조적 한계 — 안내 문구로 명시).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { EventDraft } from '@app-data/mappers';
import {
  WEEKDAY_LABELS,
  addDaysOnly,
  addMonths,
  asDateOnly,
  dDayLabel,
  dayOfMonth,
  daysUntilDue,
  expandForDisplay,
  focusStreak,
  formatKoreanDate,
  fromDateOnly,
  monthGrid,
  monthOf,
  plannedVsActual,
  toDateOnly,
  todayDateOnly,
  weekOf,
  type ChronaEvent,
  type DateOnly,
  type DisplayItem,
  type MonthGridCell,
} from '@chrona/domain';

import {
  emptyDraft,
  useCategories,
  useDeleteEvent,
  useEvents,
  useOverrides,
  useSaveEvent,
  useSession,
  useUpsertOverride,
} from './hooks';
import { MeetPage, MeetPanel, meetTokenFromHash } from './Meet';
import { supabase } from './supabase';

const TZ = 'Asia/Seoul';
const HOUR_H = 48;
const SNAP_MIN = 30;

type DragState =
  | { kind: 'create'; day: DateOnly; startMin: number; endMin: number }
  | { kind: 'move'; item: DisplayItem; day: DateOnly; startMin: number; durMin: number }
  | { kind: 'resize'; item: DisplayItem; day: DateOnly; startMin: number; endMin: number }
  | null;

type PanelState =
  | { mode: 'new'; day: DateOnly; startMin: number; endMin: number }
  | { mode: 'edit'; item: DisplayItem }
  | null;

type ViewMode = 'week' | 'month';

/** 월간 셀에 접히지 않고 들어가는 일정 수 — 넘치면 '+N' */
const MONTH_CELL_ITEMS = 3;

export default function App() {
  const hash = useHash();
  const { data: session, isPending } = useSession();
  // 참여자 화면은 로그인 게이트 앞에 선다 — 계정 없이 열려야 하는 유일한 화면
  const meetToken = meetTokenFromHash(hash);
  if (meetToken) return <MeetPage token={meetToken} />;
  if (isPending) return null;
  if (!session) return <Auth />;
  return <Calendar />;
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

function Auth() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const send = async () => {
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setSent(true);
  };
  useEffect(() => {
    // 매직링크 복귀: URL 해시의 토큰은 supabase-js가 detectSessionInUrl로 처리.
    // INITIAL_SESSION은 매 로드마다 발화하므로 반드시 SIGNED_IN만 — 아니면 무한 리로드
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') window.location.reload();
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <div className="auth">
      <h1>Chrona</h1>
      {sent ? (
        <p>메일함에서 로그인 링크를 여세요.</p>
      ) : (
        <>
          <input
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
          />
          <button className="btn primary" onClick={() => void send()}>
            매직링크 보내기
          </button>
        </>
      )}
    </div>
  );
}

function Calendar() {
  const today = todayDateOnly(TZ);
  const [anchor, setAnchor] = useState<DateOnly>(today);
  const [view, setView] = useState<ViewMode>('week');
  const [panel, setPanel] = useState<PanelState>(null);
  const [meetOpen, setMeetOpen] = useState(false);
  const [drag, setDrag] = useState<DragState>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => weekOf(anchor), [anchor]);
  const grid = useMemo(() => {
    const { year, month } = monthOf(anchor);
    return monthGrid(year, month);
  }, [anchor]);

  // 전개 범위 = 지금 보이는 날짜 전부 (표시 범위 한정 — domain DoD)
  const visibleDays = useMemo(
    () => (view === 'week' ? days : grid.flat().map((c) => c.date)),
    [view, days, grid]
  );
  const range = useMemo(
    () => ({
      from: fromDateOnly(visibleDays[0], TZ),
      to: new Date(
        fromDateOnly(visibleDays[visibleDays.length - 1], TZ).getTime() + 86400_000 - 1
      ),
    }),
    [visibleDays]
  );

  const { data: events } = useEvents(range);
  const { data: overrides } = useOverrides();
  const { data: categories } = useCategories();
  const saveEvent = useSaveEvent();
  const upsertOverride = useUpsertOverride();

  const items = useMemo(
    () => expandForDisplay(events ?? [], overrides ?? [], range, TZ),
    [events, overrides, range]
  );

  // 날짜별 묶음 — 월간 셀이 소비한다. 종일은 걸치는 날 전부에 실린다 (종일 행과 같은 규칙)
  const byDay = useMemo(() => {
    const map = new Map<DateOnly, DisplayItem[]>();
    const push = (d: DateOnly, it: DisplayItem) => {
      const cur = map.get(d);
      if (cur) cur.push(it);
      else map.set(d, [it]);
    };
    const first = visibleDays[0];
    const last = visibleDays[visibleDays.length - 1];
    for (const it of items) {
      if (it.startDate) {
        // 보이는 범위로 잘라서 순회 — 장기 종일 일정이 범위 밖까지 도는 것 방지
        const end = it.endDate ?? it.startDate;
        for (
          let d = it.startDate < first ? first : it.startDate;
          d <= (end > last ? last : end);
          d = addDaysOnly(d, 1)
        ) {
          push(d, it);
        }
      } else if (it.start) {
        push(toDateOnly(it.start, TZ), it);
      }
    }
    return map;
  }, [items, visibleDays]);

  // 통계 요약 (검증 11 — 앱과 같은 domain 함수). 월간이면 그 달의 날짜만 센다
  const statDays = useMemo(
    () => (view === 'week' ? days : grid.flat().filter((c) => c.inMonth).map((c) => c.date)),
    [view, days, grid]
  );
  const statsLine = useMemo(() => {
    const occ = items
      .filter((it) => it.start && it.end && it.event.kind !== 'task')
      .map((it) => ({ categoryId: it.event.categoryId, start: it.start!, end: it.end }));
    const daily = plannedVsActual(occ, [], statDays, TZ);
    const planned = daily.reduce((a, d) => a + d.plannedMinutes, 0);
    const label = view === 'week' ? '이번 주' : '이번 달';
    return `${label} 계획 ${Math.floor(planned / 60)}시간 ${planned % 60}분`;
  }, [items, statDays, view]);

  const goPrev = useCallback(
    () => setAnchor((a) => (view === 'week' ? addDaysOnly(a, -7) : shiftMonth(a, -1))),
    [view]
  );
  const goNext = useCallback(
    () => setAnchor((a) => (view === 'week' ? addDaysOnly(a, 7) : shiftMonth(a, 1))),
    [view]
  );

  /** 월간에서 날짜를 고르면 그 주의 주간 뷰로 (앱 캘린더의 월→주 전환과 같은 동작) */
  const openWeekOf = (d: DateOnly) => {
    setAnchor(d);
    setView('week');
  };

  // 단축키 (stage-10 §1-4)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 't') setAnchor(today);
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'm') setView((v) => (v === 'week' ? 'month' : 'week'));
      if (e.key === 'n')
        setPanel({ mode: 'new', day: today, startMin: 9 * 60, endMin: 10 * 60 });
      if (e.key === 'Escape') setPanel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [today, goPrev, goNext]);

  // ── 드래그 계산 ─────────────────────────────────────
  const minFromY = (clientY: number): number => {
    const rect = gridRef.current!.getBoundingClientRect();
    const y = clientY - rect.top + gridRef.current!.scrollTop - 34; // dayhead 높이 보정
    const min = Math.round(((y / HOUR_H) * 60) / SNAP_MIN) * SNAP_MIN;
    return Math.max(0, Math.min(24 * 60, min));
  };

  const onGridMouseDown = (day: DateOnly, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.evblock')) return;
    const startMin = minFromY(e.clientY);
    setDrag({ kind: 'create', day, startMin, endMin: startMin + SNAP_MIN });
  };

  const onBlockMouseDown = (item: DisplayItem, day: DateOnly, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.start || !item.end) return;
    const isResize = (e.target as HTMLElement).classList.contains('resize');
    const sMin = minutesOfDay(item.start);
    const eMin = sMin + (item.end.getTime() - item.start.getTime()) / 60_000;
    if (isResize) setDrag({ kind: 'resize', item, day, startMin: sMin, endMin: eMin });
    else setDrag({ kind: 'move', item, day, startMin: sMin, durMin: eMin - sMin });
  };

  const onMouseMove = (day: DateOnly, e: React.MouseEvent) => {
    if (!drag) return;
    const min = minFromY(e.clientY);
    if (drag.kind === 'create') setDrag({ ...drag, day: drag.day, endMin: Math.max(drag.startMin + SNAP_MIN, min) });
    if (drag.kind === 'move') setDrag({ ...drag, day, startMin: Math.min(min, 24 * 60 - drag.durMin) });
    if (drag.kind === 'resize') setDrag({ ...drag, endMin: Math.max(drag.startMin + SNAP_MIN, min) });
  };

  const commitDrag = useCallback(() => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (d.kind === 'create') {
      setPanel({ mode: 'new', day: d.day, startMin: d.startMin, endMin: d.endMin });
      return;
    }
    const e = d.item.event;
    const newStart = atMin(d.day, d.kind === 'move' ? d.startMin : d.startMin);
    const newEnd =
      d.kind === 'move'
        ? new Date(newStart.getTime() + d.durMin * 60_000)
        : atMin(d.day, d.endMin);
    if (e.rrule && d.item.start) {
      // 반복 회차 이동 = override (이 일정만)
      void upsertOverride.mutateAsync({
        eventId: e.id,
        originalStart: d.item.start,
        newStart,
        newEnd,
        isCancelled: false,
      });
    } else {
      void saveEvent.mutateAsync({
        id: e.id,
        draft: { ...toDraft(e), startsAt: newStart, endsAt: newEnd },
      });
    }
  }, [drag, saveEvent, upsertOverride]);

  useEffect(() => {
    const up = () => commitDrag();
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [commitDrag]);

  const nowMin = minutesOfDay(new Date());

  return (
    <div className="app">
      <div className="main">
        <div className="topbar">
          <h1>
            {view === 'week'
              ? `${formatKoreanDate(days[0])} 주`
              : `${monthOf(anchor).year}년 ${monthOf(anchor).month}월`}
          </h1>
          <button className="btn" onClick={goPrev}>‹</button>
          <button className="btn" onClick={() => setAnchor(today)}>오늘</button>
          <button className="btn" onClick={goNext}>›</button>
          <div className="seg">
            <button
              className={`btn${view === 'week' ? ' primary' : ''}`}
              onClick={() => setView('week')}
            >
              주간
            </button>
            <button
              className={`btn${view === 'month' ? ' primary' : ''}`}
              onClick={() => setView('month')}
            >
              월간
            </button>
          </div>
          <span className="hint">
            n 새 일정 · t 오늘 · m 주/월 ·{' '}
            {view === 'week' ? '← → 주 이동' : '← → 달 이동 · 날짜 클릭 = 그 주 보기'}
          </span>
          <div className="spacer" />
          <span className="hint">{statsLine}</span>
          <button
            className={`btn${meetOpen ? ' primary' : ''}`}
            onClick={() => setMeetOpen((v) => !v)}
          >
            약속
          </button>
          <button className="btn" onClick={() => void supabase.auth.signOut().then(() => location.reload())}>
            로그아웃
          </button>
        </div>
        <div className="notice">
          ⏰ 알람은 앱에서만 울립니다. 웹에서 바꾼 일정은 앱을 한 번 열어야 알람에 반영됩니다.
        </div>

        {view === 'month' ? (
          <MonthView
            grid={grid}
            today={today}
            byDay={byDay}
            categories={categories ?? []}
            onPickDay={openWeekOf}
            onPickItem={(item) => setPanel({ mode: 'edit', item })}
          />
        ) : (
        <>
        {/* 종일 행 */}
        <div className="alldayrow">
          <div />
          {days.map((d) => (
            <div key={d}>
              {items
                .filter((it) => it.startDate && it.startDate <= d && d <= (it.endDate ?? it.startDate))
                .slice(0, 3)
                .map((it, i) => (
                  <div
                    key={i}
                    className="chip"
                    style={{ borderLeft: `3px solid ${colorOf(it.event, categories ?? [])}` }}
                    onClick={() => setPanel({ mode: 'edit', item: it })}
                  >
                    {it.event.kind === 'task'
                      ? `${dDayLabel(daysUntilDue(it.event.dueAt ?? new Date(), new Date(), TZ))} ${it.event.title}`
                      : it.event.title}
                  </div>
                ))}
            </div>
          ))}
        </div>

        {/* 주간 그리드 */}
        <div className="week" ref={gridRef}>
          <div className="timecol">
            <div className="dayhead" />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="timecell">{String(h).padStart(2, '0')}:00</div>
            ))}
          </div>
          {days.map((d) => (
            <div
              key={d}
              className="daycol"
              onMouseDown={(e) => onGridMouseDown(d, e)}
              onMouseMove={(e) => onMouseMove(d, e)}
            >
              <div className={`dayhead${d === today ? ' today' : ''}`}>
                {'월화수목금토일'[(fromDateOnly(d, TZ).getDay() + 6) % 7]}{' '}
                <span className="num">{Number(d.slice(8))}</span>
              </div>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="hourline" />
              ))}

              {d === today && (
                <div className="nowline" style={{ top: 34 + (nowMin / 60) * HOUR_H }} />
              )}

              {items
                .filter((it) => it.start && toDateOnly(it.start, TZ) === d && it.event.kind !== 'task')
                .map((it, i) => {
                  const sMin = minutesOfDay(it.start!);
                  const eMin = it.end ? sMin + (it.end.getTime() - it.start!.getTime()) / 60_000 : sMin + 60;
                  const color = colorOf(it.event, categories ?? []);
                  const dragged =
                    drag && drag.kind !== 'create' && drag.item.event.id === it.event.id && drag.item.start?.getTime() === it.start?.getTime();
                  return (
                    <div
                      key={`${it.event.id}-${i}`}
                      className="evblock"
                      style={{
                        top: 34 + (sMin / 60) * HOUR_H,
                        height: Math.max(22, ((eMin - sMin) / 60) * HOUR_H - 2),
                        background: `color-mix(in srgb, ${color} 18%, var(--surface))`,
                        borderLeftColor: color,
                        opacity: dragged ? 0.4 : 1,
                      }}
                      onMouseDown={(e) => onBlockMouseDown(it, d, e)}
                      onDoubleClick={() => setPanel({ mode: 'edit', item: it })}
                    >
                      <div className="t">{it.event.title}</div>
                      <div className="resize" />
                    </div>
                  );
                })}

              {/* 드래그 고스트 */}
              {drag && ghostFor(drag, d) && (
                <div className="ghost" style={ghostFor(drag, d)!} />
              )}
            </div>
          ))}
        </div>
        </>
        )}
      </div>

      {panel && (
        <EditorPanel
          panel={panel}
          categories={categories ?? []}
          onClose={() => setPanel(null)}
        />
      )}
      {meetOpen && <MeetPanel onClose={() => setMeetOpen(false)} />}
    </div>
  );
}

/**
 * 월간 격자 (6주 고정 — domain monthGrid). 셀 클릭은 그 주의 주간 뷰로
 * (앱 캘린더의 월→주 전환과 같다). 일정 칩 클릭은 편집 — 종일 행 칩과 같은 동작.
 */
function MonthView({
  grid,
  today,
  byDay,
  categories,
  onPickDay,
  onPickItem,
}: {
  grid: MonthGridCell[][];
  today: DateOnly;
  byDay: Map<DateOnly, DisplayItem[]>;
  categories: { id: string; name: string; color: string }[];
  onPickDay: (d: DateOnly) => void;
  onPickItem: (item: DisplayItem) => void;
}) {
  return (
    <div className="month">
      <div className="monthhead">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="monthgrid">
        {grid.map((week, wi) => (
          <div key={wi} className="monthweek">
            {week.map((cell) => {
              const dayItems = byDay.get(cell.date) ?? [];
              const shown = dayItems.slice(0, MONTH_CELL_ITEMS);
              const overflow = dayItems.length - shown.length;
              return (
                <div
                  key={cell.date}
                  className={`mcell${cell.inMonth ? '' : ' out'}${cell.date === today ? ' today' : ''}`}
                  onClick={() => onPickDay(cell.date)}
                >
                  <div className="n">{dayOfMonth(cell.date)}</div>
                  {shown.map((it, i) => {
                    const color = colorOf(it.event, categories);
                    const allDay = !!it.startDate;
                    return (
                      <div
                        key={`${it.event.id}-${i}`}
                        className={`mchip${allDay ? ' allday' : ''}`}
                        style={
                          allDay
                            ? {
                                background: `color-mix(in srgb, ${color} 18%, var(--surface))`,
                                borderLeftColor: color,
                              }
                            : undefined
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onPickItem(it);
                        }}
                      >
                        {!allDay && <span className="dot" style={{ background: color }} />}
                        <span className="t">
                          {it.event.kind === 'task'
                            ? `${dDayLabel(daysUntilDue(it.event.dueAt ?? new Date(), new Date(), TZ))} ${it.event.title}`
                            : it.event.title}
                        </span>
                      </div>
                    );
                  })}
                  {overflow > 0 && <div className="more">+{overflow}</div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ghostFor(drag: NonNullable<DragState>, day: DateOnly): React.CSSProperties | null {
  if (drag.kind === 'create' && drag.day === day) {
    return { top: 34 + (drag.startMin / 60) * HOUR_H, height: ((drag.endMin - drag.startMin) / 60) * HOUR_H };
  }
  if (drag.kind === 'move' && drag.day === day) {
    return { top: 34 + (drag.startMin / 60) * HOUR_H, height: (drag.durMin / 60) * HOUR_H };
  }
  if (drag.kind === 'resize' && drag.day === day) {
    return { top: 34 + (drag.startMin / 60) * HOUR_H, height: ((drag.endMin - drag.startMin) / 60) * HOUR_H };
  }
  return null;
}

function EditorPanel({
  panel,
  categories,
  onClose,
}: {
  panel: NonNullable<PanelState>;
  categories: { id: string; name: string; color: string }[];
  onClose: () => void;
}) {
  const saveEvent = useSaveEvent();
  const deleteEvent = useDeleteEvent();
  const upsertOverride = useUpsertOverride();

  const editing = panel.mode === 'edit' ? panel.item.event : null;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [categoryId, setCategoryId] = useState<string>(editing?.categoryId ?? '');
  const [startStr, setStartStr] = useState(() =>
    panel.mode === 'edit'
      ? toLocalInput(panel.item.start ?? atMin(todayDateOnly(TZ), 9 * 60))
      : toLocalInput(atMin(panel.day, panel.startMin))
  );
  const [endStr, setEndStr] = useState(() =>
    panel.mode === 'edit'
      ? toLocalInput(panel.item.end ?? atMin(todayDateOnly(TZ), 10 * 60))
      : toLocalInput(atMin(panel.day, panel.endMin))
  );

  const isRecurring = !!editing?.rrule;

  const doSave = async (scope: 'one' | 'all') => {
    const startsAt = new Date(startStr);
    const endsAt = new Date(endStr);
    if (panel.mode === 'edit' && editing) {
      if (isRecurring && scope === 'one' && panel.item.start) {
        await upsertOverride.mutateAsync({
          eventId: editing.id,
          originalStart: panel.item.start,
          newStart: startsAt,
          newEnd: endsAt,
          isCancelled: false,
        });
      } else {
        await saveEvent.mutateAsync({
          id: editing.id,
          draft: { ...toDraft(editing), title: title || editing.title, categoryId: categoryId || null, startsAt, endsAt },
        });
      }
    } else {
      await saveEvent.mutateAsync({
        id: null,
        draft: {
          ...emptyDraft(),
          title: title || '(제목 없음)',
          categoryId: categoryId || null,
          startsAt,
          endsAt,
        },
      });
    }
    onClose();
  };

  const doDelete = async (scope: 'one' | 'all') => {
    if (!editing) return;
    if (isRecurring && scope === 'one' && panel.mode === 'edit' && panel.item.start) {
      await upsertOverride.mutateAsync({
        eventId: editing.id,
        originalStart: panel.item.start,
        newStart: null,
        newEnd: null,
        isCancelled: true,
      });
    } else {
      await deleteEvent.mutateAsync(editing.id);
    }
    onClose();
  };

  return (
    <div className="panel">
      <b>{panel.mode === 'new' ? '새 일정' : '일정 편집'}</b>
      <label>
        제목
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <label>
        시작
        <input type="datetime-local" value={startStr} onChange={(e) => setStartStr(e.target.value)} />
      </label>
      <label>
        종료
        <input type="datetime-local" value={endStr} onChange={(e) => setEndStr(e.target.value)} />
      </label>
      <label>
        카테고리
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">없음</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      {isRecurring && <div className="notice">반복 일정 — 적용 범위를 선택하세요</div>}
      <div className="row">
        {isRecurring ? (
          <>
            <button className="btn primary" onClick={() => void doSave('one')}>이 일정만 저장</button>
            <button className="btn" onClick={() => void doSave('all')}>모든 일정</button>
          </>
        ) : (
          <button className="btn primary" onClick={() => void doSave('all')}>저장</button>
        )}
      </div>
      {panel.mode === 'edit' && (
        <div className="row">
          {isRecurring ? (
            <>
              <button className="btn" onClick={() => void doDelete('one')}>이 회차 삭제</button>
              <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => void doDelete('all')}>
                전체 삭제
              </button>
            </>
          ) : (
            <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => void doDelete('all')}>
              삭제
            </button>
          )}
        </div>
      )}
      <button className="btn" onClick={onClose}>닫기 (Esc)</button>
    </div>
  );
}

// ── 헬퍼 ────────────────────────────────────────────────
/** 이웃 달의 1일 — 월간 이동 후 주간으로 돌아가도 앵커가 그 달 안에 있게 한다 */
function shiftMonth(a: DateOnly, delta: number): DateOnly {
  const { year, month } = monthOf(a);
  const n = addMonths(year, month, delta);
  return asDateOnly(`${n.year}-${String(n.month).padStart(2, '0')}-01`);
}
function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes(); // 웹은 브라우저 로컬 = KST 가정 (fixedTimezone 미지원 안내)
}
function atMin(day: DateOnly, min: number): Date {
  const d = fromDateOnly(day, TZ);
  return new Date(d.getTime() + min * 60_000);
}
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function colorOf(e: ChronaEvent, categories: { id: string; color: string }[]): string {
  return e.color ?? categories.find((c) => c.id === e.categoryId)?.color ?? 'var(--accent)';
}
function toDraft(e: ChronaEvent): EventDraft {
  const { id: _id, updatedAt: _u, ...rest } = e;
  return rest;
}
