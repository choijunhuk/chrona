/**
 * 위젯 config plugin (stage-9 §1-1 전략 A).
 * native/android/ 의 코틀린·리소스를 prebuild 산출물에 복사하고
 * 매니페스트 리시버/서비스 + MainApplication 패키지 등록을 주입한다.
 * android/ 를 직접 편집하지 않는다 — prebuild 재실행에도 살아남는다 (검증 11).
 */
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PKG_DIR = 'com/choi/chrona/widget';

const withWidgetFiles = (config) =>
  withDangerousMod(config, [
    'android',
    (mod) => {
      const src = path.join(mod.modRequest.projectRoot, 'native', 'android');
      const main = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main');

      // Kotlin
      const javaDst = path.join(main, 'java', PKG_DIR);
      fs.mkdirSync(javaDst, { recursive: true });
      for (const f of fs.readdirSync(path.join(src, 'java'))) {
        fs.copyFileSync(path.join(src, 'java', f), path.join(javaDst, f));
      }
      // 리소스 (layout/xml/values/values-night)
      for (const dir of ['layout', 'xml', 'values', 'values-night']) {
        const from = path.join(src, 'res', dir);
        if (!fs.existsSync(from)) continue;
        const to = path.join(main, 'res', dir);
        fs.mkdirSync(to, { recursive: true });
        for (const f of fs.readdirSync(from)) {
          fs.copyFileSync(path.join(from, f), path.join(to, f));
        }
      }
      return mod;
    },
  ]);

const withWidgetManifest = (config) =>
  withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) return mod;
    app.receiver = app.receiver ?? [];
    app.service = app.service ?? [];

    const receivers = [
      ['.widget.ChronaWidgetProvider', 'widget_list_info'],
      ['.widget.ChronaCompactProvider', 'widget_compact_info'],
    ];
    for (const [name, info] of receivers) {
      if (app.receiver.some((r) => r.$['android:name'] === name)) continue;
      app.receiver.push({
        $: { 'android:name': name, 'android:exported': 'true' },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': `@xml/${info}`,
            },
          },
        ],
      });
    }
    if (!app.service.some((s) => s.$['android:name'] === '.widget.ChronaWidgetService')) {
      app.service.push({
        $: {
          'android:name': '.widget.ChronaWidgetService',
          'android:permission': 'android.permission.BIND_REMOTEVIEWS',
          'android:exported': 'false',
        },
      });
    }
    return mod;
  });

const withWidgetPackage = (config) =>
  withMainApplication(config, (mod) => {
    let src = mod.modResults.contents;
    if (!src.includes('ChronaWidgetPackage')) {
      // SDK 57 템플릿: PackageList(this).packages.apply { ... }
      src = src.replace(
        /PackageList\(this\)\.packages\.apply \{/,
        `PackageList(this).packages.apply {\n          add(com.choi.chrona.widget.ChronaWidgetPackage())`
      );
      mod.modResults.contents = src;
    }
    return mod;
  });

module.exports = (config) => {
  config = withWidgetFiles(config);
  config = withWidgetManifest(config);
  config = withWidgetPackage(config);
  return config;
};
