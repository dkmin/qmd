/**
 * Kiwi Korean Morphological Analyzer — lazy singleton wrapper.
 *
 * Loads kiwi-nlp (WASM) on first use.
 * Degrades gracefully: if Kiwi is unavailable, tokenize functions return
 * the original text unchanged.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

// POS tags to keep: common noun, proper noun, verb, adjective, foreign
const KEEP_TAGS = new Set(["NNG", "NNP", "VV", "VA", "SL"]);

let kiwiInstance: any = null;
let kiwiAvailable: boolean | null = null; // null = not yet checked

function getModelDir(): string {
  const cacheDir = process.env.XDG_CACHE_HOME || join(process.env.HOME || "~", ".cache");
  return join(cacheDir, "qmd", "models", "kiwi", "models", "cong", "base");
}

async function initKiwiInstance(): Promise<any> {
  if (kiwiInstance) return kiwiInstance;
  if (kiwiAvailable === false) return null;

  try {
    const modelDir = getModelDir();
    if (!existsSync(modelDir)) {
      kiwiAvailable = false;
      return null;
    }

    const { KiwiBuilder } = await import("kiwi-nlp");

    // Resolve WASM path from package
    const wasmPath = require.resolve("kiwi-nlp/dist/kiwi-wasm.wasm");
    const builder = await KiwiBuilder.create(wasmPath);

    // Load model files as Buffers
    const files = readdirSync(modelDir);
    const modelFiles: Record<string, Buffer> = {};
    for (const f of files) {
      modelFiles[f] = readFileSync(join(modelDir, f));
    }

    kiwiInstance = await builder.build({ modelFiles });
    kiwiAvailable = true;
    return kiwiInstance;
  } catch (e) {
    kiwiAvailable = false;
    return null;
  }
}

/**
 * Tokenize Korean text into content morphemes (NNG, NNP, VV, VA, SL).
 * Returns space-joined morpheme string.
 * Falls back to original text if Kiwi is unavailable.
 */
export async function tokenizeKo(text: string): Promise<string> {
  if (!text || text.trim().length === 0) return "";

  const kiwi = await initKiwiInstance();
  if (!kiwi) return text;

  try {
    const result = kiwi.analyze(text);
    const tokens: string[] = [];
    for (const token of result.tokens) {
      if (KEEP_TAGS.has(token.tag)) {
        tokens.push(token.str);
      }
    }
    return tokens.length > 0 ? tokens.join(" ") : text;
  } catch {
    return text;
  }
}

/**
 * Tokenize a search query into content morphemes.
 * Returns deduplicated union of: morpheme tokens + original whitespace-split tokens.
 * This handles cases where single-word queries tokenize differently than in compounds
 * (e.g., "알림" alone → "알리"(VV), but in "알림발송" → "알림"(NNG)).
 */
export async function tokenizeQuery(query: string): Promise<string> {
  if (!query || query.trim().length === 0) return "";

  const morphemes = await tokenizeKo(query);
  const originalTokens = query.trim().split(/\s+/);
  const allTokens = new Set<string>();

  // Add morpheme analysis results
  for (const t of morphemes.split(/\s+/)) {
    if (t) allTokens.add(t);
  }
  // Add original query tokens (handles mismatched tokenization)
  for (const t of originalTokens) {
    if (t) allTokens.add(t);
  }

  return [...allTokens].join(" ");
}

/**
 * Check if Kiwi is loaded and available.
 */
export function isKiwiAvailable(): boolean {
  return kiwiAvailable === true;
}

/**
 * Dispose Kiwi instance and free resources.
 */
export async function disposeKiwi(): Promise<void> {
  if (kiwiInstance) {
    kiwiInstance = null;
    kiwiAvailable = null;
  }
}
