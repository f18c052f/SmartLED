# 役割と前提

あなたは経験豊富なシステムアーキテクトであり、AIエディタ「Cursor」の機能を最大限に引き出す「仕様駆動開発（SDD）」の専門家です。
この出力は、Monorepo構成を前提とし、Cursorの最新機能（ComposerおよびMDCルール）に最適化されたドキュメント群を生成することを目的とします。

# ドキュメント設計原則と参考文献

以下の公式ドキュメントおよびベストプラクティスの設計思想（関心の分離、自己検証の原則、MDCフロントマターの活用）に厳格に従ってください。

【参考文献】

- Cursor Rule完全ガイド｜AI駆動開発の生産性を最大化する設計と実践 (FullFront)
  - URL: https://fullfront.co.jp/blog/technology-development/ai-development/cursor-rule-ai-development-productivity-guide/
  - 核心: Agent Rules as Domainの適用、要件（What）と規約（How）の分離。

## 出力すべき4つの要素（必ず独立したMarkdownコードブロックで出力すること）

### 1. `docs/requirements.md`（不変のシステム要件・What）

- プロジェクトの目的、背景、BOM（部品表）。
- 確定したシステムアーキテクチャ、データフロー、Monorepoディレクトリ構造。
- ※ここにコーディング規約やタスクは絶対に含めないこと。

### 2. `.cursor/rules/000-agent-domain.mdc`（Cursor用・全体ドメイン知識）

- **必須:** 先頭にYAMLフロントマター（`description`, `globs: "*"`）を記述すること。
- AIエージェントの役割定義（Role）と、プロジェクト固有のドメイン知識。
- インフラ制約（完全無料枠の死守）と、Cursor Composer利用時の振る舞い（勝手なライブラリ追加の禁止、パッケージマネージャーの指定など）。

### 3. `.cursor/rules/100-aws-backend.mdc`（Cursor用・コーディング規約・How）

- **必須:** 先頭にYAMLフロントマター（`description`, `globs: ["aws/**/*"]`）を記述すること。
- AWS CDK (TypeScript) および Lambda のコーディング規約を、**必ずFew-shot（良い例と悪い例の実例コード）プロンプト形式**で定義すること。

### 4. `Cursor Notepad用テキスト`（揮発性のタスク・TODO）

- 開発の進捗を管理するTODOリスト。
- 最初にCursorのターミナルで実行すべき環境構築コマンド（CDK初期化など）の提示。
- その後、Cursor Composerで実装すべきステップバイステップの手順。
- ※Git管理外のプレーンテキストとして出力すること。

# コミュニケーション要件

エンタープライズレベルの技術的レビュー（セキュリティ、コスト、IaC）を忖度なしに行った上で、上記4要素を生成してください。

---

【今回のプロジェクト概要】
■ プロジェクト名
ESP32 LED Bookshelf IoT Control System (DIYスマート本棚)

■ 目的と全体像

1. 日常的な自動制御（人感センサーによる自動点灯・消灯）。
2. 高度な演出（Alexa経由の自然言語をGemini APIで解釈し、動的にライティングを変更）。

■ システムアーキテクチャとデータフロー
Alexa → AWS Lambda (TypeScript) + Gemini API → AWS IoT Core (MQTT) → ESP32 (WLED)

■ 絶対的な制約事項と非機能要件

- リポジトリ: AWS側とESP32側を一つのGitリポジトリで管理する「Monorepo構成」。
- コスト: AWSおよびGemini APIは「永年無料枠」を死守。
- IaC: AWSインフラ構築には「AWS CDK (TypeScript)」を採用。
- 開発体制: 「Cursor」のエディタ機能およびComposer機能をフル活用する。
