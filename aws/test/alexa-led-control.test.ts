import { extractNaturalLanguageFromAlexa, AlexaRequest } from "../src/lib/alexa-request";

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
