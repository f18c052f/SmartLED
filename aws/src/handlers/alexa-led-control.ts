import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { IoTClient, DescribeEndpointCommand } from "@aws-sdk/client-iot";
import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane";

const ssmClient = new SSMClient({});
const iotClient = new IoTClient({});

/** IoT Data Plane クライアント（エンドポイント取得後に初期化） */
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

/** Alexa からのリクエストペイロード型（将来拡張） */
export interface AlexaRequest {
  request?: {
    type?: string;
    intent?: { name?: string; slots?: Record<string, { value?: string }> };
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
 * Alexa Custom Skill / Smart Home Skill からのリクエストを処理し、
 * Gemini API で自然言語を解釈 → IoT Core (MQTT) へ LED 制御メッセージをパブリッシュする。
 */
export const handler = async (event: AlexaRequest): Promise<LambdaResponse> => {
  try {
    const paramName = process.env.GEMINI_API_KEY_PARAM_NAME;
    const topicPrefix = process.env.IOT_TOPIC_PREFIX;

    if (!paramName || !topicPrefix) {
      console.error("Missing required env: GEMINI_API_KEY_PARAM_NAME or IOT_TOPIC_PREFIX");
      return buildResponse(500, { message: "Internal Server Error" });
    }

    // SSM Parameter Store から Gemini API キーを取得（無料枠対応）
    const command = new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    });
    const response = await ssmClient.send(command);
    const apiKey = response.Parameter?.Value;

    if (!apiKey) {
      console.error("API Key not found in SSM Parameter Store");
      return buildResponse(500, { message: "Internal Server Error" });
    }

    // TODO: Phase 2 で実装 - Alexa インテントから自然言語を抽出し、Gemini API に渡す
    const naturalLanguage = extractNaturalLanguageFromAlexa(event);
    console.log("Natural language input:", naturalLanguage);

    // TODO: Phase 2 で実装 - Gemini API で LED パラメータ（色・エフェクト・輝度）を取得
    const ledParams = { color: "#ffffff", brightness: 100, effect: "solid" };

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

    console.log("Published to topic:", topic);

    return buildResponse(200, {
      message: "Success",
      topic,
    });
  } catch (error) {
    console.error("Error processing request:", error);
    return buildResponse(500, { message: "Internal Server Error" });
  }
};

/** Alexa リクエストから自然言語テキストを抽出（雛形） */
function extractNaturalLanguageFromAlexa(event: AlexaRequest): string {
  const intent = event?.request?.intent;
  if (!intent?.slots) return "";

  const slot = intent.slots["phrase"] ?? intent.slots["utterance"];
  return (slot?.value as string) ?? "";
}

function buildResponse(statusCode: number, body: object): LambdaResponse {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  };
}
