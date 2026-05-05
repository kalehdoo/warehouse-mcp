/**
 * Guardrail registry — assembles the configured pipeline at boot time.
 *
 * Each guardrail is opt-in via its own env knob so a deployment that doesn't
 * need a layer doesn't pay for it (and doesn't have to debug surprising
 * masking behavior).
 *
 *   GUARDRAIL_PII_MASK=on    enables outputPiiMask
 *
 * Add new guardrails by importing them and gating registration on an env var.
 */
import { GuardrailPipeline } from "./pipeline.js";
import { outputPiiMask } from "./post/outputPiiMask.js";

function isOn(value) {
  return /^(1|true|on|yes)$/i.test(value || "");
}

export function buildGuardrailPipeline(env = process.env) {
  const pre = [];
  const post = [];

  if (isOn(env.GUARDRAIL_PII_MASK)) post.push(outputPiiMask);

  return new GuardrailPipeline({ pre, post });
}

export { GuardrailPipeline } from "./pipeline.js";
