// =============================================================================
// SmartLED ブリッジ ESP32
//
// 役割:
//   - AWS IoT Core から MQTT で control / mode を受信
//   - AM312 PIR と プッシュスイッチを GPIO 割り込みで監視
//   - AUTO/MANUAL/STANDBY の3モードで状態管理し、WLED の JSON API を直叩き
//   - 状態変化時のみ smartled/esp32/state にパブリッシュ
//
// 設計の真実のソース:
//   - docs/requirements.md §7-§11
//   - .cursor/rules/200-esp32-device.mdc
// =============================================================================

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>

#include "config.h"
#include "../secrets/certs.h"

// WLED ABL 同期（config.h 未記載の既存環境向けデフォルト）
#ifndef WLED_ABL_MAX_MILLIAMPS
#define WLED_ABL_MAX_MILLIAMPS 4250
#endif
#ifndef WLED_SYNC_ABL_ON_BOOT
#define WLED_SYNC_ABL_ON_BOOT 1
#endif

// -----------------------------------------------------------------------------
// クライアント
// -----------------------------------------------------------------------------
WiFiClientSecure wifiSecureClient;
PubSubClient mqttClient(wifiSecureClient);

// -----------------------------------------------------------------------------
// 制御モード（requirements.md §7）
// -----------------------------------------------------------------------------
enum class Mode { AUTO, MANUAL, STANDBY };
static Mode currentMode = Mode::AUTO;

const char* modeToCStr(Mode m) {
  switch (m) {
    case Mode::AUTO:    return "AUTO";
    case Mode::MANUAL:  return "MANUAL";
    case Mode::STANDBY: return "STANDBY";
  }
  return "UNKNOWN";
}

// -----------------------------------------------------------------------------
// PIR 状態（割り込み駆動）
// -----------------------------------------------------------------------------
static volatile unsigned long pirLastIsrAt = 0;
static volatile bool          pirRiseFlag  = false;

static unsigned long bootAt        = 0;
static unsigned long lastMotionAt  = 0;
static bool          ledIsOn       = false;  // PIR で点灯中かどうか（AUTO 用）

// -----------------------------------------------------------------------------
// プッシュSW 状態（割り込み駆動）
// -----------------------------------------------------------------------------
static volatile unsigned long btnLastIsrAt = 0;
static volatile bool          btnIsrFlag   = false;

static int           btnLastStableLevel = HIGH;
static unsigned long btnPressStartAt    = 0;
static bool          btnLongFired       = false;

// -----------------------------------------------------------------------------
// 直近 publish した状態（変化時のみ送信するため保持）
// -----------------------------------------------------------------------------
static Mode         lastPublishedMode    = Mode::AUTO;
static const char*  lastPublishedTrigger = "BOOT";
static bool         hasPublishedOnce     = false;

// -----------------------------------------------------------------------------
// 関数宣言
// -----------------------------------------------------------------------------
void connectWiFi();
void connectMqtt();
void onMqttMessage(const char* topic, byte* payload, unsigned int length);
void handlePir();
void handleButton();
void onShortPress();
void onLongPress();
void setMode(Mode next, const char* trigger);
void publishStateIfChanged(const char* trigger);
void applyDefaultScene();
void applyOff();
void applyLedParams(int r, int g, int b, int brightness, int effectId);
void syncWledAblOnBoot();

// =============================================================================
// ISR
// =============================================================================
void IRAM_ATTR onPirIsr() {
  pirLastIsrAt = millis();
  pirRiseFlag  = true;
}

void IRAM_ATTR onBtnIsr() {
  btnLastIsrAt = millis();
  btnIsrFlag   = true;
}

