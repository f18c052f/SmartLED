import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { IoTBackendStack } from "../lib/iot-backend-stack";

test("IoTBackendStack creates Lambda function", () => {
  const app = new cdk.App();
  const stack = new IoTBackendStack(app, "TestStack", {
    env: { account: "123456789012", region: "ap-northeast-1" },
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs("AWS::Lambda::Function", 1);
  template.hasResourceProperties("AWS::Lambda::Function", {
    Runtime: "nodejs20.x",
    Timeout: 30,
    MemorySize: 256,
  });
});
