import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/** SSM Parameter Store の Gemini API キー用パラメータ名 */
const GEMINI_API_KEY_PARAM = "/smartled/gemini-api-key";

/** IoT Core の LED 制御用 MQTT トピックプレフィックス */
const IOT_TOPIC_PREFIX = "smartled/esp32";

export class IoTBackendStack extends cdk.Stack {
  public readonly alexaLedHandler: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const region = this.region;
    const account = this.account;

    // Alexa → Lambda 用ハンドラ（Gemini API 解釈 + IoT Core パブリッシュ）
    this.alexaLedHandler = new lambdaNodejs.NodejsFunction(this, "AlexaLedHandler", {
      entry: "src/handlers/alexa-led-control.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        GEMINI_API_KEY_PARAM_NAME: GEMINI_API_KEY_PARAM,
        IOT_TOPIC_PREFIX,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node20",
      },
    });

    // 最小権限: SSM Parameter Store から Gemini API キー取得
    this.alexaLedHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${region}:${account}:parameter${GEMINI_API_KEY_PARAM}`,
        ],
      })
    );

    // 最小権限: IoT Data エンドポイント取得（Publish に必要）
    this.alexaLedHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iot:DescribeEndpoint"],
        resources: ["*"],
      })
    );

    // 最小権限: IoT Core (MQTT) へパブリッシュ
    this.alexaLedHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iot:Publish"],
        resources: [`arn:aws:iot:${region}:${account}:topic/${IOT_TOPIC_PREFIX}/*`],
      })
    );
  }
}
