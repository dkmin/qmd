/**
 * Korean Search Quality Evaluation
 *
 * Tests BM25 search quality for Korean documents from aips-2mds.
 * Compares: baseline FTS (English tokenizer) vs Kiwi FTS.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import {
  createStore,
  searchFTS,
  searchFTSKo,
  insertDocument,
  insertContent,
  insertDocumentKo,
} from "../src/store";
import { disposeKiwi } from "../src/kiwi";

const AIPS_DIR = "/Users/dkmin/go/_why/aips-2mds";
const tempDir = mkdtempSync(join(tmpdir(), "qmd-eval-ko-"));
process.env.INDEX_PATH = join(tempDir, "eval-ko.sqlite");

const evalQueries: {
  query: string;
  expectedDoc: string;
  difficulty: "easy" | "medium" | "hard";
}[] = [
  // EASY: Keywords appear directly in filename/content
  { query: "WebPush FCM 비교", expectedDoc: "WebPush-FCM", difficulty: "easy" },
  { query: "알림발송 아키텍처", expectedDoc: "phAlert-알림발송", difficulty: "easy" },
  { query: "Webhook 인증 패턴", expectedDoc: "Webhook-인증패턴", difficulty: "easy" },
  { query: "Event Driven 설계", expectedDoc: "Event-Driven", difficulty: "easy" },
  { query: "Android PWA 권한", expectedDoc: "Android-PWA-DM-PERMISSION", difficulty: "easy" },
  { query: "localhost production 디버깅", expectedDoc: "localhost", difficulty: "easy" },

  // MEDIUM: Conceptual queries, synonyms
  { query: "푸시 알림 보내는 방법", expectedDoc: "phAlert-알림발송", difficulty: "medium" },
  { query: "실시간 데이터 동기화", expectedDoc: "WebSocket", difficulty: "medium" },
  { query: "재고 회전율 분석", expectedDoc: "재고", difficulty: "medium" },
  { query: "발주서 작성 화면", expectedDoc: "발주서작성페이지", difficulty: "medium" },
  { query: "주간 재고 변동 비교", expectedDoc: "주간", difficulty: "medium" },
  { query: "안전재고 설정", expectedDoc: "안전재고", difficulty: "medium" },

  // HARD: Indirect, vague queries
  { query: "앱에서 알림이 안 와요", expectedDoc: "Android-PWA-DM-PERMISSION", difficulty: "hard" },
  { query: "서버 배포 후 안 되는 문제", expectedDoc: "localhost", difficulty: "hard" },
  { query: "품목별 재고 얼마나 남았는지", expectedDoc: "재고", difficulty: "hard" },
  { query: "텔레그램 봇 연동", expectedDoc: "Telegram", difficulty: "hard" },
  { query: "DB 스키마 설계", expectedDoc: "Schema", difficulty: "hard" },
  { query: "GPT 프롬프트 작성법", expectedDoc: "prompting", difficulty: "hard" },
];

function matchesExpected(filepath: string, expected: string): boolean {
  // Normalize to NFC — macOS readdirSync returns NFD filenames
  return filepath.normalize("NFC").toLowerCase().includes(expected.normalize("NFC").toLowerCase());
}

describe("Korean BM25 Eval", () => {
  let store: ReturnType<typeof createStore>;

  beforeAll(async () => {
    store = createStore();

    function collectMdFiles(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir)) {
        if (["node_modules", "deprecated", "dist", "arc"].includes(entry)) continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          files.push(...collectMdFiles(full));
        } else if (entry.endsWith(".md")) {
          files.push(full);
        }
      }
      return files;
    }

    const mdFiles = collectMdFiles(AIPS_DIR);
    for (const file of mdFiles) {
      const content = readFileSync(file, "utf-8");
      const relPath = file.replace(AIPS_DIR + "/", "");
      const title = content.split("\n")[0]?.replace(/^#\s*/, "") || basename(file);
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
      const now = new Date().toISOString();

      insertContent(store.db, hash, content, now);
      insertDocument(store.db, "aips-2mds", relPath, title, hash, now, now);
      await insertDocumentKo(store.db, "aips-2mds", relPath, title, content);
    }
  });

  afterAll(async () => {
    store.close();
    await disposeKiwi();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("baseline FTS (English tokenizer) — report Hit@3", () => {
    console.log("\n=== Baseline FTS (English tokenizer) ===");
    let hits = 0;
    for (const { query, expectedDoc, difficulty } of evalQueries) {
      const results = searchFTS(store.db, query, 10);
      const rank = results.findIndex(r => matchesExpected(r.filepath, expectedDoc));
      const hit = rank >= 0 && rank < 3;
      if (hit) hits++;
      console.log(`  ${hit ? "✓" : "✗"} [${difficulty}] "${query}" → rank=${rank >= 0 ? rank + 1 : "-"}`);
    }
    const rate = hits / evalQueries.length;
    console.log(`  Hit@3: ${(rate * 100).toFixed(0)}%`);
  });

  test("Kiwi FTS — Hit@3 should exceed baseline by >=20pp", async () => {
    // Baseline
    let baselineHits = 0;
    for (const { query, expectedDoc } of evalQueries) {
      const results = searchFTS(store.db, query, 10);
      if (results.slice(0, 3).some(r => matchesExpected(r.filepath, expectedDoc))) baselineHits++;
    }
    const baselineRate = baselineHits / evalQueries.length;

    // Kiwi
    let kiwiHits = 0;
    console.log("\n=== Kiwi FTS ===");
    for (const { query, expectedDoc, difficulty } of evalQueries) {
      const results = await searchFTSKo(store.db, query, 10);
      const rank = results.findIndex(r => matchesExpected(r.filepath, expectedDoc));
      const hit = rank >= 0 && rank < 3;
      if (hit) kiwiHits++;
      console.log(`  ${hit ? "✓" : "✗"} [${difficulty}] "${query}" → rank=${rank >= 0 ? rank + 1 : "-"}`);
    }
    const kiwiRate = kiwiHits / evalQueries.length;

    console.log(`\n  Baseline Hit@3: ${(baselineRate * 100).toFixed(0)}%`);
    console.log(`  Kiwi Hit@3: ${(kiwiRate * 100).toFixed(0)}%`);
    console.log(`  Improvement: +${((kiwiRate - baselineRate) * 100).toFixed(0)}pp`);

    expect(kiwiRate - baselineRate).toBeGreaterThanOrEqual(0.20);
  }, 60000);

  test("qualitative: compound word matching works", async () => {
    // "재고" should match documents containing "재고관리", "재고현황" etc.
    const r1 = await searchFTSKo(store.db, "재고", 10);
    expect(r1.length).toBeGreaterThan(0);

    // "발주처" should match "발주처별", "발주처관리" etc.
    const r2 = await searchFTSKo(store.db, "발주처", 10);
    expect(r2.length).toBeGreaterThan(0);

    // "알림" should match "알림발송", "알림서비스" etc.
    const r3 = await searchFTSKo(store.db, "알림", 10);
    expect(r3.length).toBeGreaterThan(0);
  }, 30000);

  test("English regression: English queries still work", () => {
    const enQueries = [
      { query: "WebSocket", expected: "WebSocket" },
      { query: "Event Driven", expected: "Event-Driven" },
      { query: "Telegram bot", expected: "Telegram" },
    ];
    for (const { query, expected } of enQueries) {
      const results = searchFTS(store.db, query, 5);
      const found = results.some(r => matchesExpected(r.filepath, expected));
      expect(found).toBe(true);
    }
  });
});