// =============================================================================
// setup / loop
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.println();
  Serial.println("[BOOT] SmartLED bridge starting");

  // 省電力初期化（requirements.md §11）
  setCpuFrequencyMhz(80);
  btStop();
  Serial.printf("[PWR] CPU=%uMHz, BT=off\n", getCpuFrequencyMhz());

  // GPIO 入力 + 割り込み登録
  pinMode(PIR_PIN, INPUT);
  pinMode(MODE_BTN_PIN, INPUT_PULLUP);
  bootAt = millis();
  attachInterrupt(digitalPinToInterrupt(PIR_PIN), onPirIsr, RISING);
  attachInterrupt(digitalPinToInterrupt(MODE_BTN_PIN), onBtnIsr, CHANGE);
  Serial.printf("[GPIO] PIR=GPIO%d (RISING), MODE_BTN=GPIO%d (CHANGE)\n",
                PIR_PIN, MODE_BTN_PIN);

  // WiFi 接続
  connectWiFi();
  WiFi.setSleep(WIFI_PS_MIN_MODEM);  // Modem Sleep を有効化（MQTT 接続は維持）
  Serial.println("[PWR] WiFi sleep mode = MIN_MODEM");

  // WLED ABL 上限（requirements.md §4）を RAM に同期（MQTT より先に実施）
  syncWledAblOnBoot();

  // 起動時に WLED を必ず消灯状態にリセット
  // WLED は電源投入時に前回の点灯状態を NVRAM から復元するため、
  // ブリッジが applyOff() を送らないと PIR 検知前から LED が光り続ける
  applyOff();
  Serial.println("[BOOT] LED reset to OFF (waiting for PIR or command)");

  // TLS とサーバー設定
  wifiSecureClient.setCACert(AWS_CERT_CA);
  wifiSecureClient.setCertificate(AWS_CERT_CRT);
  wifiSecureClient.setPrivateKey(AWS_CERT_PRIVATE);

  mqttClient.setServer(AWS_IOT_ENDPOINT, AWS_IOT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(512);
  mqttClient.setKeepAlive(MQTT_KEEPALIVE_SEC);

  connectMqtt();

  Serial.printf("[BOOT] mode=%s, PIR warmup=%lums, auto-off=%lums\n",
                modeToCStr(currentMode), PIR_WARMUP_MS, AUTO_OFF_MS);
}

void loop() {
  if (!mqttClient.connected()) {
    connectMqtt();
  }
  mqttClient.loop();

  handleButton();
  handlePir();

  // 100ms 周期で十分（ボタンデバウンス 30ms / 長押し 2000ms に対する精度は十分）
  delay(LOOP_INTERVAL_MS);
}

// =============================================================================
// WiFi
// =============================================================================
void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start   = millis();
  unsigned long lastLog = 0;
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > 20000) {
      Serial.printf("[WiFi] Timeout (last status=%d). Restarting...\n", WiFi.status());
      ESP.restart();
    }
    if (millis() - lastLog >= 3000) {
      lastLog = millis();
      int s = WiFi.status();
      const char* msg =
        (s == WL_IDLE_STATUS)     ? "IDLE" :
        (s == WL_NO_SSID_AVAIL)   ? "NO_SSID_AVAIL (SSID未検出)" :
        (s == WL_SCAN_COMPLETED)  ? "SCAN_COMPLETED" :
        (s == WL_CONNECT_FAILED)  ? "CONNECT_FAILED (パスワード誤り?)" :
        (s == WL_CONNECTION_LOST) ? "CONNECTION_LOST" :
        (s == WL_DISCONNECTED)    ? "DISCONNECTED" : "OTHER";
      Serial.printf("[WiFi] status=%d (%s)\n", s, msg);
    }
    delay(500);
  }
  Serial.printf("[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
}

