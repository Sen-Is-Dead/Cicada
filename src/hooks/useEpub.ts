import { useCallback, useState } from 'react';
import ePub from 'epubjs';
import { db, Chapter, Novel } from '../db/db';
import { uuid, yieldToMain } from '../lib/utils';

/**
 * Phase 2 ingestion engine (spec §6):
 * Extract TOC -> Read Spine -> Parse HTML to text -> Chunk by <p> tags ->
 * Batch insert into db.chapters.
 *
 * Supports multi-file imports: several files (sorted by filename) are merged
 * into ONE novel with continuous chapter indexes, and files can also be
 * appended to an existing novel. Parsing yields to the event loop between
 * sections and inserts are batched, so the UI thread never blocks.
 */

export type IngestPhase = 'idle' | 'opening' | 'parsing' | 'storing' | 'done' | 'error';

export type ImportTarget = { mode: 'new' } | { mode: 'append'; novelId: string };

export interface IngestStatus {
  phase: IngestPhase;
  /** Current file name while working; final novel title when done. */
  label: string;
  fileIndex: number; // 1-based; 0 when idle/error
  totalFiles: number;
  /** Chapter progress within the current file (totalChapters 0 = indeterminate). */
  processedChapters: number;
  totalChapters: number;
  /** Set on phase 'done': chapters added this run / total chapters in the book. */
  addedChapters: number;
  bookTotalChapters: number;
  error?: string;
}

type ProgressFn = (processed: number, total: number) => void;

interface ParsedMeta {
  title?: string;
  author?: string;
  coverImage?: Blob;
  description?: string;
}

const IDLE: IngestStatus = {
  phase: 'idle',
  label: '',
  fileIndex: 0,
  totalFiles: 0,
  processedChapters: 0,
  totalChapters: 0,
  addedChapters: 0,
  bookTotalChapters: 0,
};

const CHAPTER_BATCH_SIZE = 16;
const TXT_MAX_PARAGRAPHS_PER_CHAPTER = 250;
const TXT_HEADING_RE = /^\s*(?:chapter|ch\.|book|volume|vol\.|part)\s+(?:\d+|[ivxlcdm]+)\b.*$/i;

/* ---------------------------------- helpers ---------------------------------- */

/** Minimal structural type for epubjs spine sections (its bundled typings are incomplete). */
interface SpineSection {
  href: string;
  load(request: (url: string) => Promise<unknown>): Promise<unknown>;
  unload(): void;
}

interface TocItem {
  href: string;
  label: string;
  subitems?: TocItem[];
}

