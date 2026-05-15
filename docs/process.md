Worked example: "What was our revenue last month?"
The user types this into Claude Desktop (or another MCP client). Here's the actual sequence of MCP messages on the wire — what the client does is the key part, since the server only ever responds.

Step 0 — One-time, at session start
The client connects, does the initialize handshake, then asks the server two questions in parallel:

tools/list → server returns the 13 tools (filtered by role) from src/tools/registerAll.js:35.
resources/list + resources/templates/list → server returns the five warehouse://semantic/* resources registered in src/semantic/resources.js:50-165.
The client now knows what tools it can call and what static knowledge it can read. Nothing has been fetched from the index yet — only the catalog.

Step 1 — User submits the question
Claude Desktop now has, in its prompt context:

the user's question
the tool catalog (names + JSON Schemas + descriptions)
the resource catalog (URIs + descriptions)
The descriptions matter. Notice resources.js:57-59 literally says "Read this BEFORE answering data questions" and resources.js:155-156 says "Read this BEFORE constructing a query against the table." That's how the LLM knows to fetch them first.

Step 2 — LLM decides to read resources first
Looking at "revenue last month", Claude reasons: "revenue is a business term, and the glossary description says read it before answering data questions." So before any tool call, it issues an MCP resources/read:


{ "method": "resources/read",
  "params": { "uri": "warehouse://semantic/glossary/revenue" } }
This hits the handler at src/semantic/resources.js:106-110, which does index.glossary.get("revenue") — a single Map lookup, no I/O. The response is the glossary entry as JSON, which (per a real glossary) might be:


{
  "name": "revenue",
  "definition": "Sum of paid order amounts in USD, excluding refunds and tax.",
  "sql_definition": "SUM(o.amount_usd) FILTER (WHERE o.status = 'paid' AND o.refunded_at IS NULL)",
  "related_terms": ["fiscal_year", "active_customer"]
}
That sql_definition is gold — it tells the LLM exactly which columns and predicates to use. No more guessing whether refunds should be subtracted.

Step 3 — LLM picks the right schema
It now needs to know where revenue lives. The revenue glossary term appears in schemas.yml under the finance schema's glossary_terms. The LLM either:

already saw that during resources/list (descriptions only), and now reads the schema doc:

{ "method": "resources/read",
  "params": { "uri": "warehouse://semantic/schemas/finance" } }
This calls resources.js:121-148, which combines index.schemaDocs.get("finance") and index.schemas.get("finance") and returns purpose, owner, refresh cadence, sensitivity, and the list of tables in that schema (e.g. orders, customers, payments).

Step 4 — LLM picks the right table
Seeing orders in the table list, and knowing revenue's SQL references o.amount_usd and o.status, the LLM reads:


{ "method": "resources/read",
  "params": { "uri": "warehouse://semantic/tables/finance/orders" } }
This calls resources.js:159-163, which does index.tables.get("finance.orders"). The response is the full table doc — description, owner, refresh, every column with description and meta (sensitivity tags, units, sample values, deprecation flags).

Now the LLM knows the exact column names, data types, units, and which columns are sensitive — before writing any SQL.

Step 5 — LLM finally calls a tool
With all that grounding, the LLM constructs SQL and calls the query tool — the first server-side tool call of the whole interaction:


{ "method": "tools/call",
  "params": {
    "name": "query",
    "arguments": {
      "sql": "SELECT SUM(amount_usd) AS revenue_usd FROM finance.orders WHERE status = 'paid' AND refunded_at IS NULL AND paid_at >= date_trunc('month', current_date - interval '1 month') AND paid_at < date_trunc('month', current_date)"
    }
  }
}
This goes through the full pipeline at src/tools/registerAll.js:48-130 — role check, rate limit, pre-guardrails, query execution, result cap, post-guardrails (PII masking), audit. The result comes back as JSON in MCP content, the LLM phrases it for the user: "Revenue last month was $1,247,302."

Why this matters — what the resources prevented
Without semantic resources, the same question would have forced the LLM to:

Guess the schema name (finance? accounting? sales?). Often wrong on first try.
Call list_schemas and list_tables tools to discover everything. More tool roundtrips.
Call describe_table on plausible candidates to find the right columns. More roundtrips.
Guess what "revenue" means — gross vs net, with or without refunds, USD vs original currency. Often a wrong answer dressed up confidently.
With the resources, the LLM does 1–3 cheap resources/read calls (in-memory Map.gets, no warehouse I/O, no audit, no rate limit) and then issues one correct query. That's the whole point of separating resources (knowledge) from tools (actions): cheap lookups for context, expensive guarded calls for state changes.

Note on real client behavior
Different clients use resources differently — some auto-fetch all resources at session start, some let the model request them, some require the user to attach them manually. The server is agnostic; it just publishes the URIs and serves them when asked. The flow above is the canonical pattern with a model that follows the "read this BEFORE..." hint in the resource descriptions.