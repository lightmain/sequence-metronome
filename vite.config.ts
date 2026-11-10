import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        minifyInternalExports: false,
        manualChunks: (id: string) =>
          id.includes('@breezystack/lamejs') ? 'mp3-encoder' : undefined,
      },
    },
  },
});
