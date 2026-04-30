import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
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
      Runtime: "nodejs22.x",
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
  // IoT Policy: control + mode を Subscribe/Receive、state を Publish
  // -------------------------------------------------------------------------
  test("IoT Policy allows Subscribe to control and mode topics", () => {
    template.hasResourceProperties("AWS::IoT::Policy", {
      PolicyName: "SmartLedEsp32Policy",
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: ["iot:Subscribe"],
            Resource: Match.arrayWith([
              Match.stringLikeRegexp("topicfilter/smartled/esp32/control$"),
              Match.stringLikeRegexp("topicfilter/smartled/esp32/mode$"),
            ]),
          }),
        ]),
      },
    });
  });

  test("IoT Policy allows Receive on control and mode topics", () => {
    template.hasResourceProperties("AWS::IoT::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: ["iot:Receive"],
            Resource: Match.arrayWith([
              Match.stringLikeRegexp("topic/smartled/esp32/control$"),
              Match.stringLikeRegexp("topic/smartled/esp32/mode$"),
            ]),
          }),
        ]),
      },
    });
  });

  test("IoT Policy allows ESP32 to Publish state topic", () => {
    template.hasResourceProperties("AWS::IoT::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: ["iot:Publish"],
            Resource: Match.stringLikeRegexp("topic/smartled/esp32/state$"),
          }),
        ]),
      },
    });
  });

  // -------------------------------------------------------------------------
  // IoT 証明書マネージャー Lambda
  // -------------------------------------------------------------------------
  test("CertManager Lambda is created with correct timeout", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Timeout: 60,
      MemorySize: 128,
    });
  });

  // -------------------------------------------------------------------------
  // CloudFormation 出力
  // -------------------------------------------------------------------------
  test("CloudFormation outputs include MQTT topics for all 3 directions", () => {
    template.hasOutput("MqttTopic", {
      Value: "smartled/esp32/control",
    });
    template.hasOutput("MqttTopicMode", {
      Value: "smartled/esp32/mode",
    });
    template.hasOutput("MqttTopicState", {
      Value: "smartled/esp32/state",
    });
    template.hasOutput("CertPemParamName", {
      Value: "/smartled/iot/cert-pem",
    });
    template.hasOutput("PrivateKeyParamName", {
      Value: "/smartled/iot/private-key",
    });
  });
});
