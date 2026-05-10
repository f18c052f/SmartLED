#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { IoTBackendStack } from "../lib/iot-backend-stack";

const app = new cdk.App();
new IoTBackendStack(app, "SmartLED-IoTBackend", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
