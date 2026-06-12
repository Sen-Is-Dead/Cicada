import type { DictionaryRule } from '../db/db';

/**
 * Translation Fixer pipeline (spec §5): every string is passed through the
 * active DictionaryRule regexes before reaching SpeechSynthesisUtterance.
 * Rules are compiled once per session start, not per paragraph.
 */

export interface CompiledRule {
  regex: RegExp;
  replacement: string;
}

export function compileRules(rules: DictionaryRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    if (!rule.isActive) continue;
    try {
      compiled.push({ regex: new RegExp(rule.regex, 'g'), replacement: rule.replacement });
    } catch {
      // Invalid user regex — skip rather than break playback
    }
  }
  return compiled;
}

export function applyFixes(text: string, rules: CompiledRule[]): string {
  let out = text;
  for (const rule of rules) {
    out = out.replace(rule.regex, rule.replacement);
  }
  return out;
}
