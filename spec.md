# Product Specification: Cicada (Web Novel Offline Reader PWA)

## 1. Project Overview & Tech Stack
Cicada is a completely offline, client-side Progressive Web App (PWA) designed for ingesting, storing, and rendering massive EPUB/text files with a tightly synchronized Text-to-Speech (TTS) engine. 

**Core Stack:**
* **Framework:** React 18 + TypeScript + Vite.
* **PWA Plugin:** `vite-plugin-pwa` (Workbox for Service Worker caching).
* **Routing:** `react-router-dom` v6.
* **State Management:** `zustand` (crucial for decoupled TTS state and UI sync).
* **Local Database:** `dexie` (IndexedDB wrapper).
* **Parsing:** `epubjs` (for TOC and spine extraction) or fallback to `jszip` + native DOM parser for raw HTML parsing.
* **Styling:** `tailwindcss` (Utility-first, heavily utilizing CSS variables for theme toggling).
* **Icons:** `lucide-react`.

## 2. Dependencies (`package.json`)
The AI agent must install these exact packages before beginning development:

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "zustand": "^4.5.0",
    "dexie": "^3.2.4",
    "dexie-react-hooks": "^1.1.7",
    "epubjs": "^0.3.93",
    "tailwindcss": "^3.4.1",
    "lucide-react": "^0.344.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.1"
  },
  "devDependencies": {
    "@types/react": "^18.2.55",
    "@types/react-dom": "^18.2.19",
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.2.2",
    "vite": "^5.1.0",
    "vite-plugin-pwa": "^0.19.0",
    "autoprefixer": "^10.4.17",
    "postcss": "^8.4.35"
  }
}

## 3. Directory & File Structure

src/
├── assets/             # Static assets, manifest icons, silent.mp3 (crucial for TTS)
├── components/
│   ├── layout/         # TopBar, BottomNav, PWAInstallPrompt
│   ├── library/        # BookGrid, BookCard, ImportModal
│   ├── reader/         # ReaderViewport, Pagination, TTSHighlighter
│   └── controls/       # TTSControls, TypographySliders, ThemeToggle
├── db/
│   └── db.ts           # Dexie initialization and schema definition
├── hooks/
│   ├── useTTS.ts       # Web Speech API & MediaSession hook
│   ├── useEpub.ts      # Client-side ingestion and chunking logic
│   └── useStats.ts     # WPM, ETA, and series pacing calculations
├── lib/
│   ├── utils.ts        # Tailwind merge, generic helpers
│   └── textFixer.ts    # Regex engine for the Translation Fixer
├── store/
│   ├── readerStore.ts  # Zustand: UI state (font size, theme, current paragraph)
│   └── ttsStore.ts     # Zustand: Audio state (playing, rate, pitch, voice)
├── App.tsx
├── main.tsx
└── vite-env.d.ts

## 4. Database Schema (`src/db/db.ts`)

To keep the UI thread responsive during client-side EPUB parsing, chunk the DOM extraction into asynchronous batches—approaching this much like a batch cross-calculation for large datasets, ensuring the event loop isn't blocked.

import Dexie, { Table } from 'dexie';

export interface Novel {
  id: string; // UUID
  title: string;
  author: string;
  coverImage?: Blob; // Stored as Blob for offline use
  totalChapters: number;
  addedAt: number;
}

export interface Chapter {
  id: string; // `${novelId}_${chapterIndex}`
  novelId: string;
  chapterIndex: number;
  title: string;
  paragraphs: string[]; // Array of strings for 1:1 TTS mapping
}

export interface ReadingProgress {
  novelId: string;
  currentChapterIndex: number;
  currentParagraphIndex: number;
  readingSpeedWPM: number; // For ETA calculations
  lastReadAt: number;
}

export interface Note {
  id: string;
  novelId: string;
  chapterIndex: number;
  paragraphIndex: number;
  text: string;
  timestamp: number;
}

export interface DictionaryRule {
  id: string;
  novelId: string; // Can be 'global' or specific UUID
  regex: string; // e.g., "\\bBeyonder\\b" or "\\bGu worm\\b"
  replacement: string;
  isActive: boolean;
}

export class CicadaDB extends Dexie {
  novels!: Table<Novel>;
  chapters!: Table<Chapter>;
  progress!: Table<ReadingProgress>;
  notes!: Table<Note>;
  dictionary!: Table<DictionaryRule>;

  constructor() {
    super('CicadaDB');
    this.version(1).stores({
      novels: 'id, title, addedAt',
      chapters: 'id, novelId, [novelId+chapterIndex]', 
      progress: 'novelId, lastReadAt',
      notes: 'id, novelId, [novelId+chapterIndex]',
      dictionary: 'id, novelId'
    });
  }
}

export const db = new CicadaDB();

## 5. Architectural State Machine: TTS & MediaSession Loop
CRITICAL INSTRUCTION FOR AI AGENT: The window.speechSynthesis API drops out on mobile lock screens. You MUST implement the "Silent Audio Hack" coupled with the MediaSession API.

The Dummy Audio: Create a 1-second silent MP3 (silent.mp3) and loop it in a hidden HTML <audio> tag whenever TTS is active.

MediaSession Binding: Bind navigator.mediaSession.setActionHandler ('play', 'pause', 'nexttrack', 'previoustrack') to the <audio> tag's state.

The Event Bridge: When the user presses "Pause" on their lock screen, it pauses the silent audio. An event listener on the <audio> tag catches this onPause event and immediately calls window.speechSynthesis.pause().

Smart Pacing: Between paragraphs[currentParagraphIndex] and paragraphs[currentParagraphIndex + 1], wrap the utterance generation in a setTimeout. If the previous paragraph ended with " or !, inject a 600ms delay before firing the next utterance.

Translation Fixer Pipeline: Before passing a string to SpeechSynthesisUtterance, pass it through textFixer.ts using the active DictionaryRule arrays pulled from Dexie.

## 6. Component Build Checklist
The AI Agent must execute the build strictly in this sequence:

Phase 1: Foundation & Data Layer

Initialize Vite + React + PWA Plugin.

Setup Tailwind and generic layout (viewport constraints to prevent mobile overscroll).

Implement db.ts (Dexie) and verify local IndexedDB read/writes.

Phase 2: Ingestion Engine

Build useEpub.ts. Create the drag-and-drop / file input UI.

Implement the parsing loop: Extract TOC -> Read Spine -> Parse HTML to text -> Chunk by <p> tags -> Batch insert into db.chapters.

Phase 3: The Reader & UI

Build ReaderViewport. Implement virtualization or a sliding window rendering approach if chapters are massive.

Implement Zustand readerStore.

Build the Typography UI (Sliders for font size, line-height, Themes).

Phase 4: The Audio Engine

Implement the silent.mp3 hack and MediaSession API hook.

Build useTTS.ts utilizing SpeechSynthesis.

Sync onboundary or onend events from the utterance to update currentParagraphIndex in readerStore.

Highlight the active paragraph via conditional CSS classes in ReaderViewport.

Phase 5: Tools & Polish

Implement Long-press to save to db.notes.

Implement Translation Fixer regex engine.

Build the JSON export/import function for manual state backup.