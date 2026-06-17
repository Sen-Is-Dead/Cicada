# Cicada 

Cicada is a high-performance, 100% offline Progressive Web App (PWA) designed specifically for ingesting, storing, and reading massive web novels and mega-EPUBs. Built with a zero-cost, client-side architecture, Cicada bypasses the app stores entirely while delivering a premium, app-like reading and listening experience.

## 🚀 Core Features

* **100% Offline-First Architecture:** Automatically caches the application shell and utilizes IndexedDB (via Dexie.js) to store hundreds of megabytes of chapter text locally on your device with zero network dependency.
* **Synchronized Audio Engine:** Powered by the Web Speech API (`window.speechSynthesis`) to provide text-to-speech that dynamically highlights the active paragraph, fully integrated with the native OS MediaSession API for lock-screen controls.
* **Client-Side Ingestion:** Native, non-blocking EPUB parsing handled entirely in the browser—no backend servers, no cloud costs.
* **Advanced Reader Utilities:** Features a persistent text selection engine for multi-paragraph lore notes, an active translation regex fixer dictionary, and precise viewport-driven progress tracking.

## 🛠️ Tech Stack

* **Frontend:** React 18 + TypeScript + Vite
* **PWA Caching:** `vite-plugin-pwa` (Workbox Service Worker)
* **Local Database:** Dexie.js (IndexedDB wrapper)
* **State Management:** Zustand
* **Styling:** TailwindCSS
