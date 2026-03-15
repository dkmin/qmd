import { describe, test, expect, afterAll } from "vitest";
import { tokenizeKo, tokenizeQuery, isKiwiAvailable, disposeKiwi } from "../src/kiwi";

afterAll(async () => {
  await disposeKiwi();
});

describe("Kiwi Korean Tokenizer", () => {
  test("tokenizeKo splits compound nouns", async () => {
    const result = await tokenizeKo("재고관리시스템을 개선합니다");
    expect(result).toContain("재고");
    expect(result).toContain("관리");
    expect(result).toContain("시스템");
    expect(result).toContain("개선");
    // Should NOT contain particles
    expect(result).not.toMatch(/\b을\b/);
  });

  test("tokenizeKo preserves English terms (SL tag)", async () => {
    const result = await tokenizeKo("API 연동 설정");
    expect(result).toContain("API");
    expect(result).toContain("연동");
    expect(result).toContain("설정");
  });

  test("tokenizeQuery handles search queries", async () => {
    const result = await tokenizeQuery("발주처별 재고현황");
    expect(result).toContain("발주");
    expect(result).toContain("재고");
    expect(result).toContain("현황");
  });

  test("isKiwiAvailable returns true after init", async () => {
    await tokenizeKo("테스트");
    expect(isKiwiAvailable()).toBe(true);
  });

  test("handles empty string", async () => {
    const result = await tokenizeKo("");
    expect(result).toBe("");
  });

  test("handles pure English text", async () => {
    const result = await tokenizeKo("hello world");
    // SL tags should capture these
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });
});
