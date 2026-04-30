import {
  extractNaturalLanguageFromAlexa,
  classifyAlexaIntent,
  buildAlexaResponse,
  AlexaRequest,
} from "../src/lib/alexa-request";

describe("extractNaturalLanguageFromAlexa", () => {
  it("extracts value from 'phrase' slot", () => {
    const event: AlexaRequest = {
      request: {
        type: "IntentRequest",
        intent: {
          name: "LightControlIntent",
          slots: { phrase: { name: "phrase", value: "読書モードにして" } },
        },
      },
    };
    expect(extractNaturalLanguageFromAlexa(event)).toBe("読書モードにして");
  });

  it("extracts value from 'utterance' slot when 'phrase' is absent", () => {
    const event: AlexaRequest = {
      request: {
        type: "IntentRequest",
        intent: {
          name: "LightControlIntent",
          slots: { utterance: { name: "utterance", value: "リラックスしたい" } },
        },
      },
    };
    expect(extractNaturalLanguageFromAlexa(event)).toBe("リラックスしたい");
  });

  it("returns empty string when no matching slot", () => {
    const event: AlexaRequest = {
      request: {
        type: "IntentRequest",
        intent: { name: "LightControlIntent", slots: { other: { value: "foo" } } },
      },
    };
    expect(extractNaturalLanguageFromAlexa(event)).toBe("");
  });

  it("returns empty string when slots are absent", () => {
    const event: AlexaRequest = {
      request: { type: "IntentRequest", intent: { name: "LightControlIntent" } },
    };
    expect(extractNaturalLanguageFromAlexa(event)).toBe("");
  });

  it("returns empty string when request is absent", () => {
    expect(extractNaturalLanguageFromAlexa({})).toBe("");
  });
});

describe("classifyAlexaIntent", () => {
  it("classifies LaunchRequest", () => {
    const event: AlexaRequest = { request: { type: "LaunchRequest" } };
    expect(classifyAlexaIntent(event)).toEqual({ kind: "launch" });
  });

  it("classifies SessionEndedRequest", () => {
    const event: AlexaRequest = { request: { type: "SessionEndedRequest" } };
    expect(classifyAlexaIntent(event)).toEqual({ kind: "sessionEnded" });
  });

  it("classifies PowerOnIntent", () => {
    const event: AlexaRequest = {
      request: { type: "IntentRequest", intent: { name: "PowerOnIntent" } },
    };
    expect(classifyAlexaIntent(event)).toEqual({ kind: "powerOn" });
  });

  it("classifies PowerOffIntent", () => {
    const event: AlexaRequest = {
      request: { type: "IntentRequest", intent: { name: "PowerOffIntent" } },
    };
    expect(classifyAlexaIntent(event)).toEqual({ kind: "powerOff" });
  });

  it("classifies LightControlIntent with phrase slot to 'scene'", () => {
    const event: AlexaRequest = {
      request: {
        type: "IntentRequest",
        intent: {
          name: "LightControlIntent",
          slots: { phrase: { name: "phrase", value: "読書モードにして" } },
        },
      },
    };
    expect(classifyAlexaIntent(event)).toEqual({ kind: "scene", phrase: "読書モードにして" });
  });

  it("classifies LightControlIntent without phrase slot to 'unknown'", () => {
    const event: AlexaRequest = {
      request: { type: "IntentRequest", intent: { name: "LightControlIntent" } },
    };
    expect(classifyAlexaIntent(event)).toEqual({ kind: "unknown" });
  });

  it("classifies unknown intent to 'unknown'", () => {
    const event: AlexaRequest = {
      request: { type: "IntentRequest", intent: { name: "SomeOtherIntent" } },
    };
    expect(classifyAlexaIntent(event)).toEqual({ kind: "unknown" });
  });

  it("classifies empty event to 'unknown'", () => {
    expect(classifyAlexaIntent({})).toEqual({ kind: "unknown" });
  });
});

describe("buildAlexaResponse", () => {
  it("returns valid Alexa response format with shouldEndSession=true by default", () => {
    const response = buildAlexaResponse("照明を調整しました。");
    expect(response.version).toBe("1.0");
    expect(response.response.outputSpeech.type).toBe("PlainText");
    expect(response.response.outputSpeech.text).toBe("照明を調整しました。");
    expect(response.response.shouldEndSession).toBe(true);
  });

  it("returns shouldEndSession=false when specified", () => {
    const response = buildAlexaResponse("スマートLEDへようこそ。", false);
    expect(response.response.shouldEndSession).toBe(false);
  });
});
