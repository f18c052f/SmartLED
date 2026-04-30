import wledEffectsData from "./wled-effects.json";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "gemini-2.5-flash-lite";

interface WledEffect {
  id: number;
  name: string;
  alias: string;
  tags: string[];
}

const wledEffects = wledEffectsData.effects as WledEffect[];
const allowedEffectIds: number[] = wledEffects.map((e) => e.id);
const allowedAliases: string[] = wledEffects.map((e) => e.alias);

/** IoT Core → ESP32 → WLED に渡す LED 制御パラメータ */
export interface LedParams {
  color: string; // HEX カラーコード（例: "#ff6600"）
  brightness: number; // 輝度 0〜255
  effect: string; // WLED エフェクトの alias（参考情報・ログ用途）
  effectId: number; // WLED FX_MODE_* の整数 ID（真実のソース。ESP32 はこれを直接 fx に設定する）
}

const effectsCatalog = wledEffects
  .map(
    (e) =>
      `- id=${e.id}, name="${e.name}", alias="${e.alias}", tags=[${e.tags.map((t) => `"${t}"`).join(", ")}]`
  )
  .join("\n");

const SYSTEM_PROMPT = `あなたはスマート照明コントローラーです。
ユーザーの自然言語を解釈し、最適な WLED 設定を JSON で返答してください。他の文字は一切含めないでください。

## 利用可能なエフェクト一覧（この中から最も適切な1つを選び、effectId にその id、effect にその alias を指定してください）

${effectsCatalog}

## 出力スキーマ

{
  "color": "<HEX カラーコード 例: #ff6600>",
  "brightness": <0-255 の整数>,
  "effect": "<上記の alias のいずれか>",
  "effectId": <上記の id のいずれか>
}

## 判断基準（参考）

- 読書・集中 → 温白色 (#fffaf0)、高輝度 (200-255)、Solid (id=0)
- リラックス・就寝前 → 暖色 (#ff4500)、低輝度 (30-80)、Breathe (id=14) または Fade (id=12)
- パーティー・にぎやか → 鮮やかな色、高輝度 (220-255)、Rainbow (id=9) / Pride (id=40) / Sparkle (id=20)
- 映画・シアター → 暗め (#1a0000)、低輝度 (10-40)、Solid (id=0)
- 朝・爽やか・目覚め → 青白色 (#e0f0ff)、中輝度 (150-200)、Sunrise (id=58) または Solid
- 暖炉・キャンドル → 暖色 (#ff7700)、中輝度 (100-180)、Fire 2012 (id=66) / Candle Multi (id=90)
- 海・癒し → 青系 (#0080ff)、中輝度 (100-180)、Pacifica (id=89) / Colorwaves (id=44)
- 警告・注意 → 赤青系、Police (id=80) / Strobe (id=22)`;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

/** Gemini Structured Output で列挙外の effectId が返らないよう型レベルで制約する */
const responseSchema = {
  type: "object",
  properties: {
    color: { type: "string" },
    brightness: { type: "integer", minimum: 0, maximum: 255 },
    effect: { type: "string", enum: allowedAliases },
    effectId: { type: "integer", enum: allowedEffectIds },
  },
  required: ["color", "brightness", "effect", "effectId"],
};

/**
 * Gemini API を呼び出し、自然言語から LED 制御パラメータを取得する。
 * fetch は Node.js 22 のグローバルを使用（外部依存なし）。
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
        responseSchema,
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

/**
 * 二段防衛バリデーション。`responseSchema` の指定をすり抜けた値を最終チェックする。
 * effectId が真実のソース（`wled-effects.json`）の列挙値であることを必ず確認する。
 */
export function isLedParams(v: unknown): v is LedParams {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;

  if (typeof obj.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(obj.color)) return false;
  if (
    typeof obj.brightness !== "number" ||
    !Number.isInteger(obj.brightness) ||
    obj.brightness < 0 ||
    obj.brightness > 255
  ) {
    return false;
  }
  if (typeof obj.effect !== "string") return false;
  if (typeof obj.effectId !== "number" || !Number.isInteger(obj.effectId)) return false;
  if (!allowedEffectIds.includes(obj.effectId)) return false;

  return true;
}

/** テスト用の内部公開（プロダクションコードから使わないこと） */
export const __forTesting = {
  allowedEffectIds,
  allowedAliases,
};
