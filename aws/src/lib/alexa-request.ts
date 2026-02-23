/** Alexa Custom Skill のリクエストペイロード型 */
export interface AlexaRequest {
  version?: string;
  request?: {
    type?: string;
    intent?: {
      name?: string;
      slots?: Record<string, { name?: string; value?: string }>;
    };
  };
  [key: string]: unknown;
}

/** Alexa Custom Skill のレスポンスペイロード型 */
export interface AlexaResponse {
  version: string;
  response: {
    outputSpeech: {
      type: "PlainText";
      text: string;
    };
    shouldEndSession: boolean;
  };
}

/**
 * Alexa Custom Skill のインテントリクエストから自然言語テキストを抽出する。
 * スロット名 "phrase" または "utterance" を検索する。
 */
export function extractNaturalLanguageFromAlexa(event: AlexaRequest): string {
  const intent = event?.request?.intent;
  if (!intent?.slots) return "";

  const slot = intent.slots["phrase"] ?? intent.slots["utterance"];
  return slot?.value ?? "";
}

/**
 * Alexa レスポンスを組み立てる。
 * @param text - Alexa が読み上げるテキスト
 * @param shouldEndSession - セッションを終了するか（true: 終了、false: 継続）
 */
export function buildAlexaResponse(text: string, shouldEndSession = true): AlexaResponse {
  return {
    version: "1.0",
    response: {
      outputSpeech: {
        type: "PlainText",
        text,
      },
      shouldEndSession,
    },
  };
}
