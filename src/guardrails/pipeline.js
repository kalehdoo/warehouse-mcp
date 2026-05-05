/**
 * Guardrail pipeline runner.
 *
 * The pipeline holds an ordered list of pre-guardrails and post-guardrails.
 * The tool dispatcher (src/tools/registerAll.js) calls runPre() before the
 * handler and runPost() after, so every tool inherits all configured
 * guardrails automatically — no per-handler bookkeeping.
 *
 * Pre-guardrails short-circuit on the first deny / approve-required result.
 * Post-guardrails always run end-to-end (each transforms the result).
 *
 * Failure semantics: if a guardrail's evaluate() throws (a bug, not a deny),
 * the pipeline treats it as a HARD DENY rather than letting the call slip
 * through. Better to fail closed than open.
 */

export class GuardrailPipeline {
  /**
   * @param {{
   *   pre?: import("./types.js").PreGuardrail[],
   *   post?: import("./types.js").PostGuardrail[],
   * }} options
   */
  constructor({ pre = [], post = [] } = {}) {
    this.pre = pre;
    this.post = post;
  }

  /**
   * Run all pre-guardrails. Returns the first non-allow result, or
   * {action: "allow"} if every guardrail passed. The events array
   * accumulates one GuardrailEvent per guardrail that emitted one.
   *
   * @param {import("../auth/context.js").Context} ctx
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<{result: import("./types.js").PreGuardrailResult, events: import("./types.js").GuardrailEvent[]}>}
   */
  async runPre(ctx, toolName, args) {
    const events = [];
    for (const g of this.pre) {
      let outcome;
      try {
        outcome = await g.evaluate(ctx, toolName, args);
      } catch (e) {
        // Fail closed — a buggy guardrail must not silently let calls through.
        return {
          result: { action: "deny", reason: `guardrail '${g.name}' errored: ${e.message}` },
          events: [
            ...events,
            { guardrail: g.name, action: "deny", reason: `internal error: ${e.message}` },
          ],
        };
      }
      if (outcome.event) events.push(outcome.event);
      if (outcome.action !== "allow") {
        return { result: outcome, events };
      }
    }
    return { result: { action: "allow" }, events };
  }

  /**
   * Run all post-guardrails in order. Each receives the (possibly transformed)
   * result from the previous one.
   *
   * @param {import("../auth/context.js").Context} ctx
   * @param {string} toolName
   * @param {object} args
   * @param {any} result
   * @returns {Promise<{result: any, events: import("./types.js").GuardrailEvent[]}>}
   */
  async runPost(ctx, toolName, args, result) {
    const events = [];
    let current = result;
    for (const g of this.post) {
      let outcome;
      try {
        outcome = await g.evaluate(ctx, toolName, args, current);
      } catch (e) {
        // A post-guardrail bug shouldn't poison the response. Skip and log.
        events.push({
          guardrail: g.name,
          action: "deny",
          reason: `post-guardrail '${g.name}' errored, output not transformed: ${e.message}`,
        });
        continue;
      }
      if (outcome.event) events.push(outcome.event);
      current = outcome.result;
    }
    return { result: current, events };
  }
}
