import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as iot from "aws-cdk-lib/aws-iot";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

/** SSM Parameter Store の Gemini API キー用パラメータ名 */
const GEMINI_API_KEY_PARAM = "/smartled/gemini-api-key";

/** IoT Core の LED 制御用 MQTT トピックプレフィックス */
const IOT_TOPIC_PREFIX = "smartled/esp32";

/** IoT Thing 名（ESP32 デバイスの識別子） */
const IOT_THING_NAME = "smartled-esp32";

/** IoT Policy 名（ESP32 が MQTT subscribe/receive できる権限） */
const IOT_POLICY_NAME = "SmartLedEsp32Policy";

/**
 * CDK コンテキストで Alexa Skill ID を渡す。
 * 例: cdk deploy -c alexaSkillId=amzn1.ask.skill.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
const CONTEXT_ALEXA_SKILL_ID = "alexaSkillId";

export class IoTBackendStack extends cdk.Stack {
  public readonly alexaLedHandler: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const region = this.region;
    const account = this.account;

    // -------------------------------------------------------------------------
    // Alexa Custom Skill ハンドラー Lambda
    // -------------------------------------------------------------------------
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

    this.alexaLedHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [`arn:aws:ssm:${region}:${account}:parameter${GEMINI_API_KEY_PARAM}`],
      })
    );
    this.alexaLedHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iot:DescribeEndpoint"],
        resources: ["*"],
      })
    );
    this.alexaLedHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iot:Publish"],
        resources: [`arn:aws:iot:${region}:${account}:topic/${IOT_TOPIC_PREFIX}/*`],
      })
    );

    const alexaSkillId = this.node.tryGetContext(CONTEXT_ALEXA_SKILL_ID) as string | undefined;
    if (alexaSkillId) {
      this.alexaLedHandler.addPermission("AlexaSkillInvoke", {
        principal: new iam.ServicePrincipal("alexa-appkit.amazon.com"),
        eventSourceToken: alexaSkillId,
      });
    }

    // -------------------------------------------------------------------------
    // IoT Core: ESP32 用 Thing と Policy
    // -------------------------------------------------------------------------
    const iotThing = new iot.CfnThing(this, "Esp32Thing", {
      thingName: IOT_THING_NAME,
    });

    const iotPolicy = new iot.CfnPolicy(this, "Esp32Policy", {
      policyName: IOT_POLICY_NAME,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: "iot:Connect",
            Resource: `arn:aws:iot:${region}:${account}:client/${IOT_THING_NAME}`,
          },
          {
            Effect: "Allow",
            Action: ["iot:Subscribe"],
            Resource: `arn:aws:iot:${region}:${account}:topicfilter/${IOT_TOPIC_PREFIX}/control`,
          },
          {
            Effect: "Allow",
            Action: ["iot:Receive"],
            Resource: `arn:aws:iot:${region}:${account}:topic/${IOT_TOPIC_PREFIX}/control`,
          },
        ],
      },
    });

    // -------------------------------------------------------------------------
    // IoT 証明書の生成・アタッチ・SSM 保存（CDK Custom Resource）
    // -------------------------------------------------------------------------
    const certManagerFn = new lambdaNodejs.NodejsFunction(this, "CertManager", {
      entry: "src/handlers/iot-cert-manager.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 128,
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node20",
      },
    });

    certManagerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "iot:CreateKeysAndCertificate",
          "iot:UpdateCertificate",
          "iot:DeleteCertificate",
          "iot:AttachPolicy",
          "iot:DetachPolicy",
          "iot:AttachThingPrincipal",
          "iot:DetachThingPrincipal",
        ],
        resources: ["*"],
      })
    );
    certManagerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:PutParameter", "ssm:GetParameter", "ssm:DeleteParameters"],
        resources: [`arn:aws:ssm:${region}:${account}:parameter/smartled/iot/*`],
      })
    );

    const certProvider = new cr.Provider(this, "CertProvider", {
      onEventHandler: certManagerFn,
    });

    const certResource = new cdk.CustomResource(this, "Esp32Certificate", {
      serviceToken: certProvider.serviceToken,
      properties: {
        ThingName: IOT_THING_NAME,
        PolicyName: IOT_POLICY_NAME,
      },
    });
    certResource.node.addDependency(iotThing);
    certResource.node.addDependency(iotPolicy);

    // -------------------------------------------------------------------------
    // CloudFormation 出力（デプロイ後の ESP32 設定に使用する値）
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, "IotThingName", {
      value: IOT_THING_NAME,
      description: "ESP32 Thing 名",
    });
    new cdk.CfnOutput(this, "CertPemParamName", {
      value: "/smartled/iot/cert-pem",
      description: "証明書 PEM の SSM パラメータ名（取得: aws ssm get-parameter --name /smartled/iot/cert-pem）",
    });
    new cdk.CfnOutput(this, "PrivateKeyParamName", {
      value: "/smartled/iot/private-key",
      description: "秘密鍵の SSM パラメータ名（取得: aws ssm get-parameter --name /smartled/iot/private-key --with-decryption）",
    });
    new cdk.CfnOutput(this, "MqttTopic", {
      value: `${IOT_TOPIC_PREFIX}/control`,
      description: "ESP32 がサブスクライブする MQTT トピック",
    });
  }
}
