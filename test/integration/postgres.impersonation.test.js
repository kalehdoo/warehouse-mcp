/**
 * Verifies that Postgres adapter's warehouseRole option actually issues
 * SET ROLE on the connection — i.e. the warehouse evaluates queries under
 * the impersonated identity, not the connection's superuser.
 *
 * Strategy: spin up Postgres via testcontainers, create a restricted role
 * that can only see one of two tables, then prove the adapter:
 *   1. without warehouseRole: sees both tables (superuser)
 *   2. with warehouseRole=restricted_role: only sees the allowed table
 *
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GenericContainer } from "testcontainers";
import { createPostgresAdapter } from "../../src/adapters/postgres.js";

let container;
let adapter;

beforeAll(async () => {
  container = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_PASSWORD: "test_pw",
      POSTGRES_DB: "warehouse",
    })
    .withExposedPorts(5432)
    .start();

  adapter = createPostgresAdapter({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: "warehouse",
    user: "postgres",
    password: "test_pw",
    ssl: false,
    timeoutMs: 10_000,
  });

  // Seed: two schemas; restricted_role has SELECT on `public_schema` only.
  await adapter.query(`CREATE SCHEMA public_schema`);
  await adapter.query(`CREATE SCHEMA private_schema`);
  await adapter.query(`CREATE TABLE public_schema.widgets (id INT, name TEXT)`);
  await adapter.query(`CREATE TABLE private_schema.salaries (employee TEXT, amount INT)`);
  await adapter.query(`INSERT INTO public_schema.widgets VALUES (1,'red'),(2,'blue')`);
  await adapter.query(`INSERT INTO private_schema.salaries VALUES ('alice',100000),('bob',120000)`);

  // The role must NOT inherit superuser privs. NOLOGIN keeps it role-only.
  await adapter.query(`CREATE ROLE restricted_role NOLOGIN`);
  await adapter.query(`GRANT USAGE ON SCHEMA public_schema TO restricted_role`);
  await adapter.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public_schema TO restricted_role`);
  // Deliberately no grants on private_schema.

  // Postgres only lets you SET ROLE to roles you're a member of.
  await adapter.query(`GRANT restricted_role TO postgres`);
}, 90_000);

afterAll(async () => {
  await adapter?.close();
  await container?.stop();
});

describe("Postgres warehouseRole impersonation", () => {
  it("without warehouseRole, the adapter (as superuser) sees private_schema", async () => {
    const r = await adapter.query(`SELECT count(*)::int AS n FROM private_schema.salaries`);
    expect(r.rows[0].n).toBe(2);
  });

  it("with warehouseRole=restricted_role, private_schema access is denied by Postgres RLS/grants", async () => {
    await expect(
      adapter.query(`SELECT count(*) FROM private_schema.salaries`, {
        warehouseRole: "restricted_role",
      }),
    ).rejects.toMatchObject({ name: "WarehouseError", code: "QUERY_FAILED" });
  });

  it("with warehouseRole=restricted_role, public_schema access still works", async () => {
    const r = await adapter.query(`SELECT count(*)::int AS n FROM public_schema.widgets`, {
      warehouseRole: "restricted_role",
    });
    expect(r.rows[0].n).toBe(2);
  });

  it("RESET ROLE happens after the call — superuser access restored on the next query", async () => {
    // First, run an impersonated query
    await adapter.query(`SELECT 1`, { warehouseRole: "restricted_role" });
    // Then a normal query — must still see private_schema (proves RESET worked)
    const r = await adapter.query(`SELECT count(*)::int AS n FROM private_schema.salaries`);
    expect(r.rows[0].n).toBe(2);
  });

  it("rejects warehouseRole that is not a valid identifier (defense vs SQL injection in the role field)", async () => {
    await expect(
      adapter.query(`SELECT 1`, { warehouseRole: "evil; DROP TABLE widgets" }),
    ).rejects.toMatchObject({ name: "WarehouseError", code: "PERMISSION_DENIED" });
  });
});
