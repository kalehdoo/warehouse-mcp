/**
 * Postgres adapter contract test against a real Postgres via testcontainers.
 *
 * Runs the same WarehouseAdapter contract suite that DuckDB exercises in PR
 * CI (see test/adapters/duckdb.contract.test.js). Excluded from `npm test`
 * because spinning up the container takes ~10–20 s on a warm Docker daemon
 * and longer on first pull. Run with:
 *
 *   npm run test:integration
 *
 * Requires Docker to be running locally (or in the CI runner).
 */
import { GenericContainer } from "testcontainers";
import { runAdapterContract } from "../adapters/contract.js";
import { createPostgresAdapter } from "../../src/adapters/postgres.js";

let container;

runAdapterContract("Postgres (testcontainers)", async () => {
  container = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_PASSWORD: "test_pw",
      POSTGRES_DB: "warehouse",
    })
    .withExposedPorts(5432)
    .start();

  const adapter = createPostgresAdapter({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: "warehouse",
    user: "postgres",
    password: "test_pw",
    ssl: false,
    timeoutMs: 10_000,
  });

  return {
    adapter,
    dialect: "postgres",
    seed: async () => {
      await adapter.query(`CREATE SCHEMA IF NOT EXISTS demo`);
      await adapter.query(
        `CREATE TABLE demo.widgets (id INTEGER, name VARCHAR, color VARCHAR, price NUMERIC)`,
      );
      await adapter.query(
        `INSERT INTO demo.widgets VALUES (1,'a','red',1.5),(2,'b','blue',2.5),(3,'c','red',3.5),(4,'d','blue',4.5),(5,'e','green',5.5)`,
      );
      return { schema: "demo", table: "widgets" };
    },
  };
});
