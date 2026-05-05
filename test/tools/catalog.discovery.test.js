import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupDemo, teardown } from "./helpers.js";
import {
  findColumnsTool,
  getForeignKeysTool,
  getViewDefinitionTool,
} from "../../src/tools/catalog.js";

let env;

beforeEach(async () => {
  env = await setupDemo();
  // setupDemo creates demo.widgets without a PK; rebuild it with one so the
  // FK from widget_orders below is allowed by DuckDB's binder.
  await env.adapter.query(`DROP TABLE demo.widgets`);
  await env.adapter.query(
    `CREATE TABLE demo.widgets (
       id INTEGER PRIMARY KEY,
       name VARCHAR,
       color VARCHAR,
       price DOUBLE
     )`,
  );
  await env.adapter.query(
    `INSERT INTO demo.widgets VALUES
       (1,'alpha','red',1.5),
       (2,'beta','blue',2.5),
       (3,'gamma','red',3.5),
       (4,'delta','blue',4.5),
       (5,'epsilon','green',5.5)`,
  );
  await env.adapter.query(
    `CREATE TABLE demo.widget_orders (
       id INTEGER PRIMARY KEY,
       widget_id INTEGER REFERENCES demo.widgets(id),
       qty INTEGER,
       customer_email VARCHAR
     )`,
  );
  await env.adapter.query(
    `INSERT INTO demo.widget_orders VALUES
       (1,1,2,'ada@example.com'),
       (2,2,5,'alan@example.com'),
       (3,3,1,'grace@example.com')`,
  );
  await env.adapter.query(
    `CREATE VIEW demo.widget_revenue AS
     SELECT w.color, SUM(o.qty) AS units
     FROM demo.widgets w
     JOIN demo.widget_orders o ON o.widget_id = w.id
     GROUP BY w.color`,
  );
});

afterEach(teardown);

describe("find_columns tool", () => {
  it("finds columns by exact name pattern across tables", async () => {
    const result = await findColumnsTool.handler({ pattern: "%email%" }, env.ctx, env.deps);
    expect(result.count).toBeGreaterThanOrEqual(1);
    const names = result.matches.map((m) => `${m.table}.${m.column}`);
    expect(names).toContain("widget_orders.customer_email");
  });

  it("respects schema scoping", async () => {
    const result = await findColumnsTool.handler(
      { pattern: "%id%", schema: "demo" },
      env.ctx,
      env.deps,
    );
    expect(result.count).toBeGreaterThan(0);
    for (const m of result.matches) {
      expect(m.schema).toBe("demo");
    }
  });

  it("returns empty when pattern matches nothing", async () => {
    const result = await findColumnsTool.handler(
      { pattern: "%no_such_column_xyz%" },
      env.ctx,
      env.deps,
    );
    expect(result.count).toBe(0);
    expect(result.matches).toEqual([]);
  });
});

describe("get_foreign_keys tool", () => {
  it("returns the widget_id FK from widget_orders to widgets", async () => {
    const result = await getForeignKeysTool.handler(
      { schema: "demo", table: "widget_orders" },
      env.ctx,
      env.deps,
    );
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
    const fk = result.edges.find(
      (e) => e.from_column === "widget_id" && e.to_table === "widgets",
    );
    expect(fk).toBeTruthy();
    expect(fk.from_table).toBe("widget_orders");
    expect(fk.to_column).toBe("id");
  });

  it("returns empty for a table with no FKs", async () => {
    const result = await getForeignKeysTool.handler(
      { schema: "demo", table: "widgets" },
      env.ctx,
      env.deps,
    );
    expect(result.edges).toEqual([]);
  });
});

describe("get_view_definition tool", () => {
  it("returns the SQL body of a view", async () => {
    const result = await getViewDefinitionTool.handler(
      { schema: "demo", view: "widget_revenue" },
      env.ctx,
      env.deps,
    );
    expect(result.sql).toMatch(/SELECT/i);
    expect(result.sql).toMatch(/widget_orders/i);
    expect(result.sql).toMatch(/widgets/i);
  });

  it("throws NOT_FOUND for a missing view", async () => {
    await expect(
      getViewDefinitionTool.handler(
        { schema: "demo", view: "no_such_view" },
        env.ctx,
        env.deps,
      ),
    ).rejects.toMatchObject({ name: "WarehouseError", code: "NOT_FOUND" });
  });
});
