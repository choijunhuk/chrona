/**
 * 약속 잡기(when2meet) 웹 UI (stage-12).
 * 참여자 화면은 로그인 없이 열린다 — 데이터 통로는 RPC 두 개뿐.
 * 그리드 좌표·집계는 전부 @chrona/domain/meet (앱과 공유하는 순수 로직).
 */
import { Fragment, useEffect, useRef, useState } from 'react';

import { formatInTimeZone } from 'date-fns-tz';

// 배럴('@chrona/domain')이 아니라 meet 모듈 직접 — 배럴은 recurrence(rrule)까지 끌고 온다.
// 참여자 화면이 캘린더 번들을 내려받지 않게 하는 코드 분할의 전제다 (stage-13)
import {
  bestSlots,
  heatmap,
  slotKey,
  slotLabel,
  timeSlots,
  type MeetPollInfo,
  type MeetResponse,
} from '@chrona/domain/meet';

import {
  NAME_TAKEN,
  useConfirmMeetSlot,
  useCreatePoll,
  useDeletePoll,
  useMeetPoll,
  useMyPolls,
  useOwnedPoll,
  useSession,
  useSubmitMeetResponse,
  type MeetPollRow,
} from './hooks';

const TZ = 'Asia/Seoul';
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
/** 0006 meet_responses_name_check와 같은 값 */
const NAME_MAX = 40;

export function meetShareUrl(token: string): string {
  return `${location.origin}/#/meet/${token}`;
}

// ── 참여자 화면 ─────────────────────────────────────────

export function MeetPage({ token }: { token: string }) {
  const { data: poll, isPending, error } = useMeetPoll(token);
  const { data: session } = useSession();
  const { data: owned } = useOwnedPoll(token, !!session);

  if (isPending) return <div className="meetpage"><p className="hint">불러오는 중…</p></div>;
  if (error || !poll) {
    return (
      <div className="meetpage">
        <h1>Chrona</h1>
        <p>약속을 찾을 수 없어요.</p>
        <p className="hint">링크가 만료되었거나 주최자가 삭제했을 수 있어요.</p>
      </div>
    );
  }
  return <MeetPoll token={token} poll={poll} owned={owned ?? null} />;
}

