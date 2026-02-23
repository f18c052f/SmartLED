const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "gemini-2.5-flash-lite";

const VALID_EFFECTS = ["solid", "fade", "rainbow", "sparkle", "fire", "twinkle", "breath"] as const;
type Effect = (typeof VALID_EFFECTS)[number];

/** IoT Core → ESP32 → WLED に渡す LED 制御パラメータ */
export interface LedParams {
  color: string; // HEX カラーコード（例: "#ff6600"）
  brightness: number; // 輝度 0〜255
  effect: Effect; // WLED エフェクト名
}

const SYSTEM_PROMPT = `あなたはスマート照明コントローラーです。
ユーザーの指示を解釈し、以下のJSON形式のみで回答してください。他の文字は一切含めないでください。

{"color":"<HEXカラーコード 例:#ff6600>","brightness":<0-255の整数>,"effect":"<solid|fade|rainbow|sparkle|fire|twinkle|breathのいずれか>"}

判断基準:
- 読書・集中 → 温白色(#fffaf0)、高輝度(200-255)、solid
- リラックス・就寝前 → 暖色(#ff4500)、低輝度(30-80)、fade または breath
- パーティー・にぎやか → 多色(#ff00ff)、高輝度(220-255)、rainbow または sparkle
- 映画・シアター → 暗め(#1a0000)、低輝度(10-40)、solid
- 朝・爽やか → 青白色(#e0f0ff)、中輝度(150-200)、solid`;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

/**
 * Gemini API を呼び出し、自然言語から LED 制御パラメータを取得する。
 * fetch は Node.js 20 のグローバルを使用（外部依存なし）。
 */
export async function fetchLedParams(naturalLanguage: string, apiKey: string): Promise<LedParams> {
  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\nユーザーの指示: ${naturalLanguage}` }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${errorText}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error("Gemini API returned empty response");
  }

  return parseLedParams(rawText);
}

function parseLedParams(raw: string): LedParams {
  // Gemini が ```json ... ``` 形式で返す場合があるため Markdown コードブロックを除去する
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse Gemini response as JSON: ${raw}`);
  }

  if (!isLedParams(parsed)) {
    throw new Error(`Invalid LED params from Gemini: ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

export function isLedParams(v: unknown): v is LedParams {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;

  if (typeof obj.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(obj.color)) return false;
  if (
    typeof obj.brightness !== "number" ||
    !Number.isInteger(obj.brightness) ||
    obj.brightness < 0 ||
    obj.brightness > 255
  )
    return false;
  if (!VALID_EFFECTS.includes(obj.effect as Effect)) return false;

  return true;
}
