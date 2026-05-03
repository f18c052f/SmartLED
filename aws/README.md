# SmartLED AWS Backend (CDK + Lambda)

ESP32 LED Bookshelf IoT 制御システムの AWS クラウドバックエンド。  
Alexa → Lambda → Gemini API → IoT Core (MQTT) → ESP32 のフローを実現する Phase 1 基盤。

## 構成

- **IoTBackendStack**: Lambda (Alexa ハンドラ) + SSM/IoT 権限
- **Lambda**: `src/handlers/alexa-led-control.ts` — Alexa リクエスト処理、Gemini API 呼び出し、IoT Core パブリッシュ

## デプロイ前の準備

1. **SSM Parameter Store に Gemini API キーを登録**

   ```bash
   aws ssm put-parameter \
     --name "/smartled/gemini-api-key" \
     --value "YOUR_GEMINI_API_KEY" \
     --type "SecureString"
   ```

2. **依存関係のインストール**

   ```bash
   npm install
   ```

## コマンド

| コマンド | 説明 |
|---------|------|
| `npm run build` | TypeScript をコンパイル |
| `npm run watch` | 変更を監視してコンパイル |
| `npm run test` | Jest でユニットテスト実行 |
| `npx cdk synth` | CloudFormation テンプレートを生成 |
| `npx cdk deploy <スタック名>` | 対象スタックをデプロイ（下記「CDK デプロイ」を参照） |
| `npx cdk diff <スタック名>` | デプロイ済みスタックとの差分を表示 |

## CDK デプロイ（スタック名・リージョン・環境変数）

`bin/aws.ts` のスタック ID は **`SmartLED-IoTBackend`**。スタックの `env` は **`CDK_DEFAULT_ACCOUNT`** と **`CDK_DEFAULT_REGION`** を参照する。未設定だと Synth / Deploy が失敗することがあるため、デプロイ前にターミナルで設定する。

**PowerShell の例（`ap-northeast-1`、アカウントは CLI から自動取得）:**

```powershell
$env:CDK_DEFAULT_REGION  = "ap-northeast-1"
$env:CDK_DEFAULT_ACCOUNT = (aws sts get-caller-identity --query Account --output text)
npx cdk diff SmartLED-IoTBackend
npx cdk deploy SmartLED-IoTBackend --region ap-northeast-1 --require-approval never --outputs-file cdk-outputs.json
```

**Bash の例:**

```bash
export CDK_DEFAULT_REGION=ap-northeast-1
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
npx cdk diff SmartLED-IoTBackend
npx cdk deploy SmartLED-IoTBackend --region ap-northeast-1 --require-approval never --outputs-file cdk-outputs.json
```

| オプション / 引数 | 用途 |
|-------------------|------|
| `SmartLED-IoTBackend` | デプロイ対象スタック。**省略すると対話プロンプトや別スタックになる**ため明示推奨。 |
| `--region ap-northeast-1` | このプロジェクトの想定リージョンと揃える。 |
| `--require-approval never` | IAM 変更の承認プロンプトを出さない（CI や慣れた環境向け）。 |
| `--outputs-file cdk-outputs.json` | CloudFormation 出力を JSON で保存（任意）。 |

初回のみ **`cdk bootstrap`** が必要な場合:

```bash
npx cdk bootstrap aws://${CDK_DEFAULT_ACCOUNT}/ap-northeast-1
```

## Phase 3: Alexa スキル連携

Alexa Developer Console でスキルを作成したら、**Skill ID**（`amzn1.ask.skill.xxxxxxxx-...`）を控え、デプロイ時にコンテキストで渡す。

```bash
npx cdk deploy SmartLED-IoTBackend \
  --region ap-northeast-1 \
  --require-approval never \
  -c alexaSkillId=amzn1.ask.skill.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

これで Lambda のリソースポリシーに「このスキルからのみ Invoke を許可」が追加される。  
Skill ID を渡さずにデプロイした場合は、Alexa からの呼び出し許可は付与されない（既存の許可は変更されない）。
