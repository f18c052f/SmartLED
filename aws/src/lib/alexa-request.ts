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
