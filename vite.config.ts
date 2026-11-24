import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The map (React Flow) is built into a single script + css that prpeer serves from web/dist (npm run build).
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'web/dist',
    emptyOutDir: true,
    lib: { entry: 'web/map/main.tsx', name: 'PRPeerIsland', formats: ['iife'], fileName: () => 'map.js', cssFileName: 'map' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
