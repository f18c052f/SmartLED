import { fetchLedParams, isLedParams, __forTesting } from "../src/lib/gemini-client";

const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

const { allowedEffectIds } = __forTesting;
const VALID_PARAMS = {
  color: "#ff6600",
  brightness: 128,
  effect: "solid",
  effectId: 0,
} as const;

function makeMockResponse(text: string) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  };
}

describe("isLedParams (二段防衛バリデーション)", () => {
  it("accepts valid params with all required fields", () => {
    expect(isLedParams({ ...VALID_PARAMS })).toBe(true);
    expect(isLedParams({ color: "#000000", brightness: 0, effect: "rainbow", effectId: 9 })).toBe(
      true
    );
    expect(isLedParams({ color: "#ffffff", brightness: 255, effect: "breath", effectId: 14 })).toBe(
      true
    );
  });

  it("rejects invalid color", () => {
    expect(isLedParams({ ...VALID_PARAMS, color: "red" })).toBe(false);
    expect(isLedParams({ ...VALID_PARAMS, color: "#gggggg" })).toBe(false);
    expect(isLedParams({ ...VALID_PARAMS, color: "#fff" })).toBe(false);
  });

  it("rejects invalid brightness (boundary check)", () => {
    expect(isLedParams({ ...VALID_PARAMS, brightness: -1 })).toBe(false);
    expect(isLedParams({ ...VALID_PARAMS, brightness: 256 })).toBe(false);
    expect(isLedParams({ ...VALID_PARAMS, brightness: 1.5 })).toBe(false);
  });

  it("rejects effectId not in allowed enum (列挙外検出)", () => {
    expect(isLedParams({ ...VALID_PARAMS, effectId: 999 })).toBe(false);
    expect(isLedParams({ ...VALID_PARAMS, effectId: -1 })).toBe(false);
    expect(isLedParams({ ...VALID_PARAMS, effectId: 1.5 })).toBe(false);
  });

  it("rejects when effect or effectId is missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { effectId: _e1, ...withoutEffectId } = VALID_PARAMS;
    expect(isLedParams(withoutEffectId)).toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { effect: _e2, ...withoutEffect } = VALID_PARAMS;
    expect(isLedParams(withoutEffect)).toBe(false);
  });

  it("rejects non-object inputs", () => {
    expect(isLedParams(null)).toBe(false);
    expect(isLedParams(undefined)).toBe(false);
    expect(isLedParams("solid")).toBe(false);
    expect(isLedParams(0)).toBe(false);
  });

  it("allowed effect IDs include the canonical 7 (regression)", () => {
    // 既存 ESP32 main.cpp で実装済みの 7 種は最低限存在することを保証
    [0, 9, 12, 14, 20, 66, 68].forEach((id) => {
      expect(allowedEffectIds).toContain(id);
    });
  });
});

describe("fetchLedParams", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("returns valid LED params on successful Gemini response", async () => {
    const expected = { color: "#fffaf0", brightness: 200, effect: "solid", effectId: 0 };
    mockFetch.mockResolvedValueOnce(makeMockResponse(JSON.stringify(expected)));

    const result = await fetchLedParams("読書に集中したい", "test-api-key");

    expect(result).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("gemini-2.5-flash-lite"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("includes the natural language in the request body", async () => {
    const expected = { color: "#ff4500", brightness: 50, effect: "breath", effectId: 14 };
    mockFetch.mockResolvedValueOnce(makeMockResponse(JSON.stringify(expected)));

    await fetchLedParams("リラックスしたい", "test-api-key");

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(callBody.contents[0].parts[0].text).toContain("リラックスしたい");
  });

  it("includes responseSchema with effectId enum constraint in request", async () => {
    const expected = { color: "#ffffff", brightness: 100, effect: "solid", effectId: 0 };
    mockFetch.mockResolvedValueOnce(makeMockResponse(JSON.stringify(expected)));

    await fetchLedParams("test", "key");

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(callBody.generationConfig).toHaveProperty("responseSchema");
    expect(callBody.generationConfig.responseSchema.properties.effectId.enum).toEqual(
      allowedEffectIds
    );
  });

  it("includes the effects catalog in the system prompt", async () => {
    const expected = { color: "#ffffff", brightness: 100, effect: "solid", effectId: 0 };
    mockFetch.mockResolvedValueOnce(makeMockResponse(JSON.stringify(expected)));

    await fetchLedParams("test", "key");

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const promptText = callBody.contents[0].parts[0].text as string;
    // catalog の代表的なエントリが含まれていることを確認
    expect(promptText).toContain('alias="solid"');
    expect(promptText).toContain('alias="rainbow"');
    expect(promptText).toContain('alias="fire"');
  });

  it("throws error when Gemini API returns non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    });

    await expect(fetchLedParams("test", "key")).rejects.toThrow("Gemini API error: 429");
  });

  it("throws error when response has no candidates", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [] }),
    });

    await expect(fetchLedParams("test", "key")).rejects.toThrow(
      "Gemini API returned empty response"
    );
  });

  it("throws error when response JSON has invalid effectId", async () => {
    mockFetch.mockResolvedValueOnce(
      makeMockResponse(
        JSON.stringify({ color: "#ffffff", brightness: 100, effect: "solid", effectId: 999 })
      )
    );

    await expect(fetchLedParams("test", "key")).rejects.toThrow("Invalid LED params from Gemini");
  });

  it("throws error when response is not valid JSON", async () => {
    mockFetch.mockResolvedValueOnce(makeMockResponse("not-json"));

    await expect(fetchLedParams("test", "key")).rejects.toThrow(
      "Failed to parse Gemini response as JSON"
    );
  });

  it("parses response wrapped in ```json ... ``` markdown code block", async () => {
    const params = { color: "#ff00ff", brightness: 220, effect: "rainbow", effectId: 9 };
    const markdown = "```json\n" + JSON.stringify(params) + "\n```";
    mockFetch.mockResolvedValueOnce(makeMockResponse(markdown));

    const result = await fetchLedParams("サイバーパンクにして", "test-api-key");
    expect(result).toEqual(params);
  });

  it("parses response wrapped in ``` ... ``` markdown code block without language tag", async () => {
    const params = { color: "#ff4500", brightness: 50, effect: "breath", effectId: 14 };
    const markdown = "```\n" + JSON.stringify(params) + "\n```";
    mockFetch.mockResolvedValueOnce(makeMockResponse(markdown));

    const result = await fetchLedParams("リラックスしたい", "test-api-key");
    expect(result).toEqual(params);
  });
});
