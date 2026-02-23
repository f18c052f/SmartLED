import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { IoTClient, DescribeEndpointCommand } from "@aws-sdk/client-iot";
import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane";
import { fetchLedParams } from "../lib/gemini-client.js";

const ssmClient = new SSMClient({});
const iotClient = new IoTClient({});

/** IoT Data Plane クライアント（エンドポイント取得後にキャッシュ） */
let iotDataClient: IoTDataPlaneClient | null = null;

async function getIoTDataClient(): Promise<IoTDataPlaneClient> {
  if (iotDataClient) return iotDataClient;
  const res = await iotClient.send(
    new DescribeEndpointCommand({ endpointType: "iot:Data-ATS" })
  );
  if (!res.endpointAddress) throw new Error("IoT Data endpoint not found");
  iotDataClient = new IoTDataPlaneClient({
    endpoint: `https://${res.endpointAddress}`,
  });
  return iotDataClient;
}

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

/** Lambda レスポンス型 */
export interface LambdaResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

/**
 * Alexa Custom Skill からのリクエストを処理する。
 * 自然言語 → Gemini API → LED パラメータ → IoT Core (MQTT) の順で処理する。
 */
export const handler = async (event: AlexaRequest): Promise<LambdaResponse> => {
  try {
    const paramName = process.env.GEMINI_API_KEY_PARAM_NAME;
    const topicPrefix = process.env.IOT_TOPIC_PREFIX;

    if (!paramName || !topicPrefix) {
      console.error("Missing required env: GEMINI_API_KEY_PARAM_NAME or IOT_TOPIC_PREFIX");
      return buildResponse(500, { message: "Internal Server Error" });
    }

    // LaunchRequest / SessionEndedRequest は処理不要
    const requestType = event?.request?.type;
    if (requestType === "LaunchRequest" || requestType === "SessionEndedRequest") {
      console.log("Received non-intent request type:", requestType);
      return buildResponse(200, { message: "OK" });
    }

    // Alexa インテントから自然言語テキストを抽出
    const naturalLanguage = extractNaturalLanguageFromAlexa(event);
    if (!naturalLanguage) {
      console.warn("No phrase found in Alexa request:", JSON.stringify(event.request));
      return buildResponse(400, { message: "Bad Request: no phrase provided" });
    }
    console.log("Natural language input:", naturalLanguage);

    // SSM Parameter Store から Gemini API キーを取得（無料枠対応）
    const ssmResponse = await ssmClient.send(
      new GetParameterCommand({ Name: paramName, WithDecryption: true })
    );
    const apiKey = ssmResponse.Parameter?.Value;

    if (!apiKey) {
      console.error("API Key not found in SSM Parameter Store");
      return buildResponse(500, { message: "Internal Server Error" });
    }

    // Gemini API で自然言語を解釈し、LED パラメータ（色・輝度・エフェクト）を取得
    const ledParams = await fetchLedParams(naturalLanguage, apiKey);
    console.log("LED params from Gemini:", JSON.stringify(ledParams));

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

    console.log("Published LED params to topic:", topic);

    return buildResponse(200, { message: "Success", topic, ledParams });
  } catch (error) {
    console.error("Error processing request:", error);
    return buildResponse(500, { message: "Internal Server Error" });
  }
};

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

function buildResponse(statusCode: number, body: object): LambdaResponse {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  };
}
