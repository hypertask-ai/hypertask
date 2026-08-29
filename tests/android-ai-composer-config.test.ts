import assert from "node:assert/strict";
import test from "node:test";
import { buildComposerConfig } from "../src/app/api/android/ai/composer/config";

test("composer uses the enabled board default and filters disabled providers", () => {
  const result = buildComposerConfig({
    settings: {
      providers: { openai: true, anthropic: false },
      featureModels: { aiChat: "gpt-5.4-mini" },
    },
    customEndpointConfigured: false,
    storePlanId: "Pro",
    providersWithByok: new Set(),
  });

  assert.equal(result.enabled, true);
  assert.equal(result.selectedModelId, "gpt-5.4-mini");
  assert.equal(result.models.some((model) => model.provider === "claude"), false);
});

test("composer filters premium models before send for free boards without BYOK", () => {
  const result = buildComposerConfig({
    settings: null,
    customEndpointConfigured: false,
    storePlanId: "Free",
    providersWithByok: new Set(),
  });

  assert.equal(result.models.some((model) => model.id === "gpt-5.6-sol"), false);
  assert.equal(result.models.some((model) => model.id === "gpt-5.4-mini"), true);
});

test("composer keeps premium models gated on free boards even when a key is stored", () => {
  const result = buildComposerConfig({
    settings: null,
    customEndpointConfigured: false,
    storePlanId: "Free",
    providersWithByok: new Set(["openai"]),
  });

  assert.equal(result.models.some((model) => model.id === "gpt-5.6-sol"), false);
});

test("composer keeps premium models available when that provider has BYOK", () => {
  const result = buildComposerConfig({
    settings: null,
    customEndpointConfigured: false,
    storePlanId: "BYOK",
    providersWithByok: new Set(["openai"]),
  });

  assert.equal(result.models.some((model) => model.id === "gpt-5.6-sol"), true);
  assert.equal(
    result.models.some((model) => model.id === "claude-opus-5-thinking"),
    false,
  );
});

test("composer includes the non-premium custom model only when its endpoint is configured", () => {
  const configured = buildComposerConfig({
    settings: null,
    customEndpointConfigured: true,
    storePlanId: "BYOK",
    providersWithByok: new Set(),
  });
  const missing = buildComposerConfig({
    settings: null,
    customEndpointConfigured: false,
    storePlanId: "BYOK",
    providersWithByok: new Set(),
  });

  assert.equal(configured.models.some((model) => model.id === "custom"), true);
  assert.equal(missing.models.some((model) => model.id === "custom"), false);
});

test("composer returns pre-send blocks when board AI is disabled", () => {
  const result = buildComposerConfig({
    settings: { featureToggles: { aiChat: false, dictation: false } },
    customEndpointConfigured: false,
    storePlanId: "Pro",
    providersWithByok: new Set(),
  });

  assert.equal(result.enabled, false);
  assert.deepEqual(result.models, []);
  assert.match(result.blockedReason ?? "", /disabled/);
  assert.equal(result.dictation.enabled, false);
});
