import {
  db,
  type Novel,
  type Chapter,
  type ReadingProgress,
  type Note,
  type DictionaryRule,
} from '../db/db';
import { yieldToMain } from './utils';

/**
 * Phase 5: manual JSON backup. Everything in IndexedDB is serialized to a
 * single portable file (covers become base64) and can be restored on any
 * device — entirely client-side, no server involved.
 */

interface SerializedCover {
  type: string;
  data: string; // base64
}

type BackupNovel = Omit<Novel, 'coverImage'> & { coverImage?: SerializedCover };

export interface CicadaBackup {
  app: 'cicada';
  version: 1;
  exportedAt: number;
  novels: BackupNovel[];
  chapters: Chapter[];
  progress: ReadingProgress[];
  notes: Note[];
  dictionary: DictionaryRule[];
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function exportBackup(): Promise<Blob> {
  const [novels, chapters, progress, notes, dictionary] = await Promise.all([
    db.novels.toArray(),
    db.chapters.toArray(),
    db.progress.toArray(),
    db.notes.toArray(),
    db.dictionary.toArray(),
  ]);

  const serializedNovels: BackupNovel[] = [];
  for (const novel of novels) {
    const { coverImage, ...rest } = novel;
    serializedNovels.push(
      coverImage
        ? { ...rest, coverImage: { type: coverImage.type, data: await blobToBase64(coverImage) } }
        : rest,
    );
  }

  const backup: CicadaBackup = {
    app: 'cicada',
    version: 1,
    exportedAt: Date.now(),
    novels: serializedNovels,
    chapters,
    progress,
    notes,
    dictionary,
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

export async function importBackup(file: File): Promise<{ novels: number; chapters: number }> {
  const data = JSON.parse(await file.text()) as Partial<CicadaBackup>;
  if (data.app !== 'cicada' || !Array.isArray(data.novels)) {
    throw new Error('Not a Cicada backup file');
  }

  const novels: Novel[] = data.novels.map((n) => {
    const { coverImage, ...rest } = n;
    return coverImage
      ? { ...rest, coverImage: base64ToBlob(coverImage.data, coverImage.type) }
      : rest;
  });
  await db.novels.bulkPut(novels);

  // Chapters can be enormous — insert in batches and yield so the UI thread
  // never blocks (spec non-negotiable)
  const chapters = data.chapters ?? [];
  const CHUNK = 200;
  for (let i = 0; i < chapters.length; i += CHUNK) {
    await db.chapters.bulkPut(chapters.slice(i, i + CHUNK));
    await yieldToMain();
  }

  if (data.progress?.length) await db.progress.bulkPut(data.progress);
  if (data.notes?.length) await db.notes.bulkPut(data.notes);
  if (data.dictionary?.length) await db.dictionary.bulkPut(data.dictionary);

  return { novels: novels.length, chapters: chapters.length };
}
