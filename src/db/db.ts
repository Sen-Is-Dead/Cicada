import Dexie, { Table } from 'dexie';

export interface Novel {
  id: string; // UUID
  title: string;
  author: string;
  coverImage?: Blob; // Stored as Blob for offline use
  totalChapters: number;
  addedAt: number;
  // Non-indexed extras (no schema version bump required — Dexie only indexes
  // the fields declared in .stores(); whole objects are stored regardless)
  description?: string; // From EPUB metadata, or user-edited
  rating?: number; // 1–5 user rating
  chapterTitles?: string[]; // Denormalized TOC for instant chapter lists
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
  /** Selection range — both indices inclusive, within chapterIndex. */
  startParagraphIndex: number;
  endParagraphIndex: number;
  /** Raw snapshot of the selected passage (selection.toString()). */
  selectedText: string;
  /** Optional user annotation ('' when the selection was saved directly). */
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
      dictionary: 'id, novelId',
    });
  }
}

export const db = new CicadaDB();
