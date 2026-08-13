import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      shared: path.resolve(__dirname, '../shared'),
    },
  },
  // 'three' and 'three/webgpu' both import the same underlying three.core.js,
  // so Rollup naturally dedupes them in production. In dev, esbuild's dep
  // pre-bundling doesn't share across separate entries and copies Object3D/
  // Mesh/etc. twice -- WebGPURenderer then fails to recognize anything r3f
  // creates from plain 'three'. Excluding both from pre-bundling avoids that.
  optimizeDeps: {
    exclude: ['three', 'three/webgpu'],
  },
  server: {
    port: 3000,
  },
});