// =============================================================================
// MQTT
// =============================================================================
void connectMqtt() {
  static unsigned long lastAttempt = 0;
  if (millis() - lastAttempt < MQTT_RECONNECT_INTERVAL_MS) return;
  lastAttempt = millis();

  Serial.printf("[MQTT] Connecting to %s\n", AWS_IOT_ENDPOINT);
  if (mqttClient.connect(AWS_IOT_CLIENT_ID)) {
    Serial.println("[MQTT] Connected");
    mqttClient.subscribe(MQTT_TOPIC_CONTROL);
    mqttClient.subscribe(MQTT_TOPIC_MODE);
    Serial.printf("[MQTT] Subscribed: %s, %s\n",
                  MQTT_TOPIC_CONTROL, MQTT_TOPIC_MODE);
    publishStateIfChanged("MQTT_CONNECTED");
  } else {
    Serial.printf("[MQTT] Failed (state=%d), retrying in %lums\n",
                  mqttClient.state(), MQTT_RECONNECT_INTERVAL_MS);
  }
}

void onMqttMessage(const char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.printf("[MQTT] JSON parse error on %s: %s\n", topic, error.c_str());
    return;
  }

  // ---- mode トピック ----
  if (strcmp(topic, MQTT_TOPIC_MODE) == 0) {
    const char* modeStr = doc["mode"];
    if (!modeStr) {
      Serial.println("[MQTT] mode payload missing 'mode' field");
      return;
    }
    if      (strcmp(modeStr, "AUTO")    == 0) setMode(Mode::AUTO,    "MQTT_MODE");
    else if (strcmp(modeStr, "MANUAL")  == 0) setMode(Mode::MANUAL,  "MQTT_MODE");
    else if (strcmp(modeStr, "STANDBY") == 0) setMode(Mode::STANDBY, "MQTT_MODE");
    else                                      Serial.printf("[MQTT] Unknown mode: %s\n", modeStr);
    return;
  }

  // ---- control トピック ----
  if (strcmp(topic, MQTT_TOPIC_CONTROL) == 0) {
    const char* color    = doc["color"];     // "#rrggbb"
    int brightness       = doc["brightness"] | -1;
    int effectId         = doc["effectId"]   | -1;

    if (!color || brightness < 0 || brightness > 255 || effectId < 0) {
      Serial.println("[MQTT] Invalid control payload (missing/out-of-range)");
      return;
    }
    if (color[0] != '#' || strlen(color) != 7) {
      Serial.printf("[MQTT] Invalid color format: %s\n", color);
      return;
    }

    long rgb = strtol(color + 1, nullptr, 16);
    int r = (rgb >> 16) & 0xFF;
    int g = (rgb >> 8)  & 0xFF;
    int b = rgb & 0xFF;

    Serial.printf("[MQTT] control: color=%s bri=%d fxId=%d (mode=%s)\n",
                  color, brightness, effectId, modeToCStr(currentMode));

    // §7.3: 任意モードから受信時は MANUAL に強制遷移しつつ反映する
    applyLedParams(r, g, b, brightness, effectId);
    if (currentMode != Mode::MANUAL) {
      setMode(Mode::MANUAL, "MQTT_CONTROL");
    } else {
      publishStateIfChanged("MQTT_CONTROL");
    }
    return;
  }

  Serial.printf("[MQTT] Unsubscribed topic received: %s\n", topic);
}

// =============================================================================
// PIR ハンドラ（AUTO モードでのみ作用）
// =============================================================================
void handlePir() {
  unsigned long now = millis();

  // ① ウォームアップ中はフラグを捨てる
  if (now - bootAt < PIR_WARMUP_MS) {
    pirRiseFlag = false;
    return;
  }

  // ② 立ち上がりエッジ処理
  if (pirRiseFlag) {
    pirRiseFlag = false;

    if (currentMode != Mode::AUTO) {
      Serial.printf("[PIR] HIGH ignored (mode=%s)\n", modeToCStr(currentMode));
    } else {
      bool isNewEvent = (now - lastMotionAt > PIR_DEDUP_MS);
      lastMotionAt = now;

      if (!ledIsOn && isNewEvent) {
        applyDefaultScene();
        ledIsOn = true;
        Serial.println("[PIR] motion -> LED ON");
        publishStateIfChanged("PIR_ON");
      }
      // 点灯中の再トリガは lastMotionAt 更新のみ（再 POST しない）
    }
  }

  // ③ 自動消灯タイマー
  if (ledIsOn && currentMode == Mode::AUTO &&
      now - lastMotionAt > AUTO_OFF_MS) {
    applyOff();
    ledIsOn = false;
    Serial.printf("[PIR] timeout %lums -> LED OFF\n", AUTO_OFF_MS);
    publishStateIfChanged("PIR_OFF");
  }
}

