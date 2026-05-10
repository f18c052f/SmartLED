import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { IoTClient, DescribeEndpointCommand } from "@aws-sdk/client-iot";
import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane";
import { fetchLedParams, type LedParams } from "../lib/gemini-client.js";
import {
  AlexaRequest,
  AlexaResponse,
  classifyAlexaIntent,
  buildAlexaResponse,
} from "../lib/alexa-request.js";

export type { AlexaRequest } from "../lib/alexa-request.js";

const ssmClient = new SSMClient({});
const iotClient = new IoTClient({});

/** ESP32 が認識する制御モード */
type Mode = "AUTO" | "MANUAL" | "STANDBY";

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

async function publishToTopic(topic: string, payload: object): Promise<void> {
  const dataClient = await getIoTDataClient();
  await dataClient.send(
    new PublishCommand({
      topic,
      payload: Buffer.from(JSON.stringify(payload)),
      qos: 0,
    })
  );
}

async function publishControl(topicPrefix: string, params: LedParams): Promise<void> {
  await publishToTopic(`${topicPrefix}/control`, params);
}

async function publishMode(topicPrefix: string, mode: Mode): Promise<void> {
  await publishToTopic(`${topicPrefix}/mode`, { mode });
}

async function getGeminiApiKey(paramName: string): Promise<string> {
  const ssmResponse = await ssmClient.send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true })
  );
  const apiKey = ssmResponse.Parameter?.Value;
  if (!apiKey) {
    throw new Error("API Key not found in SSM Parameter Store");
  }
  return apiKey;
}

/**
 * Alexa Custom Skill からのリクエストを処理する。
 *
 * インテント別の振る舞い（`requirements.md` §7-§9 準拠）:
 *   - LaunchRequest        → ウェルカム応答（セッション継続）
 *   - SessionEndedRequest  → 空応答（セッション終了）
 *   - AMAZON.HelpIntent    → 使い方の案内（セッション継続、MQTT なし）
 *   - AMAZON.Stop/Cancel/NavigateHome → 終了挨拶（MQTT なし）
 *   - PowerOnIntent        → mode publish: AUTO（PIRが再び有効に）
 *   - PowerOffIntent       → mode publish: STANDBY（強制消灯）
 *   - LightControlIntent   → Gemini → control publish + mode publish: MANUAL
 *   - その他               → 聞き返し応答
 */
export const handler = async (event: AlexaRequest): Promise<AlexaResponse> => {
  const command = classifyAlexaIntent(event);

  if (command.kind === "launch") {
    log("INFO", "Received LaunchRequest");
    return buildAlexaResponse(
      "スマートLEDへようこそ。照明の色や明るさを言葉で指定してください。",
      false
    );
  }

  if (command.kind === "sessionEnded") {
    log("INFO", "Received SessionEndedRequest");
    return buildAlexaResponse("", true);
  }

  if (command.kind === "amazonHelp") {
    log("INFO", "Received AMAZON.HelpIntent");
    return buildAlexaResponse(
      "スマートLEDでは、例えば「ライトを読書モードにして」のように言うと照明を変えられます。" +
        "「ライトをつけて」で自動、「ライトを消して」でスタンバイにします。",
      false
    );
  }

  if (
    command.kind === "amazonStop" ||
    command.kind === "amazonCancel" ||
    command.kind === "amazonNavigateHome"
  ) {
    log("INFO", "Received Amazon built-in end-session intent", { kind: command.kind });
    return buildAlexaResponse("はい。また聞いてくださいね。");
  }

  try {
    const paramName = process.env.GEMINI_API_KEY_PARAM_NAME;
    const topicPrefix = process.env.IOT_TOPIC_PREFIX;

    if (!paramName || !topicPrefix) {
      log("ERROR", "Missing required env vars", { paramName, topicPrefix });
      return buildAlexaResponse("設定エラーが発生しました。管理者に確認してください。");
    }

    switch (command.kind) {
      case "powerOn": {
        log("INFO", "PowerOnIntent received");
        await publishMode(topicPrefix, "AUTO");
        log("INFO", "Published mode=AUTO");
        return buildAlexaResponse("はい、ライトを自動にしました。");
      }

      case "powerOff": {
        log("INFO", "PowerOffIntent received");
        await publishMode(topicPrefix, "STANDBY");
        log("INFO", "Published mode=STANDBY");
        return buildAlexaResponse("はい、ライトを消しました。");
      }

      case "scene": {
        log("INFO", "LightControlIntent received", { phrase: command.phrase });

        const apiKey = await getGeminiApiKey(paramName);
        const ledParams = await fetchLedParams(command.phrase, apiKey);
        log("INFO", "LED params fetched from Gemini", { ledParams });

        // シーン指定は MANUAL に強制遷移しつつ control を反映する（§7.3 準拠）
        await publishControl(topicPrefix, ledParams);
        await publishMode(topicPrefix, "MANUAL");
        log("INFO", "Published control + mode=MANUAL", { ledParams });

        return buildAlexaResponse("はい、照明を調整しました。");
      }

      case "unknown":
      default: {
        log("WARN", "Unknown or empty intent", { request: event.request });
        return buildAlexaResponse(
          "すみません、うまく聞き取れませんでした。もう一度お試しください。"
        );
      }
    }
  } catch (error) {
    log("ERROR", "Unhandled error processing request", {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return buildAlexaResponse("エラーが発生しました。しばらくしてからもう一度お試しください。");
  }
};
