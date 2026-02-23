import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { IoTBackendStack } from "../lib/iot-backend-stack";

const makeStack = () => {
  const app = new cdk.App();
  return new IoTBackendStack(app, "TestStack", {
    env: { account: "123456789012", region: "ap-northeast-1" },
  });
};

describe("IoTBackendStack", () => {
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(makeStack());
  });

  // -------------------------------------------------------------------------
  // Alexa Lambda ハンドラー
  // -------------------------------------------------------------------------
  test("Alexa Lambda function is created with correct properties", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs20.x",
      Timeout: 30,
      MemorySize: 256,
    });
  });

  // -------------------------------------------------------------------------
  // IoT Thing
  // -------------------------------------------------------------------------
  test("IoT Thing is created with correct name", () => {
    template.resourceCountIs("AWS::IoT::Thing", 1);
    template.hasResourceProperties("AWS::IoT::Thing", {
      ThingName: "smartled-esp32",
    });
  });

  // -------------------------------------------------------------------------
  // IoT Policy
  // -------------------------------------------------------------------------
  test("IoT Policy is created with Connect / Subscribe / Receive permissions", () => {
    template.resourceCountIs("AWS::IoT::Policy", 1);
    template.hasResourceProperties("AWS::IoT::Policy", {
      PolicyName: "SmartLedEsp32Policy",
      PolicyDocument: {
        Statement: [
          {
            Effect: "Allow",
            Action: "iot:Connect",
          },
          {
            Effect: "Allow",
            Action: ["iot:Subscribe"],
          },
          {
            Effect: "Allow",
            Action: ["iot:Receive"],
          },
        ],
      },
    });
  });

  // -------------------------------------------------------------------------
  // IoT 証明書マネージャー Lambda
  // -------------------------------------------------------------------------
  test("CertManager Lambda is created with correct timeout", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs20.x",
      Timeout: 60,
      MemorySize: 128,
    });
  });

  // -------------------------------------------------------------------------
  // CloudFormation 出力
  // -------------------------------------------------------------------------
  test("CloudFormation outputs include MQTT topic and SSM param names", () => {
    template.hasOutput("MqttTopic", {
      Value: "smartled/esp32/control",
    });
    template.hasOutput("CertPemParamName", {
      Value: "/smartled/iot/cert-pem",
    });
    template.hasOutput("PrivateKeyParamName", {
      Value: "/smartled/iot/private-key",
    });
  });
});
