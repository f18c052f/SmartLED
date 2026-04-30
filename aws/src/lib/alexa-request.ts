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
 * Alexa リクエストを 6 種類のコマンドに正規化する判別共用体。
 * ハンドラーはこの型に対して switch することで分岐の網羅性を保証する。
 */
export type AlexaCommand =
  | { kind: "launch" }
  | { kind: "sessionEnded" }
  | { kind: "scene"; phrase: string }
  | { kind: "powerOn" }
  | { kind: "powerOff" }
  | { kind: "unknown" };

/**
 * Alexa Custom Skill のリクエストからコマンド種別を抽出する。
 * - LaunchRequest / SessionEndedRequest はそのまま種別として返す
 * - IntentRequest は intent.name を見て分岐
 *   - PowerOnIntent  → kind: "powerOn"
 *   - PowerOffIntent → kind: "powerOff"
 *   - LightControlIntent → kind: "scene" (phrase スロット必須)
 *   - その他 → kind: "unknown"
 */
export function classifyAlexaIntent(event: AlexaRequest): AlexaCommand {
  const requestType = event?.request?.type;
  if (requestType === "LaunchRequest") return { kind: "launch" };
  if (requestType === "SessionEndedRequest") return { kind: "sessionEnded" };

  const intentName = event?.request?.intent?.name;
  switch (intentName) {
    case "PowerOnIntent":
      return { kind: "powerOn" };
    case "PowerOffIntent":
      return { kind: "powerOff" };
    case "LightControlIntent": {
      const phrase = extractNaturalLanguageFromAlexa(event);
      return phrase ? { kind: "scene", phrase } : { kind: "unknown" };
    }
    default:
      return { kind: "unknown" };
  }
}

/**
 * Alexa Custom Skill のインテントリクエストから自然言語テキストを抽出する。
 * スロット名 "phrase" または "utterance" を検索する。
 * （`classifyAlexaIntent` 内部で利用するヘルパだが、後方互換のため公開する）
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