function MeetPoll({
  token,
  poll,
  owned,
}: {
  token: string;
  poll: MeetPollInfo;
  owned: MeetPollRow | null;
}) {
  const [name, setName] = useState('');
  const [mine, setMine] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const paint = useRef<boolean | null>(null);
  const loadedFor = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const submit = useSubmitMeetResponse(token);
  const confirm = useConfirmMeetSlot();

  const trimmed = name.trim();
  const locked = !!poll.confirmedStart;
  const times = timeSlots(poll.timeStart, poll.timeEnd, poll.slotMinutes);

  // 내 선택을 하나의 응답처럼 섞어서 집계 — 칠하는 즉시 히트맵에 반영된다
  const merged: MeetResponse[] = [
    ...poll.responses.filter((r) => r.name !== trimmed),
    ...(trimmed ? [{ name: trimmed, slots: [...mine] }] : []),
  ];
  const map = heatmap(merged);
  const total = merged.length;

  // 이름이 기존 응답과 같으면 그 사람의 저장된 슬롯을 불러온다 (다시 칠하지 않게).
  // 이름이 바뀔 때만 — 폴이 재조회될 때마다 편집 중인 선택을 덮어쓰면 안 된다
  useEffect(() => {
    const n = name.trim();
    if (loadedFor.current === n) return;
    loadedFor.current = n;
    const existing = poll.responses.find((r) => r.name === n);
    if (existing) setMine(new Set(existing.slots));
  }, [name, poll]);

  // 그리드 밖에서 손/버튼을 떼도 칠하기가 끝나게
  useEffect(() => {
    const up = () => (paint.current = null);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const apply = (key: string, add: boolean) => {
    setSaved(false);
    setMine((prev) => {
      if (prev.has(key) === add) return prev;
      const next = new Set(prev);
      if (add) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  /**
   * 포인터 이벤트로 칠한다 (stage-13). 터치는 pointerdown 순간 그 칸에 암묵 캡처가 걸려
   * 칸별 enter 핸들러가 죽는다 — 그리드 하나가 캡처를 가져가고 좌표로 칸을 찾는다.
   * 덕분에 마우스·터치·펜이 같은 경로를 탄다.
   */
  const keyAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    return (el?.closest('.mslot') as HTMLElement | null)?.dataset.key ?? null;
  };

  const onGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const key = keyAt(e.clientX, e.clientY);
    if (!key) return;
    setHover(key);
    if (locked) return;
    e.preventDefault();
    gridRef.current?.setPointerCapture(e.pointerId);
    paint.current = !mine.has(key);
    apply(key, paint.current);
  };

  const onGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const key = keyAt(e.clientX, e.clientY);
    setHover(key);
    if (locked || paint.current === null || !key) return;
    apply(key, paint.current);
  };

  const onGridPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    paint.current = null;
    if (gridRef.current?.hasPointerCapture(e.pointerId)) {
      gridRef.current.releasePointerCapture(e.pointerId);
    }
  };

  const nameTaken = submit.error instanceof Error && submit.error.message === NAME_TAKEN;
  const canSave = trimmed.length >= 1 && trimmed.length <= NAME_MAX && !submit.isPending;
  const save = async () => {
    try {
      await submit.mutateAsync({ name: trimmed, slots: [...mine] });
      setSaved(true);
    } catch {
      // 이름 충돌은 아래 인라인 문구, 나머지는 토스트가 알린다
    }
  };

  const ranked = bestSlots(map, 3);
  const hoverNames = hover ? (map.get(hover) ?? []) : [];

  return (
    <div className="meetpage">
      <div className="meethead">
        <h1>{poll.title}</h1>
        <span className="hint">Chrona 약속 잡기</span>
      </div>

      {locked ? (
        <div className="notice confirmed">
          확정: {slotLabel(formatInTimeZone(new Date(poll.confirmedStart!), TZ, "yyyy-MM-dd'T'HH:mm"))}
        </div>
      ) : (
        <div className="meetrow">
          <input
            placeholder="이름"
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
          <button className="btn primary" disabled={!canSave} onClick={() => void save()}>
            저장
          </button>
          {saved && <span className="hint saved">저장됨</span>}
          {nameTaken ? (
            <span className="hint danger">이미 사용 중인 이름이에요</span>
          ) : (
            submit.error && <span className="hint danger">저장 실패 — 다시 시도해 주세요</span>
          )}
          <span className="hint">드래그해서 가능한 시간을 칠하세요 · 응답 {poll.responses.length}명</span>
        </div>
      )}

      <div className="mgridwrap">
      <div
        className="mgrid"
        ref={gridRef}
        style={{ gridTemplateColumns: `56px repeat(${poll.dates.length}, minmax(56px, 1fr))` }}
        onPointerDown={onGridPointerDown}
        onPointerMove={onGridPointerMove}
        onPointerUp={onGridPointerUp}
        onPointerCancel={onGridPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        <div className="mgh" />
        {poll.dates.map((d) => (
          <div key={d} className="mgh">{dateHead(d)}</div>
        ))}
        {times.map((t) => (
          <Fragment key={t}>
            <div className="mgt">{t}</div>
            {poll.dates.map((d) => {
              const key = slotKey(d, t);
              const names = map.get(key) ?? [];
              return (
                <div
                  key={key}
                  data-key={key}
                  className={`mslot${mine.has(key) ? ' mine' : ''}${locked ? ' locked' : ''}`}
                  style={{ background: heatColor(names.length, total) }}
                  title={names.length ? names.join(', ') : ''}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      </div>

      <div className="meetinfo hint">
        {hover
          ? `${slotLabel(hover)} · ${hoverNames.length}/${total}${hoverNames.length ? ` — ${hoverNames.join(', ')}` : ''}`
          : '칸을 누르거나 마우스를 올리면 가능한 사람이 보여요'}
      </div>

      {owned && (
        <div className="meetbest">
          <b>겹치는 시간 (주최자만 보임)</b>
          {ranked.length === 0 && <p className="hint">아직 응답이 없어요.</p>}
          {ranked.map((s) => (
            <div key={s.key} className="meetrow">
              <span>{slotLabel(s.key)}</span>
              <span className="hint">{s.count}/{total} — {s.names.join(', ')}</span>
              <div className="spacer" />
              {!locked && (
                <button
                  className="btn primary"
                  disabled={confirm.isPending}
                  onClick={() =>
                    void confirm
                      .mutateAsync({
                        pollId: owned.id,
                        title: poll.title,
                        slotKey: s.key,
                        slotMinutes: poll.slotMinutes,
                      })
                      .catch(() => {}) /* 실패는 토스트로 — unhandled rejection 방지 */
                  }
                >
                  이 시간으로 확정
                </button>
              )}
            </div>
          ))}
          {confirm.error && <span className="hint danger">확정 실패 — 다시 시도해 주세요</span>}
          <a className="hint" href="/">← 내 캘린더로</a>
        </div>
      )}
    </div>
  );
}

/** 응답 수에 비례한 강조 — 0명이면 빈 칸 */
function heatColor(count: number, total: number): string {
  if (count === 0 || total === 0) return 'var(--surface)';
  const pct = Math.round(18 + (62 * count) / total);
  return `color-mix(in srgb, var(--accent) ${pct}%, var(--surface))`;
}

function dateHead(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][
    new Date(`${date}T00:00:00Z`).getUTCDay()
  ];
  return `${m}/${d} (${weekday})`;
}

// ── 주최자 패널 (로그인 상태의 메인 화면) ───────────────

export function MeetPanel({ onClose }: { onClose: () => void }) {
  const { data: polls } = useMyPolls(true);
  const create = useCreatePoll();
  const remove = useDeletePoll();
  const [title, setTitle] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [dateInput, setDateInput] = useState('');
  const [timeStart, setTimeStart] = useState('09:00');
  const [timeEnd, setTimeEnd] = useState('22:00');
  const [copied, setCopied] = useState<string | null>(null);

  const addDate = () => {
    if (!dateInput || dates.includes(dateInput)) return;
    setDates([...dates, dateInput].sort());
    setDateInput('');
  };
  const canCreate =
    title.trim().length > 0 && dates.length > 0 && timeEnd > timeStart && !create.isPending;

  const doCreate = async () => {
    try {
      await create.mutateAsync({ title: title.trim(), dates, timeStart, timeEnd });
    } catch {
      return; // 입력을 지우지 않는다 — 토스트가 실패를 알린다
    }
    setTitle('');
    setDates([]);
  };

  const copy = async (token: string) => {
    await navigator.clipboard.writeText(meetShareUrl(token));
    setCopied(token);
  };

  return (
    <div className="panel">
      <b>약속 잡기</b>
      <label>
        제목
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="팀플 시간" />
      </label>
      <label>
        후보 날짜
        <div className="row">
          <input type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} />
          <button className="btn" onClick={addDate}>추가</button>
        </div>
      </label>
      {dates.length > 0 && (
        <div className="datechips">
          {dates.map((d) => (
            <button key={d} className="chip" onClick={() => setDates(dates.filter((x) => x !== d))}>
              {dateHead(d)} ✕
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <label>
          시작
          <select value={timeStart} onChange={(e) => setTimeStart(e.target.value)}>
            {HOURS.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </label>
        <label>
          종료
          <select value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)}>
            {HOURS.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </label>
      </div>
      <button className="btn primary" disabled={!canCreate} onClick={() => void doCreate()}>
        약속 만들기
      </button>
      {create.error && <span className="hint danger">생성 실패 — 다시 시도해 주세요</span>}

      <b>내 약속</b>
      {(polls ?? []).length === 0 && <span className="hint">아직 만든 약속이 없어요.</span>}
      {(polls ?? []).map((p) => (
        <div key={p.id} className="pollitem">
          <a href={`#/meet/${p.share_token}`}>{p.title}</a>
          <span className="hint">
            {p.dates.length}일 · {p.time_start.slice(0, 5)}–{p.time_end.slice(0, 5)}
            {p.confirmed_start
              ? ` · 확정 ${formatInTimeZone(new Date(p.confirmed_start), TZ, 'M/d HH:mm')}`
              : ''}
          </span>
          <div className="row">
            <button className="btn" onClick={() => void copy(p.share_token)}>
              {copied === p.share_token ? '복사됨' : '링크 복사'}
            </button>
            <button
              className="btn"
              style={{ color: 'var(--danger)' }}
              onClick={() => void remove.mutateAsync(p.id).catch(() => {})}
            >
              삭제
            </button>
          </div>
        </div>
      ))}
      <button className="btn" onClick={onClose}>닫기</button>
    </div>
  );
}
