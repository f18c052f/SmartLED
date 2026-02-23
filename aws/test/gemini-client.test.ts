import { fetchLedParams, isLedParams } from "../src/lib/gemini-client";

const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

function makeMockResponse(text: string) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  };
}

describe("isLedParams", () => {
  it("accepts valid params", () => {
    expect(isLedParams({ color: "#ff6600", brightness: 128, effect: "solid" })).toBe(true);
    expect(isLedParams({ color: "#000000", brightness: 0, effect: "rainbow" })).toBe(true);
    expect(isLedParams({ color: "#ffffff", brightness: 255, effect: "breath" })).toBe(true);
  });

  it("rejects invalid color", () => {
    expect(isLedParams({ color: "red", brightness: 100, effect: "solid" })).toBe(false);
    expect(isLedParams({ color: "#gggggg", brightness: 100, effect: "solid" })).toBe(false);
    expect(isLedParams({ color: "#fff", brightness: 100, effect: "solid" })).toBe(false);
  });

  it("rejects invalid brightness", () => {
    expect(isLedParams({ color: "#ffffff", brightness: -1, effect: "solid" })).toBe(false);
    expect(isLedParams({ color: "#ffffff", brightness: 256, effect: "solid" })).toBe(false);
    expect(isLedParams({ color: "#ffffff", brightness: 1.5, effect: "solid" })).toBe(false);
  });

  it("rejects invalid effect", () => {
    expect(isLedParams({ color: "#ffffff", brightness: 100, effect: "unknown" })).toBe(false);
    expect(isLedParams({ color: "#ffffff", brightness: 100, effect: 0 })).toBe(false);
  });
});

describe("fetchLedParams", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("returns valid LED params on successful Gemini response", async () => {
    const expected = { color: "#fffaf0", brightness: 200, effect: "solid" };
    mockFetch.mockResolvedValueOnce(makeMockResponse(JSON.stringify(expected)));

    const result = await fetchLedParams("読書に集中したい", "test-api-key");

    expect(result).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("gemini-2.0-flash-lite"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("includes the natural language in the request body", async () => {
    const expected = { color: "#ff4500", brightness: 50, effect: "fade" };
    mockFetch.mockResolvedValueOnce(makeMockResponse(JSON.stringify(expected)));

    await fetchLedParams("リラックスしたい", "test-api-key");

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(callBody.contents[0].parts[0].text).toContain("リラックスしたい");
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

  it("throws error when response JSON is invalid LED params", async () => {
    mockFetch.mockResolvedValueOnce(
      makeMockResponse('{"color":"invalid","brightness":999,"effect":"unknown"}')
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
    const params = { color: "#ff00ff", brightness: 220, effect: "rainbow" };
    const markdown = "```json\n" + JSON.stringify(params) + "\n```";
    mockFetch.mockResolvedValueOnce(makeMockResponse(markdown));

    const result = await fetchLedParams("サイバーパンクにして", "test-api-key");
    expect(result).toEqual(params);
  });

  it("parses response wrapped in ``` ... ``` markdown code block without language tag", async () => {
    const params = { color: "#ff4500", brightness: 50, effect: "fade" };
    const markdown = "```\n" + JSON.stringify(params) + "\n```";
    mockFetch.mockResolvedValueOnce(makeMockResponse(markdown));

    const result = await fetchLedParams("リラックスしたい", "test-api-key");
    expect(result).toEqual(params);
  });
});
