# ESP32 LED Bookshelf IoT Control System (要件定義書)

## 1. プロジェクトの目的

本プロジェクトは、日常的な自動制御と、自然言語を通じた高度な演出を両立する「DIYスマート本棚」を構築することを目的とする。

## 2. 背景・解決する課題

- 通常のLED照明では、単調な点灯・消灯しかできず、空間の演出性に欠ける。
- 音声アシスタント（Alexa）による定型操作だけでなく、「読書に集中したい」「リラックスできる青っぽい光にして」といった曖昧な指示（自然言語）をGemini APIで解釈し、動的にライティングへ反映させる体験を実現する。

## 3. BOM（部品表・前提ハードウェア）

- **マイコン:** ESP32
- **照明:** アドレス指定可能LEDテープ（WS2812B等）
- **センサー:** 人感センサー（PIRセンサー等）
- **主電源:** MEAN WELL LRS-75-5（5V 15A / 75W）
- **ファームウェア:** WLED（またはMQTT通信可能なカスタムファームウェア）

## 4. ハードウェア制約と安全仕様（BOM準拠）

> この仕様はすべてのAI生成コード・設定値に強制適用される。

- **主電源:** MEAN WELL LRS-75-5（5V 15A 容量）
- **過電流保護（物理）:** LED系統ごとに **5A** のガラス管ヒューズ（または平型ヒューズ）を挿入すること。
- **過電流保護（ソフトウェア）:** WLEDのABL（Automatic Brightness Limiter）機能を用いて、1ポート（1系統）あたりの最大電流値を **4250mA**（5Aヒューズに対して15%の安全マージン）に制限すること。これにより、突入電流や瞬間的な全白点灯時でも5Aヒューズの溶断を防ぐ。
- **AIコード生成の禁止事項:** `abl.mA` が **4250** を超える値を含む設定JSON、コード、提案を生成してはならない。

## 5. システムアーキテクチャとデータフロー

システムは、エッジデバイス（ESP32）とクラウド（AWS）のハイブリッド構成をとる。

1. **日常制御フロー:**
   - ESP32 (人感センサー検知) -> 直接LED点灯/消灯制御（エッジ完結）
2. **高度演出フロー:**
   - ユーザー発話 -> Amazon Alexa (Custom Skill / Smart Home Skill)
   - Alexa -> AWS Lambda (TypeScript) にリクエスト送信
   - AWS Lambda -> Gemini API に自然言語を渡し、最適なLEDパラメータ（色、エフェクト、輝度）をJSONで取得
   - AWS Lambda -> AWS IoT Core (MQTT) へ制御メッセージをパブリッシュ
   - AWS IoT Core -> ESP32 (MQTT Subscriber) がメッセージを受信し、WLEDのAPIを叩いて状態を変更

## 6. Monorepoディレクトリ構造

```text
project-root/
├── .cursor/               # Cursorエディタ用設定・ルール
├── docs/                  # 仕様書、設計ドキュメント
├── aws/                   # AWSクラウドバックエンド (CDK / Lambda)
│   ├── bin/               # CDKエントリーポイント
│   ├── lib/               # CDKスタック定義
│   ├── src/               # Lambda関数ソースコード (TypeScript)
│   └── package.json
└── esp32/                 # エッジデバイス用コード (Arduino / PlatformIO)
    ├── src/
    └── platformio.ini
```
