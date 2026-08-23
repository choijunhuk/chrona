import { defineConfig } from 'vitest/config';
import * as path from 'path';

// 순수 TS(domain/data 매퍼)만 테스트한다. RN 컴포넌트 테스트는 하지 않음 — jest-expo 불필요.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
