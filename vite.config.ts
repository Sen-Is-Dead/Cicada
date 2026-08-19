import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // silent.mp3 (TTS lock-screen hack, Phase 4) must be precached for offline use
      includeAssets: ['silent.mp3', 'favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Cicada — Web Novel Reader',
        short_name: 'Cicada',
        description: 'Completely offline web novel reader with synchronized TTS',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            // Full-bleed variant — the OS applies its own mask/rounding
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell must be fully precached — Cicada has no network fallback
        globPatterns: ['**/*.{js,css,html,svg,png,ico,mp3,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
});
