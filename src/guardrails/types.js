/**
 * Guardrail interface and the structured event each guardrail emits.
 *
 * Guardrails come in two kinds:
 *
 *   pre   — runs BEFORE the tool handler. Can short-circuit by returning
 *           {action: "deny" | "approve_required"}. Returns {action: "allow"}
 *           to let the call proceed.
 *
 *   post  — runs AFTER the tool handler with the result in hand. Returns a
 *           (possibly transformed) result. Used for masking, redaction,
 *           clipping that depends on what was returned.
 *
 * Every guardrail emits a GuardrailEvent for the audit log so SIEM tools
 * can alert on patterns ("alice's reader_restricted key triggered 47
 * sensitive_table_policy denials in the last hour" etc.).
 *
 * @typedef {object} GuardrailEvent
 * @property {string} guardrail            Name of the guardrail (matches Guardrail.name).
 * @property {"allow"|"deny"|"approve_required"|"transform"} action
 * @property {string} [reason]             Human-readable reason for the action.
 * @property {object} [details]            Guardrail-specific payload (e.g., which patterns matched).
 *
 * @typedef {object} PreGuardrailResult
 * @property {"allow"|"deny"|"approve_required"} action
 * @property {string} [reason]
 * @property {GuardrailEvent} [event]
 *
 * @typedef {object} PostGuardrailResult
 * @property {any} result                  The (possibly transformed) tool result.
 * @property {GuardrailEvent} [event]      Event to log; omit if nothing to report.
 *
 * @typedef {object} PreGuardrail
 * @property {string} name
 * @property {"pre"} kind
 * @property {(ctx: import("../auth/context.js").Context, toolName: string, args: object) => Promise<PreGuardrailResult>} evaluate
 *
 * @typedef {object} PostGuardrail
 * @property {string} name
 * @property {"post"} kind
 * @property {(ctx: import("../auth/context.js").Context, toolName: string, args: object, result: any) => Promise<PostGuardrailResult>} evaluate
 *
 * @typedef {PreGuardrail | PostGuardrail} Guardrail
 */
export {};
