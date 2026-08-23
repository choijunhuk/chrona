import type { ExpoConfig } from 'expo/config';

import withChronaAlarm from './plugins/withChronaAlarm';

const config: ExpoConfig = {
  name: 'Chrona',
  slug: 'chrona',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'chrona',
  userInterfaceStyle: 'dark',
  android: {
    package: 'com.choi.chrona',
    adaptiveIcon: {
      backgroundColor: '#0E0F13',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0E0F13',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
};

// config plugin은 (config) => config 함수 — 직접 적용한다
export default withChronaAlarm(config);
