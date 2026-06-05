# Module 01 — Entry & Bootstrap

> Expands on [Runbook §2](../runbook.md#2-the-boot-sequence--what-runs-first-and-how-it-traverses).
> Files: [`bin/warehouse-mcp.js`](../../../bin/warehouse-mcp.js), [`src/cli/router.js`](../../../src/cli/router.js), [`src/cli/start.js`](../../../src/cli/start.js), [`src/index.js`](../../../src/index.js).

## Purpose

This module is the **composition root** — the place where the program starts, parses arguments, and wires every dependency together before any request is served. Nothing here contains business logic; its job is *assembly and lifecycle*.

## Files and responsibilities

### `bin/warehouse-mcp.js` — the executable shim
Declared as the `bin` entry in [`package.json`](../../../package.json#L9-L11), so `npx warehouse-mcp <cmd>` lands here. Seven lines: import `runCli`, call it with `process.argv.slice(2)`, and on rejection print to stderr and `exit(1)`. Keep it this thin — it has no logic to test.

### `src/cli/router.js` — subcommand dispatch
A `switch` over `argv[0]`. Each branch **lazily `import()`s** its handler so `warehouse-mcp help` doesn't pay the cost of loading the server stack. Commands: `init`, `start`, `doctor`, `help`. Unknown commands print help and exit 1.

> Design note: the router is deliberately tiny "so it stays trivially testable" (see its header comment). Tests assert routing, not behavior.

### `src/index.js` — `main()`, the real bootstrap
This is the file to internalize. Sequence:

1. `await maybeInitTracing("warehouse-mcp", version)` — start OTel **first** so later spans are captured.
2. `loadConfig()` → `new EnvConfigProvider(config)` — read env once, wrap in the provider abstraction.
3. Construct the long-lived singletons: `JsonlAuditSink`, `TokenBucketRateLimiter`, `buildGuardrailPipeline()`.
4. `loadSemantic({ dir })` — optional; logs a summary or a warning if the dir is missing.
5. Register `SIGINT`/`SIGTERM` → `shutdown()` which closes the audit sink and all adapters, then `exit(0)`.
6. Branch on `config.transport`: `startStdioTransport` or `startHttpTransport`, passing the **`deps` bundle** `{ config, provider, audit, rateLimiter, guardrails, semantic }`.

A top-level `main().catch()` logs fatal errors and exits 1.

## Why it's built this way

- **One construction site.** Every dependency is created here and only here, then injected downward. There is no service locator and no global `getAudit()` — when you rewrite, resist the temptation to reach for module-level singletons. The single allowed global is the adapter pool (module 08), and even that is reached via `getAdapter(ctx, provider)`.
- **Lazy CLI imports** keep cold-start fast and keep `doctor`/`init` runnable even if the server deps would fail.
- **Tracing before config** so a misconfiguration is still traced.

## The `deps` bundle — the contract

Everything downstream receives the same object shape:

```js
{ config, provider, audit, rateLimiter, guardrails, semantic }
```

`provider` is the abstraction the rest of the system uses to read config (module 02); the others are the cross-cutting services. Treat this bundle as the public interface between bootstrap and the transports.

## Rewrite checklist

- [ ] `bin` shim forwards argv and maps rejections to a non-zero exit.
- [ ] Router lazily imports handlers; unknown command → help + exit 1.
- [ ] `main()` builds deps in the order above (tracing first, shutdown hooks registered before `listen`).
- [ ] Transport selection reads `config.transport` only.
- [ ] No dependency is constructed anywhere except `main()`.

## See also
- Config it consumes → [module 02](./02-config.md)
- Where `deps` flows next → [module 04 (transports)](./04-transports.md)
- Shutdown closes these → [module 08 (adapters)](./08-adapters.md), [module 10 (audit)](./10-audit-and-observability.md)
</content>
