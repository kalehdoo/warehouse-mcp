# Module 05 — Server & Tool Registration

> Expands on [Runbook §4.2 & §5.2](../runbook.md#42-buildserverctx-deps--srcserverjs).
> Files: [`src/server.js`](../../../src/server.js), [`src/tools/registerAll.js`](../../../src/tools/registerAll.js).

## Purpose

Assemble a per-session `McpServer` and wrap every tool in the **request pipeline** — the single choke point where role enforcement, rate limiting, guardrails, result capping, and auditing all happen. This is the most security-critical wiring in the codebase.

## `server.js` — `buildServer(ctx, deps)`

1. `new McpServer({ name, version })`.
2. `registerAllTools(server, ctx, deps)` — register the tools this role may use.
3. **Conditionally** `registerSemanticResources(server, deps.semantic)` if **all three gates** pass:
   - `ctx.includeSemantic !== false` (session opted in),
   - `deps.semantic` was wired through, and
   - the index actually has content (`glossary.size > 0 || tables.size > 0`).
4. Return the server.

> The three-gate check is deliberate: per-session opt-in (`includeSemantic`) lets two users on the same deployment disagree about whether they want semantic resources **without restarting the server**. See [module 11](./11-semantic.md).

## `registerAll.js` — the request pipeline

For each `def` in `TOOL_DEFINITIONS` ([module 06](./06-tools.md)):

### Registration-time gate
`if (!isToolAllowed(ctx.role, def.name)) continue;` — tools the role can't invoke are **never registered**, so they don't appear in `tools/list`. This is both better agent UX (the catalog already excludes them) and a smaller audit footprint. The handler-level `assertToolAllowed` below is kept as **defense in depth** against future code paths that might bypass registration.

### Handler wrapper — the 7-step gauntlet
Every registered tool's handler is wrapped (inside `withSpan` for tracing) with this exact order:

```
1. assertToolAllowed(ctx, def.name)         ← role policy (defense in depth)
2. deps.rateLimiter?.charge(ctx.principal)  ← throws RateLimitError if empty
3. deps.guardrails.runPre(ctx, name, args)  ← if action !== "allow": audit + return (deny / approve_required)
4. result = await def.handler(args, ctx, deps)
5. result = applyResultCap(result, maxResultCells)
6. result = (await deps.guardrails.runPost(ctx, name, args, result)).result
7. deps.audit?.write({ ctx, tool, rowCount, durationMs, truncated, guardrailEvents })
```

A `try/catch` around the whole thing **also audits on error** and returns `{isError:true, content:[{type:"text", text:"Error: ..."}]}`. Pre-guardrail denials return a human-readable `Denied:` / `Approval required:` message instead of throwing.

### Output shaping
The handler's return value is serialized into MCP `content`: strings pass through; objects are `JSON.stringify(result, null, 2)`. `rowCount` for the audit is derived from whichever of `rows` / `hits` / `values` the tool returned.

## Why it's built this way
- **One pipeline, every tool.** Cross-cutting concerns (auth, limits, guardrails, audit) live in one wrapper, not scattered across 15 handlers. Add a new concern here once.
- **Skip-don't-deny at registration.** Filtering the catalog by role prevents the "agent tries a tool it can never use and gets a runtime denial" failure mode.
- **Audit is unconditional.** Success, guardrail denial, and exception all write an audit record. There is no path through the wrapper that skips the log.
- **Closure capture of `ctx`.** Because each session has its own server, the handler closes over its own `ctx` — no thread-local, no request-scoped global.

## Gotchas
- Order matters: rate-limit charge happens **before** the handler runs (a denied call still costs a token slot only at step 2, before any DB work). Guardrail pre-checks happen before the handler; post-transforms after the result cap.
- `maxResultCells` is read from `deps.provider.getSafetyConfig()` at call time, not captured at boot — keep the provider on `deps`.
- A buggy **pre**-guardrail fails **closed** (deny); a buggy **post**-guardrail is skipped so it can't poison the response (see [module 09](./09-guardrails.md)).

## Rewrite checklist
- [ ] `buildServer` registers tools then conditionally registers semantic resources behind the three gates.
- [ ] Tools the role can't use are not registered.
- [ ] Handler wrapper implements the 7 steps in order, inside a span.
- [ ] Audit writes on success, on guardrail denial, and on exception.
- [ ] Return value serialized to MCP `content` (string vs JSON).

## See also
- The tools being registered → [module 06](./06-tools.md)
- `isToolAllowed`/`assertToolAllowed` → [module 07](./07-security.md)
- `runPre`/`runPost` semantics → [module 09](./09-guardrails.md)
- `applyResultCap` + audit shape → [module 10](./10-audit-and-observability.md)
- The three semantic gates → [module 11](./11-semantic.md)
</content>
