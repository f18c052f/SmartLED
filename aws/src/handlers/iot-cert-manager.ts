import {
  IoTClient,
  CreateKeysAndCertificateCommand,
  AttachPolicyCommand,
  AttachThingPrincipalCommand,
  DetachPolicyCommand,
  DetachThingPrincipalCommand,
  UpdateCertificateCommand,
  DeleteCertificateCommand,
} from "@aws-sdk/client-iot";
import {
  SSMClient,
  PutParameterCommand,
  GetParameterCommand,
  DeleteParametersCommand,
} from "@aws-sdk/client-ssm";

const iotClient = new IoTClient({});
const ssmClient = new SSMClient({});

/** SSM Parameter Store に保存する証明書関連パラメータ名 */
const SSM_CERT_PEM = "/smartled/iot/cert-pem";
const SSM_PRIVATE_KEY = "/smartled/iot/private-key";
const SSM_CERT_ARN = "/smartled/iot/cert-arn";

/** CDK Custom Resource イベント型 */
interface CertManagerEvent {
  RequestType: "Create" | "Update" | "Delete";
  PhysicalResourceId?: string;
  ResourceProperties: {
    ThingName: string;
    PolicyName: string;
  };
}

/** CDK Custom Resource レスポンス型 */
interface CertManagerResponse {
  PhysicalResourceId: string;
  Data?: { CertificateArn: string; CertificateId: string };
}

/**
 * IoT 証明書のライフサイクル（作成・削除）を管理する CDK Custom Resource ハンドラー。
 *
 * Create: 証明書生成 → Policy/Thing にアタッチ → SSM に保存
 * Update: 証明書のローテーションは非対応（既存 ID をそのまま返す）
 * Delete: SSM 削除 → デタッチ → 証明書の無効化・削除
 */
export const handler = async (event: CertManagerEvent): Promise<CertManagerResponse> => {
  const { ThingName, PolicyName } = event.ResourceProperties;

  switch (event.RequestType) {
    case "Create": {
      const certRes = await iotClient.send(
        new CreateKeysAndCertificateCommand({ setAsActive: true })
      );
      const certId = certRes.certificateId!;
      const certArn = certRes.certificateArn!;
      const certPem = certRes.certificatePem!;
      const privateKey = certRes.keyPair!.PrivateKey!;

      await iotClient.send(new AttachPolicyCommand({ policyName: PolicyName, target: certArn }));
      await iotClient.send(
        new AttachThingPrincipalCommand({ thingName: ThingName, principal: certArn })
      );

      await ssmClient.send(
        new PutParameterCommand({
          Name: SSM_CERT_PEM,
          Value: certPem,
          Type: "String",
          Overwrite: true,
        })
      );
      await ssmClient.send(
        new PutParameterCommand({
          Name: SSM_PRIVATE_KEY,
          Value: privateKey,
          Type: "SecureString",
          Overwrite: true,
        })
      );
      await ssmClient.send(
        new PutParameterCommand({
          Name: SSM_CERT_ARN,
          Value: certArn,
          Type: "String",
          Overwrite: true,
        })
      );

      console.log(
        JSON.stringify({ level: "INFO", message: "Certificate created", certId, certArn })
      );

      return {
        PhysicalResourceId: certId,
        Data: { CertificateArn: certArn, CertificateId: certId },
      };
    }

    case "Update":
      console.log(
        JSON.stringify({
          level: "INFO",
          message: "Update: no-op (certificate rotation not supported)",
        })
      );
      return { PhysicalResourceId: event.PhysicalResourceId! };

    case "Delete": {
      const certId = event.PhysicalResourceId!;

      let certArn: string;
      try {
        const param = await ssmClient.send(new GetParameterCommand({ Name: SSM_CERT_ARN }));
        certArn = param.Parameter!.Value!;
      } catch {
        console.log(
          JSON.stringify({
            level: "WARN",
            message: "SSM parameter not found, skipping cert cleanup",
          })
        );
        return { PhysicalResourceId: certId };
      }

      try {
        await iotClient.send(new DetachPolicyCommand({ policyName: PolicyName, target: certArn }));
      } catch {
        console.log(
          JSON.stringify({ level: "WARN", message: "DetachPolicy skipped (already detached)" })
        );
      }
      try {
        await iotClient.send(
          new DetachThingPrincipalCommand({ thingName: ThingName, principal: certArn })
        );
      } catch {
        console.log(
          JSON.stringify({
            level: "WARN",
            message: "DetachThingPrincipal skipped (already detached)",
          })
        );
      }

      await iotClient.send(
        new UpdateCertificateCommand({ certificateId: certId, newStatus: "INACTIVE" })
      );
      await iotClient.send(new DeleteCertificateCommand({ certificateId: certId }));
      await ssmClient.send(
        new DeleteParametersCommand({ Names: [SSM_CERT_PEM, SSM_PRIVATE_KEY, SSM_CERT_ARN] })
      );

      console.log(JSON.stringify({ level: "INFO", message: "Certificate deleted", certId }));
      return { PhysicalResourceId: certId };
    }
  }
};
