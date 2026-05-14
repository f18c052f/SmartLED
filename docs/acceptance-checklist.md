# SmartLED 受け入れチェックリスト

`docs/requirements.md` の仕様に基づくビルド・デプロイ・動作確認のリスト。**使い方:** 節内の項目（C）→ 節の完了行（B）→ 全体サマリ（A）の順でチェックする。

---

## A. 全体サマリ

- [ ] **第0章** 事前準備
- [ ] **第1章** AWS バックエンド（PR-A）
- [ ] **第2章** ESP32 ブリッジ（PR-B）
- [ ] **第3章** WLED
- [ ] **第4章** Alexa スキル
- [ ] **第5章** E2E
- [ ] **第6章** 環境変更時
- [ ] **第7章** 完了宣言（DoD）

---

## 第0章 事前準備

- [ ] **第0章を完了した**

- [ ] AWS CLI が動く（`aws sts get-caller-identity` で想定アカウントが返る）
- [ ] PlatformIO CLI がある（`pio --version` で確認）
- [ ] Gemini API キーを取得済み（[Google AI Studio](https://aistudio.google.com/)）
- [ ] Alexa Developer アカウントがある
- [ ] WLED 用 ESP32（2 台目）と AM312・プッシュ SW・トグル SW の結線が済んでいる

---

## 第1章 AWS バックエンド（PR-A）

- [ ] **第1章を完了した**

### 1.1 デプロイ

```powershell
cd aws
$env:CDK_DEFAULT_REGION  = "ap-northeast-1"
$env:CDK_DEFAULT_ACCOUNT = (aws sts get-caller-identity --query Account --output text)
npx cdk deploy SmartLED-IoTBackend --region ap-northeast-1 --require-approval never --outputs-file cdk-outputs.json
```

- [ ] `npm ci` を実行した
- [ ] `npm run build && npm test` がすべて pass した
- [ ] `npm run lint && npm run format:check` が pass した
- [ ] Gemini API キーを SSM `/smartled/gemini-api-key` に保存した
- [ ] `npx cdk diff SmartLED-IoTBackend` で差分を目視した
- [ ] `npx cdk deploy SmartLED-IoTBackend` が成功した（`UPDATE_COMPLETE`）
- [ ] Outputs に `MqttTopicMode` / `MqttTopicState` がある

### 1.2 IoT Policy

- [ ] **1.2 節を完了した**

- [ ] `iot:Subscribe` / `iot:Receive` に `smartled/esp32/control` と `smartled/esp32/mode` がある
- [ ] `iot:Publish` に `smartled/esp32/state` がある

> 2.6 で ESP32 が正常に Subscribe・Publish できていれば間接確認済みとしてよい。

### 1.3 Lambda から MQTT

- [ ] **1.3 節を完了した**

- [ ] MQTT テストクライアントで `smartled/#` を Subscribe した
- [ ] Lambda コンソールでテストイベント `LaunchRequest` の応答にウェルカム文言がある
- [ ] テストイベント `PowerOnIntent` で `smartled/esp32/mode` に `AUTO` が届く
- [ ] テストイベント `PowerOffIntent` で `mode` に `STANDBY` が届く
- [ ] テストイベント `LightControlIntent`（`phrase` あり）で Gemini 経由の制御に至る
- [ ] `effectId` が `aws/src/lib/wled-effects.json` の許容 ID のみである

> テスト JSON は Alexa Developer Console の Test タブからコピーすると早い。

---

## 第2章 ESP32 ブリッジ（PR-B）

- [ ] **第2章を完了した**

### 2.1 設定ファイル

- [ ] **2.1 節を完了した**

- [ ] `esp32/secrets/certs.h` に AWS IoT の CRT / 秘密鍵 / CA を貼った
- [ ] `esp32/include/config.h.example` をコピーして `config.h` を作成し、WiFi・`AWS_IOT_ENDPOINT`・`WLED_IP` を設定した

### 2.2 ビルド・書き込み

- [ ] **2.2 節を完了した**

- [ ] `pio run -e smartled` が成功した
- [ ] `pio run -t upload` でブリッジ ESP32 に書き込んだ
- [ ] `pio device monitor -b 115200` でシリアルログを確認できる

### 2.3 起動ログ

- [ ] **2.3 節を完了した**

- [ ] `[BOOT] SmartLED bridge starting` が出る
- [ ] `[PWR] CPU=80MHz, BT=off` が出る
- [ ] `[GPIO] PIR=GPIO27` と `MODE_BTN=GPIO13` が出る
- [ ] `[WiFi] Connected` が出る
- [ ] `[PWR] WiFi sleep mode = MIN_MODEM` が出る
- [ ] `[WLED] ABL hw.led.maxpwr=4250 mA applied` が出る
- [ ] `[MQTT] Connected` が出る
- [ ] `[MQTT] Subscribed:` に `control` と `mode` が含まれる
- [ ] `[STATE] AUTO (trigger=MQTT_CONNECTED)` が出る
- [ ] `[BOOT] mode=AUTO, PIR warmup=... auto-off=...` が出る

### 2.4 PIR（AUTO モード）

> AM312 が接続されていない場合は正当に確認できない。センサ未接続のときは本節を保留にしてよい。

- [ ] **2.4 節を完了した**

- [ ] 起動 60 秒以内は PIR 検知で点灯しない（ウォームアップ）
- [ ] 60 秒後に AM312 を手で遮ると ON ログが出る（WLED 接続時は点灯する）
- [ ] 最終検知から 5 分後に OFF ログ・消灯する
- [ ] WLED 未接続時は `[WLED] API error` のみで継続動作する

### 2.5 プッシュスイッチ（GPIO13）

> スイッチが未接続でも、ジャンパ線で GND と GPIO13 を短絡すれば確認できる（短絡＝短押し、約 2 秒保持＝長押し）。

- [ ] **2.5 節を完了した**

- [ ] AUTO 中の短押しで STANDBY になる
- [ ] STANDBY 中の短押しで AUTO に戻る
- [ ] 長押し 2 秒で STANDBY になる
- [ ] STANDBY 中の長押しはモードが変わらない
- [ ] チャタリングしても 1 回だけ反応する

### 2.6 MQTT 受信（実機）

- [ ] **2.6 節を完了した**

- [ ] `smartled/esp32/state` を IoT テストクライアントで Subscribe した
- [ ] `smartled/esp32/control` に制御 JSON を発行し MANUAL 遷移ログがある
- [ ] `state` に `MANUAL` が届く
- [ ] `smartled/esp32/mode` に `{"mode":"AUTO"}` を発行すると遷移ログが一致する
- [ ] `{"mode":"STANDBY"}` を発行すると消灯する
- [ ] 不正 JSON は拒否ログのみで遷移しない

**確認用ペイロード:**

| トピック | ペイロード | 期待 |
|---|---|---|
| `smartled/esp32/mode` | `{"mode":"AUTO"}` | シリアルに遷移ログ、`state` に `"mode":"AUTO"` |
| `smartled/esp32/mode` | `{"mode":"STANDBY"}` | `[WLED] OFF applied`、`state` に `"mode":"STANDBY"` |
| `smartled/esp32/control` | `{"color":"#0088ff","brightness":300,"effectId":0}` | `[MQTT] Invalid control payload` のみ |

### 2.7 電流・ABL（`docs/requirements.md` §4）

> ABL は輝度からの推定値であり実測ではない。**最終保護は物理ヒューズ（系統ごと 5A）**。WLED 側で ABL を完全 OFF にしていると `syncWledAblOnBoot()` だけでは有効化されないため、必ず UI で確認すること。

- [ ] **2.7 節を完了した**

- [ ] LED 電源系統ごとに 5A ヒューズが入っている
- [ ] WLED Web UI の LED 設定で ABL が有効かつ上限が 4250mA 以下である（全バス）
- [ ] 2.3 起動ログに `[WLED] ABL hw.led.maxpwr=4250 mA applied` が出ている
- [ ] （任意）`GET http://<WLED_IP>/json/cfg` で `hw.led.maxpwr` と `ins[].maxpwr` が §4 と整合している

---

## 第3章 WLED（2 台目）

- [ ] **第3章を完了した**

### 3.1 ビルド・書き込み

- [ ] WLED ルートで `npm ci` → `npm run build` を実行した（`wled00/html_*.h` が生成される）
- [ ] `platformio_override.ini` に `default_envs = esp32dev` を記載した（`platformio.ini` は直接編集しない）
- [ ] PlatformIO で Build → SUCCESS になった
- [ ] Upload で 2 台目 ESP32 に書き込んだ

### 3.2 WiFi 設定

- [ ] 書き込み直後に `WLED-AP`（パスワード: `wled1234`）という Wi-Fi が表示された
- [ ] `WLED-AP` に接続し `http://4.3.2.1` を開いた
- [ ] Config → WiFi Setup で自宅 Wi-Fi の SSID / パスワードを入力し Save した
- [ ] WLED が自宅 LAN に接続し、mDNS（例: `http://wled-xxxxxx.local`）または ルータの DHCP 一覧で IP を確認した

### 3.3 静的 IP の設定（必須）

> DHCP では再起動のたびに WLED の IP が変わる可能性があります。
> ESP32 ブリッジの `config.h` に IP をハードコードしているため、**静的 IP の設定は必須**です。
> 設定しないと再起動後に通信が切れ、Alexa からの操作が届かなくなります。

- [ ] WLED Web UI（`http://<現在の IP>/`）を開いた
- [ ] **Config → WiFi Setup** を開いた
- [ ] 以下の静的 IP 設定を入力した

  | 項目 | 設定値の例 | 備考 |
  |------|-----------|------|
  | Static IP | `192.168.0.8` | ルータの DHCP 割り当て範囲**外**の未使用 IP を選ぶ |
  | Static Gateway | `192.168.0.1` | ルータの IP（`ipconfig` / `ip route` で確認） |
  | Static Subnet | `255.255.255.0` | 通常の家庭環境はこの値 |

  > **IP 競合に注意:** ルータの DHCP リースから IP 一覧を確認し、他のデバイスが使っていない IP を選んでください。使用中の IP を指定すると WLED が接続できなくなります。

- [ ] **Save & Connect** を押し、設定した静的 IP（例: `http://192.168.0.8`）で Web UI が開くことを確認した
- [ ] `config.h` の `WLED_IP` に上記の静的 IP を設定した（`config.h` と WLED の IP が一致していること）

### 3.4 動作確認

- [ ] Web UI で手動色変更・エフェクト変化を確認した
- [ ] ESP32 ブリッジ（1 台目）を静的 IP に合わせた `config.h` で再ビルド・再書き込みした
- [ ] 2.3 起動ログに `[WLED] ABL hw.led.maxpwr=4250 mA applied` が出た（ABL 同期が通っていることを確認）

---

## 第4章 Alexa スキル

- [ ] **第4章を完了した**

- [ ] [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask) にログインした
- [ ] スキルを開いた（ja-JP / Custom / Own backend）
- [ ] `docs/alexa/interaction-model.ja-JP.json` の `interactionModel` を JSON Editor に貼り Build Model が成功した
- [ ] Endpoint に Lambda ARN を設定した
- [ ] Lambda に Alexa Skills Kit トリガがある

> `alexaSkillId` なしの `cdk deploy` だけだと Alexa からの呼び出し権限が外れることがある。必ず `-c alexaSkillId=<スキルID>` を付けて再デプロイすること。

- [ ] Test タブで確認した
  - [ ] 「ライトをつけて」→ `AUTO` 系 MQTT またはログで確認できる
  - [ ] 「ライトを消して」→ `STANDBY` が確認できる
  - [ ] 「ライトを読書モードにして」等のシーン指定が疎通した
  - [ ] 「ヘルプ」→ MQTT は飛ばず案内のみ
  - [ ] 「やめて」→ MQTT は飛ばず終了挨拶
- [ ] 実機 Echo で同様に確認した

---

## 第5章 E2E

- [ ] **第5章を完了した**

- [ ] IoT から `control` を発行し数秒で WLED の色が変わる
- [ ] Alexa で読書モードと言い LED が意図どおりになる
- [ ] Alexa でオンと言い PIR で既定シーンが点灯する
- [ ] PIR 5 分無人で消灯する
- [ ] プッシュ長押しで STANDBY のあとも Alexa で上書きできる
- [ ] 物理トグル OFF/ON 後、起動は AUTO から始まる

---

## 第6章 環境変更時

- [ ] **第6章を完了した**

- [ ] `config.h` の WiFi SSID / パスワードを新環境に更新した
- [ ] WLED の WiFi を新環境に再設定した（WLED-AP から再設定）
- [ ] **WLED の静的 IP を新環境 LAN に合わせて再設定した**（第3章 §3.3 参照、固定 IP は必須）
- [ ] 1 台目を再ビルド・再書き込みした
- [ ] 第5章 E2E を新環境で再実施した

---

## 第7章 完了宣言（DoD）

- [ ] **第7章を完了した**

- [ ] 第1章を完了した
- [ ] 第2章を完了した
- [ ] 第3章を完了した
- [ ] 第4章を完了した
- [ ] 第5章を完了した
- [ ] 不具合・仕様差分は Issue または `docs/requirements.md` に反映済みである

---

## 参考

- 仕様: `docs/requirements.md`（制御モード・MQTT・省電力・ABL など）
- ルール: `.cursor/rules/000-agent-domain.mdc` / `100-aws-backend.mdc` / `200-esp32-device.mdc`