// =============================================================================
// プッシュSW ハンドラ
// =============================================================================
void handleButton() {
  unsigned long now = millis();

  // ① 押下中なら ISR を待たず長押し時間経過をチェック
  if (btnLastStableLevel == LOW && !btnLongFired &&
      now - btnPressStartAt >= BTN_LONG_PRESS_MS) {
    onLongPress();
    btnLongFired = true;
  }

  // ② エッジ評価（ISR フラグが立ったときのみ）
  if (!btnIsrFlag) return;
  if (now - btnLastIsrAt < BTN_DEBOUNCE_MS) return; // デバウンス
  btnIsrFlag = false;

  int level = digitalRead(MODE_BTN_PIN);
  if (level == btnLastStableLevel) return;
  btnLastStableLevel = level;

  if (level == LOW) {
    btnPressStartAt = now;
    btnLongFired    = false;
  } else {
    unsigned long heldFor = now - btnPressStartAt;
    if (!btnLongFired && heldFor >= BTN_SHORT_MIN_MS && heldFor < BTN_LONG_PRESS_MS) {
      onShortPress();
    }
  }
}

void onShortPress() {
  Serial.println("[BTN] short press");
  if (currentMode == Mode::STANDBY) setMode(Mode::AUTO,    "BTN_SHORT");
  else                              setMode(Mode::STANDBY, "BTN_SHORT");
}

void onLongPress() {
  Serial.println("[BTN] long press -> STANDBY");
  setMode(Mode::STANDBY, "BTN_LONG");
}

// =============================================================================
// モード遷移
// =============================================================================
void setMode(Mode next, const char* trigger) {
  if (next == currentMode) {
    publishStateIfChanged(trigger); // 起動時など、初回 publish のための保険
    return;
  }
  Serial.printf("[MODE] %s -> %s (trigger=%s)\n",
                modeToCStr(currentMode), modeToCStr(next), trigger);
  Mode prev = currentMode;
  currentMode = next;

  // STANDBY に遷移したら必ず消灯
  if (next == Mode::STANDBY) {
    applyOff();
    ledIsOn = false;
  }

  // AUTO から MANUAL/STANDBY へ移ったときは PIR タイマーを停止扱いにする
  // （ledIsOn の解釈は AUTO 用なので AUTO 以外では参照されない）
  if (prev == Mode::AUTO && next != Mode::AUTO) {
    // ledIsOn の値は維持（AUTO に戻ったときに再判定）
  }

  publishStateIfChanged(trigger);
}

// =============================================================================
// 状態通知（変化時のみ）
// =============================================================================
void publishStateIfChanged(const char* trigger) {
  if (hasPublishedOnce &&
      currentMode == lastPublishedMode &&
      strcmp(trigger, lastPublishedTrigger) == 0) {
    return; // 重複抑止
  }

  if (!mqttClient.connected()) {
    return;
  }

  JsonDocument doc;
  doc["mode"]        = modeToCStr(currentMode);
  doc["lastTrigger"] = trigger;
  doc["motionAt"]    = lastMotionAt;
  doc["ledIsOn"]     = ledIsOn;

  char payload[200];
  size_t n = serializeJson(doc, payload, sizeof(payload));
  if (n == 0) return;

  if (mqttClient.publish(MQTT_TOPIC_STATE, payload, false)) {
    lastPublishedMode    = currentMode;
    lastPublishedTrigger = trigger;
    hasPublishedOnce     = true;
    Serial.printf("[STATE] %s (trigger=%s)\n", modeToCStr(currentMode), trigger);
  } else {
    Serial.println("[STATE] publish failed");
  }
}

