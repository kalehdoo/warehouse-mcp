/**
 * Optional OpenTelemetry tracing.
 *
 * Off by default. When OTEL_EXPORTER_OTLP_ENDPOINT is set, initializes a
 * NodeTracerProvider with a batch span processor exporting OTLP/HTTP. Tool
 * handlers acquire a tracer through `getTracer()`; without an active provider
 * the tracer no-ops, so this stays cheap when disabled.
 *
 * Adapter-level spans are intentionally not added in v1 — wrapping every
 * driver call would touch six adapter files for marginal value over the
 * tool-level span. Revisit when customers ask for per-query latency
 * breakdowns inside a single tool call.
 */
import { trace } from "@opentelemetry/api";

let _initialized = false;

export async function maybeInitTracing(serviceName, version) {
  if (_initialized) return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  // Lazy-load the SDK so the cold path stays cheap.
  const [{ NodeTracerProvider, BatchSpanProcessor }, { OTLPTraceExporter }, { Resource }, semconv] =
    await Promise.all([
      import("@opentelemetry/sdk-trace-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/semantic-conventions"),
    ]);

  const provider = new NodeTracerProvider({
    resource: new Resource({
      [semconv.SemanticResourceAttributes?.SERVICE_NAME ?? "service.name"]: serviceName,
      [semconv.SemanticResourceAttributes?.SERVICE_VERSION ?? "service.version"]: version,
    }),
  });
  provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter()));
  provider.register();
  _initialized = true;
}

export function getTracer(name = "warehouse-mcp") {
  return trace.getTracer(name);
}

export async function withSpan(name, fn, attributes = {}) {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      span.end();
      return result;
    } catch (e) {
      span.recordException(e);
      span.setStatus({ code: 2, message: e.message });
      span.end();
      throw e;
    }
  });
}
