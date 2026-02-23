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
| `npx cdk deploy` | スタックをデプロイ |
| `npx cdk diff` | デプロイ済みスタックとの差分を表示 |

## Phase 3: Alexa スキル連携

Alexa Developer Console でスキルを作成したら、**Skill ID**（`amzn1.ask.skill.xxxxxxxx-...`）を控え、デプロイ時にコンテキストで渡す。

```bash
npx cdk deploy -c alexaSkillId=amzn1.ask.skill.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

これで Lambda のリソースポリシーに「このスキルからのみ Invoke を許可」が追加される。  
Skill ID を渡さずにデプロイした場合は、Alexa からの呼び出し許可は付与されない（既存の許可は変更されない）。