// =============================================================================
// WLED API（HTTP）
// =============================================================================
void syncWledAblOnBoot() {
#if !WLED_SYNC_ABL_ON_BOOT
  Serial.println("[WLED] ABL sync skipped (WLED_SYNC_ABL_ON_BOOT=0)");
  return;
#endif
  uint16_t capMa = static_cast<uint16_t>(WLED_ABL_MAX_MILLIAMPS);
  if (capMa > 4250) {
    capMa = 4250;
  }

  JsonDocument body;
  body["hw"]["led"]["maxpwr"] = capMa;
  // false: NVRAM 非更新（ブリッジ再起動のたびに cfg.json を書かない）。RAM 上の上限のみ即時反映。
  body["sv"] = false;

  String payload;
  serializeJson(body, payload);

  constexpr int kAttempts = 6;
  for (int attempt = 1; attempt <= kAttempts; ++attempt) {
    HTTPClient http;
    String url = String("http://") + WLED_IP + ":" + WLED_PORT + "/json/cfg";
    http.begin(url);
    http.setTimeout(WLED_HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");

    int code = http.POST(payload);
    http.end();

    if (code == HTTP_CODE_OK) {
      Serial.printf("[WLED] ABL hw.led.maxpwr=%u mA applied (attempt %d, sv=false)\n", capMa, attempt);
      return;
    }
    Serial.printf("[WLED] ABL sync HTTP %d (attempt %d/%d)\n", code, attempt, kAttempts);
    if (attempt < kAttempts) {
      delay(1500);
    }
  }
  Serial.println("[WLED] ABL sync failed: check WLED_IP, WLED power, AP lock, or settings PIN");
}

void applyDefaultScene() {
  applyLedParams(PIR_DEFAULT_COLOR_R, PIR_DEFAULT_COLOR_G, PIR_DEFAULT_COLOR_B,
                 PIR_DEFAULT_BRIGHTNESS, PIR_DEFAULT_EFFECT_ID);
}

void applyOff() {
  // §8.3 規約: 色・輝度・エフェクトは WLED 側に保持させ、{"on": false} のみ送信
  JsonDocument body;
  body["on"] = false;

  String payload;
  serializeJson(body, payload);

  HTTPClient http;
  String url = String("http://") + WLED_IP + ":" + WLED_PORT + "/json/state";
  http.begin(url);
  http.setTimeout(WLED_HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(payload);
  if (code == HTTP_CODE_OK) {
    Serial.println("[WLED] OFF applied");
  } else {
    Serial.printf("[WLED] OFF API error: HTTP %d\n", code);
  }
  http.end();
}

void applyLedParams(int r, int g, int b, int brightness, int effectId) {
  JsonDocument body;
  body["on"]  = true;
  body["bri"] = brightness;
  body["seg"][0]["col"][0][0] = r;
  body["seg"][0]["col"][0][1] = g;
  body["seg"][0]["col"][0][2] = b;
  body["seg"][0]["fx"]        = effectId;

  String payload;
  serializeJson(body, payload);

  HTTPClient http;
  String url = String("http://") + WLED_IP + ":" + WLED_PORT + "/json/state";
  http.begin(url);
  http.setTimeout(WLED_HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(payload);
  if (code == HTTP_CODE_OK) {
    Serial.printf("[WLED] Applied: rgb=(%d,%d,%d) bri=%d fx=%d\n",
                  r, g, b, brightness, effectId);
  } else {
    Serial.printf("[WLED] API error: HTTP %d\n", code);
  }
  http.end();
}
