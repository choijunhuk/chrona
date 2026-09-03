/**
 * 알람음 네이티브 브릿지 (ChronaAlarmSoundModule.kt).
 *
 * 알람은 USAGE_ALARM 스트림에서만 진동/무음 모드를 뚫는다 — expo-audio(USAGE_MEDIA)와
 * 알림 채널 사운드(USAGE_NOTIFICATION)로는 무음 모드에서 알람이 통째로 묵음이 된다.
 *
 * 모듈이 없는 빌드(구 dev client)에서도 앱이 죽지 않게 조용히 no-op 하고 1회만 경고한다.
 */
import { NativeModules } from 'react-native';

export type SystemSound = { title: string; uri: string };

type AlarmSoundNative = {
  play(source: string, loop: boolean, rampSeconds: number, volumePercent: number): Promise<boolean>;
  stop(): Promise<boolean>;
  preview(source: string): Promise<boolean>;
  listSystemAlarmSounds(): Promise<SystemSound[]>;
  isPlaying(): Promise<boolean>;
};

const native = NativeModules.ChronaAlarmSound as Partial<AlarmSoundNative> | undefined;

let warned = false;

function warnMissing(): void {
  if (warned) return;
  warned = true;
  console.warn('[chrona] ChronaAlarmSound 네이티브 모듈 없음 — 알람음 재생을 건너뜁니다.');
}

/** 시스템 벨소리 URI 여부 — 채널/리소스 매핑에서 번들 사운드와 갈라진다 */
export function isSystemSoundUri(key: string | undefined): boolean {
  return !!key && (key.startsWith('content://') || key.startsWith('file://'));
}

/**
 * 알람 재생. source: 'default' | 'alarm_01'..'alarm_04' | content:// | file://
 * rampSeconds>0 이면 0에서 목표 볼륨까지 선형 증가.
 */
export async function playSound(
  source: string,
  opts?: { loop?: boolean; rampSeconds?: number; volumePercent?: number }
): Promise<boolean> {
  if (!native?.play) {
    warnMissing();
    return false;
  }
  try {
    await native.play(
      source,
      opts?.loop ?? true,
      Math.max(0, Math.round(opts?.rampSeconds ?? 0)),
      Math.min(100, Math.max(0, Math.round(opts?.volumePercent ?? 100)))
    );
    return true;
  } catch (e) {
    console.warn('[chrona] alarm sound play failed:', e);
    return false;
  }
}

/** 본재생·미리듣기 모두 정지 + 볼륨/포커스/웨이크락 원복 */
export async function stopSound(): Promise<boolean> {
  if (!native?.stop) {
    warnMissing();
    return false;
  }
  try {
    await native.stop();
    return true;
  } catch (e) {
    console.warn('[chrona] alarm sound stop failed:', e);
    return false;
  }
}

/** 피커용 3초 미리듣기 (볼륨 강제·포커스 독점 없음) */
export async function previewSound(source: string): Promise<boolean> {
  if (!native?.preview) {
    warnMissing();
    return false;
  }
  try {
    await native.preview(source);
    return true;
  } catch (e) {
    console.warn('[chrona] alarm sound preview failed:', e);
    return false;
  }
}

/** 기기 알람 벨소리 목록 (최대 30건). 모듈/조회 실패 시 빈 배열 */
export async function listSystemAlarmSounds(): Promise<SystemSound[]> {
  if (!native?.listSystemAlarmSounds) {
    warnMissing();
    return [];
  }
  try {
    const list = await native.listSystemAlarmSounds();
    return Array.isArray(list) ? list.filter((s) => !!s?.uri && !!s?.title) : [];
  } catch {
    return [];
  }
}

export async function isSoundPlaying(): Promise<boolean> {
  if (!native?.isPlaying) return false;
  try {
    return await native.isPlaying();
  } catch {
    return false;
  }
}
