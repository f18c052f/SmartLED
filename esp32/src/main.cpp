#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>

#include "config.h"
#include "../secrets/certs.h"

// ----- MQTT クライアント -----
WiFiClientSecure wifiSecureClient;
PubSubClient mqttClient(wifiSecureClient);

// ----- 関数宣言 -----
void connectWiFi();
void connectMqtt();
void onMqttMessage(const char* topic, byte* payload, unsigned int length);
void applyLedParams(const String& color, int brightness, const String& effect);

// -------------------------------------------------------------------------
// setup / loop
// -------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  connectWiFi();

  wifiSecureClient.setCACert(AWS_CERT_CA);
  wifiSecureClient.setCertificate(AWS_CERT_CRT);
  wifiSecureClient.setPrivateKey(AWS_CERT_PRIVATE);

  mqttClient.setServer(AWS_IOT_ENDPOINT, AWS_IOT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(512);

  connectMqtt();
}

void loop() {
  if (!mqttClient.connected()) {
    connectMqtt();
  }
  mqttClient.loop();
}

// -------------------------------------------------------------------------
// WiFi 接続（ブロッキング、タイムアウト 20s）
// -------------------------------------------------------------------------
void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  unsigned long lastLog = 0;
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > 20000) {
      Serial.printf("[WiFi] Timeout (last status=%d). Restarting...\n", WiFi.status());
      ESP.restart();
    }
    // 3秒ごとに状態を表示（原因切り分け用）
    if (millis() - lastLog >= 3000) {
      lastLog = millis();
      int s = WiFi.status();
      const char* msg = (s == WL_IDLE_STATUS) ? "IDLE" :
                        (s == WL_NO_SSID_AVAIL) ? "NO_SSID_AVAIL (SSID未検出)" :
                        (s == WL_SCAN_COMPLETED) ? "SCAN_COMPLETED" :
                        (s == WL_CONNECT_FAILED) ? "CONNECT_FAILED (パスワード誤り?)" :
                        (s == WL_CONNECTION_LOST) ? "CONNECTION_LOST" :
                        (s == WL_DISCONNECTED) ? "DISCONNECTED" : "OTHER";
      Serial.printf("[WiFi] status=%d (%s)\n", s, msg);
    }
    delay(500);
  }
  Serial.printf("[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
}

// -------------------------------------------------------------------------
// MQTT 接続（ノンブロッキング再接続、5s ごとにリトライ）
// -------------------------------------------------------------------------
void connectMqtt() {
  static unsigned long lastAttempt = 0;
  const unsigned long interval = 5000;

  if (millis() - lastAttempt < interval) return;
  lastAttempt = millis();

  Serial.printf("[MQTT] Connecting to %s\n", AWS_IOT_ENDPOINT);
  if (mqttClient.connect(AWS_IOT_CLIENT_ID)) {
    Serial.println("[MQTT] Connected");
    mqttClient.subscribe(MQTT_TOPIC_SUBSCRIBE);
    Serial.printf("[MQTT] Subscribed to %s\n", MQTT_TOPIC_SUBSCRIBE);
  } else {
    Serial.printf("[MQTT] Failed (state=%d), retrying in 5s\n", mqttClient.state());
  }
}

// -------------------------------------------------------------------------
// MQTT メッセージ受信コールバック
// ペイロード: {"color":"#rrggbb","brightness":0-255,"effect":"solid|..."}
// -------------------------------------------------------------------------
void onMqttMessage(const char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.printf("[MQTT] JSON parse error: %s\n", error.c_str());
    return;
  }

  const char* color      = doc["color"];
  int         brightness = doc["brightness"] | -1;
  const char* effect     = doc["effect"];

  if (!color || brightness < 0 || brightness > 255 || !effect) {
    Serial.println("[MQTT] Invalid payload: missing or out-of-range fields");
    return;
  }

  Serial.printf("[MQTT] Received: color=%s brightness=%d effect=%s\n",
                color, brightness, effect);

  applyLedParams(String(color), brightness, String(effect));
}

// -------------------------------------------------------------------------
// WLED JSON API で LED パラメータを適用する
// POST http://<WLED_IP>/json/state
// -------------------------------------------------------------------------
void applyLedParams(const String& color, int brightness, const String& effect) {
  // HEX カラー (#rrggbb) を WLED の整数 RGB に変換
  long rgb    = strtol(color.c_str() + 1, nullptr, 16);
  int  red    = (rgb >> 16) & 0xFF;
  int  green  = (rgb >> 8)  & 0xFF;
  int  blue   = rgb & 0xFF;

  // WLED エフェクト ID のマッピング（WLED の標準エフェクト番号）
  int fxId = 0; // デフォルト: solid
  if      (effect == "fade")     fxId = 12;
  else if (effect == "rainbow")  fxId = 9;
  else if (effect == "sparkle")  fxId = 20;
  else if (effect == "fire")     fxId = 66;
  else if (effect == "twinkle")  fxId = 68;
  else if (effect == "breath")   fxId = 14;

  // WLED JSON API ペイロード構築
  JsonDocument body;
  body["bri"] = brightness;
  body["seg"][0]["col"][0][0] = red;
  body["seg"][0]["col"][0][1] = green;
  body["seg"][0]["col"][0][2] = blue;
  body["seg"][0]["fx"]        = fxId;

  String payload;
  serializeJson(body, payload);

  HTTPClient http;
  String url = String("http://") + WLED_IP + ":" + WLED_PORT + "/json/state";
  http.begin(url);
  http.setTimeout(3000);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(payload);
  if (code == HTTP_CODE_OK) {
    Serial.printf("[WLED] Applied: color=%s brightness=%d effect=%s\n",
                  color.c_str(), brightness, effect.c_str());
  } else {
    Serial.printf("[WLED] API error: HTTP %d\n", code);
  }
  http.end();
}
