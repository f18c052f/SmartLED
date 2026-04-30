# Alexa Custom Skill 設定

このディレクトリには Alexa Developer Console に登録する設定資料を置きます。

## ファイル一覧

| ファイル | 用途 |
|----------|------|
| `interaction-model.ja-JP.json` | 対話モデル（日本語ロケール）。Console の JSON Editor にそのまま貼り付け |

## 適用手順

1. [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask) にログイン
2. SmartLED スキルを開く（または新規作成。Custom Skill / 言語: Japanese (JP) / Backend: Provision your own）
3. 左メニュー **Build → Interaction Model → JSON Editor**
4. `interaction-model.ja-JP.json` の `interactionModel` キー以下を丸ごと貼り付け
5. **Save Model** → **Build Model**（Build 完了まで数分待つ）
6. 左メニュー **Build → Endpoint** で AWS Lambda の ARN を設定
   - ARN は `aws/` ディレクトリで `npx cdk deploy` 後に CloudFormation 出力 / Lambda コンソールから取得
7. **Test** タブで以下を確認:
   - 「ライトを読書モードにして」 → `LightControlIntent` 発火、Gemini → control + mode=MANUAL publish
   - 「ライトをつけて」 → `PowerOnIntent` 発火、mode=AUTO publish
   - 「ライトを消して」 → `PowerOffIntent` 発火、mode=STANDBY publish

## 参考

- 仕様: `docs/requirements.md` §7-§9
- Lambda 実装: `aws/src/handlers/alexa-led-control.ts`
- ルール: `.cursor/rules/100-aws-backend.mdc` §5
