import react from '@vitejs/plugin-react';
import * as path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@chrona/domain': path.resolve(__dirname, '../packages/domain/src'),
      // 앱과 같은 domain을 같은 별칭으로 — 매퍼 재사용
      '@/domain': path.resolve(__dirname, '../packages/domain/src'),
      '@app-data': path.resolve(__dirname, '../src/data'),
    },
  },
});