function normalizeHref(href: string): string {
  return href.split('#')[0].replace(/^\.\//, '');
}

/** Chunk a section's DOM into a string[] of paragraphs (1:1 TTS mapping). */
function extractParagraphs(root: ParentNode): string[] {
  const out: string[] = [];
  root.querySelectorAll('p').forEach((p) => {
    const text = p.textContent?.replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  });
  if (out.length === 0) {
    // Fallback for EPUBs that don't wrap body text in <p> tags
    const body = root.querySelector('body') ?? (root as unknown as Element);
    for (const line of (body.textContent ?? '').split(/\n+/)) {
      const t = line.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * Heuristic: a spine section whose text is mostly links is a table-of-contents
 * or navigation page, not a chapter — skip it. (Its links already feed the
 * chapter-title map via the parsed TOC.)
 */
function isTocLike(root: ParentNode): boolean {
  const anchors = root.querySelectorAll('a[href]');
  if (anchors.length < 5 && !root.querySelector('nav')) return false;
  const body = root.querySelector('body') ?? (root as unknown as Element);
  const totalLen = (body.textContent ?? '').replace(/\s+/g, '').length;
  let linkLen = 0;
  anchors.forEach((a) => {
    linkLen += (a.textContent ?? '').replace(/\s+/g, '').length;
  });
  return totalLen > 0 && linkLen / totalLen > 0.55;
}

function sectionTitle(
  root: ParentNode,
  tocMap: Map<string, string>,
  href: string,
  fallbackIndex: number,
): string {
  const key = normalizeHref(href);
  const fromToc = tocMap.get(key) ?? tocMap.get(key.split('/').pop() ?? '');
  if (fromToc) return fromToc;
  const heading = root.querySelector('h1, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim();
  return heading || `Chapter ${fallbackIndex + 1}`;
}

/* ----------------------------------- EPUB ------------------------------------ */

async function ingestEpubFile(
  file: File,
  novelId: string,
  startIndex: number,
  onProgress: ProgressFn,
): Promise<{ count: number; meta: ParsedMeta; titles: string[] }> {
  const buffer = await file.arrayBuffer();
  const book = ePub(buffer);
  await book.ready;

  const metadata = await book.loaded.metadata;
  const rawDescription = (metadata as { description?: string }).description;
  const meta: ParsedMeta = {
    title: metadata.title?.trim() || file.name.replace(/\.epub$/i, ''),
    author: metadata.creator?.trim() || undefined,
    description: rawDescription
      ? rawDescription.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || undefined
      : undefined,
  };

  // 1. Extract TOC -> map of normalized href (and bare filename) -> chapter label
  const tocMap = new Map<string, string>();
  const nav = (await book.loaded.navigation.catch(() => null)) as { toc: TocItem[] } | null;
  if (nav?.toc) {
    const walk = (items: TocItem[]): void => {
      for (const item of items) {
        if (item.href && item.label) {
          const key = normalizeHref(item.href);
          const label = item.label.replace(/\s+/g, ' ').trim();
          tocMap.set(key, label);
          const base = key.split('/').pop();
          if (base) tocMap.set(base, label);
        }
        if (item.subitems?.length) walk(item.subitems);
      }
    };
    walk(nav.toc);
  }

  // Cover (best effort — stored as Blob for offline use)
  try {
    const coverPath = await book.loaded.cover;
    const archive = (book as unknown as { archive?: { getBlob(url: string): Promise<Blob> } })
      .archive;
    if (coverPath && archive) meta.coverImage = await archive.getBlob(coverPath);
  } catch {
    /* no cover — fine */
  }

  // 2. Read Spine
  const sections: SpineSection[] = [];
  (book.spine as unknown as { each(cb: (s: SpineSection) => void): void }).each((s) =>
    sections.push(s),
  );
  if (sections.length === 0) throw new Error(`"${file.name}" has an empty spine`);

  // 3+4. Parse HTML -> chunk by <p> -> batch insert into db.chapters
  const request = book.load.bind(book) as (url: string) => Promise<unknown>;
  const titles: string[] = [];
  let chapterIndex = startIndex;
  let batch: Chapter[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    try {
      const contents = (await section.load(request)) as ParentNode;
      // TOC/nav pages aren't chapters; empty sections (covers) are skipped too
      const paragraphs = isTocLike(contents) ? [] : extractParagraphs(contents);
      if (paragraphs.length > 0) {
        const title = sectionTitle(contents, tocMap, section.href, chapterIndex);
        batch.push({
          id: `${novelId}_${chapterIndex}`,
          novelId,
          chapterIndex,
          title,
          paragraphs,
        });
        titles.push(title);
        chapterIndex++;
      }
    } finally {
      section.unload(); // free section DOM immediately — critical for massive books
    }

    if (batch.length >= CHAPTER_BATCH_SIZE) {
      await db.chapters.bulkPut(batch);
      batch = [];
    }
    onProgress(i + 1, sections.length);
    await yieldToMain(); // keep the UI thread responsive between sections
  }
  if (batch.length > 0) await db.chapters.bulkPut(batch);

  book.destroy();
  return { count: chapterIndex - startIndex, meta, titles };
}

/* ------------------------------------ TXT ------------------------------------ */

async function ingestTxtFile(
  file: File,
  novelId: string,
  startIndex: number,
  onProgress: ProgressFn,
): Promise<{ count: number; meta: ParsedMeta; titles: string[] }> {
  const meta: ParsedMeta = { title: file.name.replace(/\.txt$/i, '') };
  const text = await file.text();
  const lines = text.split(/\r?\n/);

  // Group lines into chapters on heading markers ("Chapter 12", "Part IV", …)
  const raw: { title: string; paragraphs: string[] }[] = [];
  let current: { title: string; paragraphs: string[] } = {
    title: meta.title ?? file.name,
    paragraphs: [],
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t) {
      if (TXT_HEADING_RE.test(t)) {
        if (current.paragraphs.length > 0) raw.push(current);
        current = { title: t, paragraphs: [] };
      } else {
        current.paragraphs.push(t);
      }
    }
    if (i % 5000 === 4999) await yieldToMain(); // batched scan of huge files
  }
  if (current.paragraphs.length > 0) raw.push(current);
  if (raw.length === 0) return { count: 0, meta, titles: [] };

  // Split oversized chapters so headingless dumps stay renderable
  const chunked: { title: string; paragraphs: string[] }[] = [];
  for (const c of raw) {
    if (c.paragraphs.length <= TXT_MAX_PARAGRAPHS_PER_CHAPTER) {
      chunked.push(c);
      continue;
    }
    for (
      let i = 0, part = 1;
      i < c.paragraphs.length;
      i += TXT_MAX_PARAGRAPHS_PER_CHAPTER, part++
    ) {
      chunked.push({
        title: part === 1 ? c.title : `${c.title} (${part})`,
        paragraphs: c.paragraphs.slice(i, i + TXT_MAX_PARAGRAPHS_PER_CHAPTER),
      });
    }
  }

  // Batch insert
  for (let i = 0; i < chunked.length; i += CHAPTER_BATCH_SIZE) {
    const batch: Chapter[] = chunked.slice(i, i + CHAPTER_BATCH_SIZE).map((c, j) => ({
      id: `${novelId}_${startIndex + i + j}`,
      novelId,
      chapterIndex: startIndex + i + j,
      title: c.title,
      paragraphs: c.paragraphs,
    }));
    await db.chapters.bulkPut(batch);
    onProgress(Math.min(i + CHAPTER_BATCH_SIZE, chunked.length), chunked.length);
    await yieldToMain();
  }

  return { count: chunked.length, meta, titles: chunked.map((c) => c.title) };
}

/* ----------------------------------- hook ------------------------------------ */

export function useEpub() {
  const [status, setStatus] = useState<IngestStatus>(IDLE);

  const reset = useCallback(() => setStatus(IDLE), []);

  /**
   * Import one or more files. Multiple files are merged into a single novel
   * (sorted by filename, natural order). With target.mode === 'append',
   * chapters continue after the existing novel's last chapter.
   */
  const importFiles = useCallback(
    async (input: FileList | File[], target: ImportTarget = { mode: 'new' }): Promise<void> => {
      const files = [...input].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
      );
      if (files.length === 0) return;

      const fail = (label: string, message: string, totalFiles = files.length): void =>
        setStatus({ ...IDLE, phase: 'error', label, totalFiles, error: message });

      const bad = files.find((f) => !/\.(epub|txt)$/i.test(f.name));
      if (bad) {
        fail(bad.name, `Unsupported file type: ${bad.name} — only .epub and .txt are supported`);
        return;
      }

      let existing: Novel | undefined;
      let novelId: string;
      if (target.mode === 'append') {
        existing = await db.novels.get(target.novelId);
        if (!existing) {
          fail('', 'The selected book no longer exists');
          return;
        }
        novelId = existing.id;
      } else {
        novelId = uuid();
      }
      const baseIndex = existing?.totalChapters ?? 0;

      let added = 0;
      let meta: ParsedMeta = {};
      const allTitles: string[] = [];
      try {
        for (let f = 0; f < files.length; f++) {
          const file = files[f];
          const fileNo = f + 1;
          const base: Omit<IngestStatus, 'phase'> = {
            label: file.name,
            fileIndex: fileNo,
            totalFiles: files.length,
            processedChapters: 0,
            totalChapters: 0,
            addedChapters: 0,
            bookTotalChapters: 0,
          };
          setStatus({ ...base, phase: 'opening' });
          const onProgress: ProgressFn = (processed, total) =>
            setStatus({ ...base, phase: 'parsing', processedChapters: processed, totalChapters: total });

          const result = /\.epub$/i.test(file.name)
            ? await ingestEpubFile(file, novelId, baseIndex + added, onProgress)
            : await ingestTxtFile(file, novelId, baseIndex + added, onProgress);

          added += result.count;
          allTitles.push(...result.titles);
          meta = {
            title: meta.title ?? result.meta.title,
            author: meta.author ?? result.meta.author,
            coverImage: meta.coverImage ?? result.meta.coverImage,
            description: meta.description ?? result.meta.description,
          };
        }
        if (added === 0) throw new Error('No readable text found in the selected file(s)');

        const finalTitle = existing?.title ?? meta.title ?? files[0].name;
        const bookTotal = baseIndex + added;
        setStatus({
          phase: 'storing',
          label: finalTitle,
          fileIndex: files.length,
          totalFiles: files.length,
          processedChapters: added,
          totalChapters: added,
          addedChapters: added,
          bookTotalChapters: bookTotal,
        });

        if (existing) {
          // Append titles only if the existing list is aligned; otherwise drop
          // it so the book detail page rebuilds it from the chapters table.
          const aligned = existing.chapterTitles?.length === baseIndex;
          await db.novels.update(novelId, {
            totalChapters: bookTotal,
            chapterTitles: aligned
              ? [...(existing.chapterTitles ?? []), ...allTitles]
              : undefined,
          });
        } else {
          await db.novels.put({
            id: novelId,
            title: finalTitle,
            author: meta.author ?? 'Unknown author',
            coverImage: meta.coverImage,
            description: meta.description,
            totalChapters: added,
            addedAt: Date.now(),
            chapterTitles: allTitles,
          });
        }

        setStatus({
          phase: 'done',
          label: finalTitle,
          fileIndex: files.length,
          totalFiles: files.length,
          processedChapters: added,
          totalChapters: added,
          addedChapters: added,
          bookTotalChapters: bookTotal,
        });
      } catch (err) {
        // Roll back everything inserted in THIS run (existing chapters untouched)
        await db.chapters
          .where('[novelId+chapterIndex]')
          .between([novelId, baseIndex], [novelId, Number.MAX_SAFE_INTEGER], true, true)
          .delete()
          .catch(() => undefined);
        if (!existing) await db.novels.delete(novelId).catch(() => undefined);
        fail('', err instanceof Error ? err.message : 'Import failed');
      }
    },
    [],
  );

  return { status, importFiles, reset };
}
