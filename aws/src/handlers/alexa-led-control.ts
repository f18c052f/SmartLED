import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { IoTClient, DescribeEndpointCommand } from "@aws-sdk/client-iot";
import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane";
import { fetchLedParams } from "../lib/gemini-client.js";
import {
  AlexaRequest,
  AlexaResponse,
  extractNaturalLanguageFromAlexa,
  buildAlexaResponse,
} from "../lib/alexa-request.js";

export type { AlexaRequest } from "../lib/alexa-request.js";

const ssmClient = new SSMClient({});
const iotClient = new IoTClient({});

/** IoT Data Plane クライアント（エンドポイント取得後にキャッシュ） */
let iotDataClient: IoTDataPlaneClient | null = null;

async function getIoTDataClient(): Promise<IoTDataPlaneClient> {
  if (iotDataClient) return iotDataClient;
  const res = await iotClient.send(new DescribeEndpointCommand({ endpointType: "iot:Data-ATS" }));
  if (!res.endpointAddress) throw new Error("IoT Data endpoint not found");
  iotDataClient = new IoTDataPlaneClient({
    endpoint: `https://${res.endpointAddress}`,
  });
  return iotDataClient;
}

/** CloudWatch Logs に1行の構造化JSONとして出力する */
function log(level: "INFO" | "WARN" | "ERROR", message: string, data?: Record<string, unknown>) {
  const entry = JSON.stringify({ level, message, ...data });
  if (level === "ERROR") console.error(entry);
  else if (level === "WARN") console.warn(entry);
  else console.log(entry);
}

/**
 * Alexa Custom Skill からのリクエストを処理する。
 * 自然言語 → Gemini API → LED パラメータ → IoT Core (MQTT) の順で処理する。
 */
export const handler = async (event: AlexaRequest): Promise<AlexaResponse> => {
  const requestType = event?.request?.type;

  // スキル起動時のウェルカムメッセージ
  if (requestType === "LaunchRequest") {
    log("INFO", "Received LaunchRequest");
    return buildAlexaResponse(
      "スマートLEDへようこそ。照明の色や明るさを言葉で指定してください。",
      false
    );
  }

  // セッション終了は応答不要（Alexaプロトコルの仕様）
  if (requestType === "SessionEndedRequest") {
    log("INFO", "Received SessionEndedRequest");
    return buildAlexaResponse("", true);
  }

  try {
    const paramName = process.env.GEMINI_API_KEY_PARAM_NAME;
    const topicPrefix = process.env.IOT_TOPIC_PREFIX;

    if (!paramName || !topicPrefix) {
      log("ERROR", "Missing required env vars", { paramName, topicPrefix });
      return buildAlexaResponse("設定エラーが発生しました。管理者に確認してください。");
    }

    // Alexa インテントから自然言語テキストを抽出
    const naturalLanguage = extractNaturalLanguageFromAlexa(event);
    if (!naturalLanguage) {
      log("WARN", "No phrase found in Alexa request", { request: event.request });
      return buildAlexaResponse("すみません、うまく聞き取れませんでした。もう一度お試しください。");
    }
    log("INFO", "Natural language input received", { naturalLanguage });

    // SSM Parameter Store から Gemini API キーを取得（無料枠対応）
    const ssmResponse = await ssmClient.send(
      new GetParameterCommand({ Name: paramName, WithDecryption: true })
    );
    const apiKey = ssmResponse.Parameter?.Value;

    if (!apiKey) {
      log("ERROR", "API Key not found in SSM Parameter Store", { paramName });
      return buildAlexaResponse("APIキーの取得に失敗しました。管理者に確認してください。");
    }

    // Gemini API で自然言語を解釈し、LED パラメータ（色・輝度・エフェクト）を取得
    const ledParams = await fetchLedParams(naturalLanguage, apiKey);
    log("INFO", "LED params fetched from Gemini", { ledParams });

    // IoT Core (MQTT) へ制御メッセージをパブリッシュ
    const topic = `${topicPrefix}/control`;
    const dataClient = await getIoTDataClient();
    await dataClient.send(
      new PublishCommand({
        topic,
        payload: Buffer.from(JSON.stringify(ledParams)),
        qos: 0,
      })
    );

    log("INFO", "Published LED params to IoT Core", { topic, ledParams });

    return buildAlexaResponse("はい、照明を調整しました。");
  } catch (error) {
    log("ERROR", "Unhandled error processing request", {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return buildAlexaResponse("エラーが発生しました。しばらくしてからもう一度お試しください。");
  }
};
