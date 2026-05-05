# BigQuery adapter

Read-only adapter for Google BigQuery using `@google-cloud/bigquery`.

## Required env

```
WAREHOUSE_TYPE=bigquery
GOOGLE_APPLICATION_CREDENTIALS=/opt/keys/bigquery-sa.json
BIGQUERY_PROJECT=my-gcp-project
BIGQUERY_LOCATION=US
```

`GOOGLE_APPLICATION_CREDENTIALS` is the standard GCP env var — point it at a service-account JSON key file.

For workload identity (GKE) or attached service accounts (Compute Engine, Cloud Run), omit `GOOGLE_APPLICATION_CREDENTIALS` and the SDK will use the ambient credentials.

## Recommended IAM

Grant the service account the smallest role that works:

- `roles/bigquery.dataViewer` — read-only access to data
- `roles/bigquery.metadataViewer` — read-only access to dataset/table metadata
- `roles/bigquery.jobUser` — required to run queries (jobs)

Restrict at the dataset level wherever possible:

```bash
bq add-iam-policy-binding \
  --member="serviceAccount:mcp-reader@my-project.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer" \
  my-project:analytics
```

## What works in v1

- `query` (auto-applies `LIMIT` via the SQL validator)
- `list_schemas` — returns BigQuery datasets in the configured project
- `list_tables`, `describe_table`
- `sample_table` — backtick-quoted three-part identifier `\`project.dataset.table\``

## Gotchas

- BigQuery bills by data scanned. There are no built-in cost guardrails in this adapter — pair it with project-level quotas (`bq query --max_billing_tier`) or BigQuery's reservations.
- Cross-project queries work, but `list_schemas` only enumerates datasets in `BIGQUERY_PROJECT`. To query a table in a different project, prefix it explicitly in the SQL.
- Dataset names are case-sensitive. Region is too — set `BIGQUERY_LOCATION` correctly (`US`, `EU`, `asia-northeast1`, etc.) or queries fail with a confusing "dataset not found" error.
- The adapter does not yet support views with authorized-view ACLs that exclude the service account — a future enhancement.
