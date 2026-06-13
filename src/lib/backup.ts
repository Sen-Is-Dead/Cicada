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
 *
 * Rec 5: exportBackup and exportNovelBackup build the JSON incrementally as
 * string parts (novel-by-novel, chapter-by-chunk) then concatenate with
 * new Blob(parts) so the entire library never has to exist in memory at once.
 */

interface SerializedCover {
  type: string;
  data: string; // base64
}

type BackupNovel = Omit<Novel, 'coverImage'> & { coverImage?: SerializedCover };

// CicadaBackup is kept as the canonical type (used by importBackup)
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

/** Serialize a Novel record (converts the cover Blob to base64). */
async function serializeNovel(novel: Novel): Promise<BackupNovel> {
  const { coverImage, ...rest } = novel;
  if (!coverImage) return rest;
  return { ...rest, coverImage: { type: coverImage.type, data: await blobToBase64(coverImage) } };
}

const CHAPTER_CHUNK = 200;

/**
 * Export the full library as a streaming Blob.
 * JSON is built part-by-part (never one giant string) to avoid OOM on large
 * libraries. The browser concatenates the parts when constructing the Blob.
 */
export async function exportBackup(): Promise<Blob> {
  const parts: string[] = [];

  parts.push(`{"app":"cicada","version":1,"exportedAt":${Date.now()},"novels":[`);

  const novels = await db.novels.toArray();
  for (let i = 0; i < novels.length; i++) {
    const s = await serializeNovel(novels[i]);
    parts.push((i > 0 ? ',' : '') + JSON.stringify(s));
    await yieldToMain();
  }

  parts.push(`],"chapters":[`);

  // Stream chapters in fixed-size chunks so a 10k-chapter library doesn't OOM
  let firstChapter = true;
  let offset = 0;
  for (;;) {
    const batch = await db.chapters.offset(offset).limit(CHAPTER_CHUNK).toArray();
    if (batch.length === 0) break;
    const chunk = batch.map((ch, j) => (firstChapter && j === 0 ? '' : ',') + JSON.stringify(ch)).join('');
    parts.push(chunk);
    firstChapter = false;
    offset += batch.length;
    await yieldToMain();
    if (batch.length < CHAPTER_CHUNK) break;
  }

  const [progress, notes, dictionary] = await Promise.all([
    db.progress.toArray(),
    db.notes.toArray(),
    db.dictionary.toArray(),
  ]);

  parts.push(`],"progress":[${progress.map((p) => JSON.stringify(p)).join(',')}]`);
  parts.push(`,"notes":[${notes.map((n) => JSON.stringify(n)).join(',')}]`);
  parts.push(`,"dictionary":[${dictionary.map((d) => JSON.stringify(d)).join(',')}]}`);

  return new Blob(parts, { type: 'application/json' });
}

/**
 * Export a single novel as a self-contained backup Blob.
 * Uses the same format as exportBackup so importBackup can restore it.
 */
export async function exportNovelBackup(novelId: string): Promise<Blob> {
  const novel = await db.novels.get(novelId);
  if (!novel) throw new Error('Book not found');

  const parts: string[] = [];
  const serialized = await serializeNovel(novel);
  parts.push(
    `{"app":"cicada","version":1,"exportedAt":${Date.now()},"novels":[${JSON.stringify(serialized)}],"chapters":[`,
  );

  // Only chapters for this novel
  const chapters = await db.chapters.where('novelId').equals(novelId).sortBy('chapterIndex');
  let firstChapter = true;
  for (let i = 0; i < chapters.length; i += CHAPTER_CHUNK) {
    const batch = chapters.slice(i, i + CHAPTER_CHUNK);
    const chunk = batch
      .map((ch, j) => (firstChapter && j === 0 ? '' : ',') + JSON.stringify(ch))
      .join('');
    parts.push(chunk);
    firstChapter = false;
    await yieldToMain();
  }

  const [progress, notes, dictionary] = await Promise.all([
    db.progress.get(novelId),
    db.notes.where('novelId').equals(novelId).toArray(),
    db.dictionary.where('novelId').equals(novelId).toArray(),
  ]);

  parts.push(`],"progress":${progress ? `[${JSON.stringify(progress)}]` : '[]'}`);
  parts.push(`,"notes":[${notes.map((n) => JSON.stringify(n)).join(',')}]`);
  parts.push(`,"dictionary":[${dictionary.map((d) => JSON.stringify(d)).join(',')}]}`);

  return new Blob(parts, { type: 'application/json' });
}

function isQuotaError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'QuotaExceededError') ||
    (err instanceof Error && err.name === 'QuotaExceededError')
  );
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

  try {
    await db.novels.bulkPut(novels);

    // Chapters can be enormous — insert in batches and yield so the UI thread
    // never blocks (spec non-negotiable)
    const chapters = data.chapters ?? [];
    for (let i = 0; i < chapters.length; i += CHAPTER_CHUNK) {
      await db.chapters.bulkPut(chapters.slice(i, i + CHAPTER_CHUNK));
      await yieldToMain();
    }

    if (data.progress?.length) await db.progress.bulkPut(data.progress);
    if (data.notes?.length) await db.notes.bulkPut(data.notes);
    if (data.dictionary?.length) await db.dictionary.bulkPut(data.dictionary);
  } catch (err) {
    throw new Error(
      isQuotaError(err)
        ? 'Storage full — free up space or delete a book before restoring'
        : err instanceof Error
          ? err.message
          : 'Restore failed',
    );
  }

  // Request persistent storage after a successful restore — same as after import
  void navigator.storage?.persist?.();

  return { novels: novels.length, chapters: data.chapters?.length ?? 0 };
}
