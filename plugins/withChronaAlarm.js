/**
 * Chrona config plugin — AndroidManifest에 알람 관련 권한과 MainActivity 속성을 주입한다.
 * (마스터 §3.4, Stage 0 §1-3)
 *
 * - 권한 8종 (전체화면 알람 + 정확 알람 + 부팅 복구 + 포그라운드 서비스)
 * - MainActivity: showWhenLocked / turnScreenOn / launchMode=singleTask
 *   → 이 둘이 없으면 잠금화면 위로 알람이 뜨지 않는다.
 * - assets/sounds/alarm_NN.(wav|mp3) → android/app/src/main/res/raw/ 복사 (파일 없으면 skip)
 *   네이밍 규칙: alarm_01 ~ alarm_04 (soundKey와 1:1 대응, 무음은 파일 없이 진동만)
 *   res/raw 리소스 이름 = 확장자를 뺀 파일명 → 알림 채널의 sound 값과 그대로 일치한다.
 *
 * 주의: expo config 로더가 로컬 .ts 플러그인을 해석하지 못하므로 이 파일만 JS로 둔다.
 */
const {
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PERMISSIONS = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.WAKE_LOCK',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.VIBRATE',
];

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withAlarmManifest = (config) =>
  withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;

    AndroidConfig.Permissions.ensurePermissions(manifest, PERMISSIONS);

    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    mainActivity.$['android:showWhenLocked'] = 'true';
    mainActivity.$['android:turnScreenOn'] = 'true';
    mainActivity.$['android:launchMode'] = 'singleTask';

    return mod;
  });

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withAlarmSounds = (config) =>
  withDangerousMod(config, [
    'android',
    (mod) => {
      const soundsDir = path.join(mod.modRequest.projectRoot, 'assets', 'sounds');
      const rawDir = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'raw'
      );
      if (fs.existsSync(soundsDir)) {
        const files = fs.readdirSync(soundsDir).filter((f) => /^alarm_\d{2}\.(wav|mp3)$/.test(f));
        if (files.length > 0) {
          fs.mkdirSync(rawDir, { recursive: true });
          for (const f of files) {
            fs.copyFileSync(path.join(soundsDir, f), path.join(rawDir, f));
          }
        }
      }
      return mod;
    },
  ]);

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withChronaAlarm = (config) => {
  config = withAlarmManifest(config);
  config = withAlarmSounds(config);
  return config;
};

module.exports = withChronaAlarm;
