import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupDemo, teardown } from "./helpers.js";
import { countRowsTool, timeSeriesTool } from "../../src/tools/profile.js";

let env;

beforeEach(async () => {
  env = await setupDemo();
  await env.adapter.query(
    `CREATE TABLE demo.events (
       id INTEGER,
       event_at DATE,
       amount DOUBLE
     )`,
  );
  await env.adapter.query(
    `INSERT INTO demo.events VALUES
       (1, '2026-01-05', 10.0),
       (2, '2026-01-12', 20.0),
       (3, '2026-01-19', 30.0),
       (4, '2026-02-02', 40.0),
       (5, '2026-02-15', 50.0),
       (6, '2026-03-10', 60.0)`,
  );
});

afterEach(teardown);

describe("count_rows tool", () => {
  it("returns the row count of a table", async () => {
    const result = await countRowsTool.handler(
      { schema: "demo", table: "widgets" },
      env.ctx,
      env.deps,
    );
    expect(result.row_count).toBe(5);
  });

  it("returns the row count of an empty table", async () => {
    await env.adapter.query(`CREATE TABLE demo.empty_t (x INTEGER)`);
    const result = await countRowsTool.handler(
      { schema: "demo", table: "empty_t" },
      env.ctx,
      env.deps,
    );
    expect(result.row_count).toBe(0);
  });
});

describe("time_series tool", () => {
  it("buckets by month with COUNT (default agg)", async () => {
    const result = await timeSeriesTool.handler(
      { schema: "demo", table: "events", date_column: "event_at", period: "month" },
      env.ctx,
      env.deps,
    );
    // 3 distinct months in the seed (Jan, Feb, Mar 2026)
    expect(result.points.length).toBe(3);
    expect(result.points[0].value).toBeDefined();
  });

  it("buckets by week with SUM(amount)", async () => {
    const result = await timeSeriesTool.handler(
      {
        schema: "demo",
        table: "events",
        date_column: "event_at",
        period: "week",
        agg: "sum",
        metric_column: "amount",
      },
      env.ctx,
      env.deps,
    );
    expect(result.points.length).toBeGreaterThan(0);
    const total = result.points.reduce((a, p) => a + Number(p.value), 0);
    // sum of 10+20+30+40+50+60 = 210
    expect(total).toBeCloseTo(210, 5);
  });

  it("rejects sum/avg/min/max without metric_column", async () => {
    await expect(
      timeSeriesTool.handler(
        { schema: "demo", table: "events", date_column: "event_at", period: "day", agg: "sum" },
        env.ctx,
        env.deps,
      ),
    ).rejects.toMatchObject({ name: "WarehouseError", code: "UNSUPPORTED" });
  });

  it("rejects unsupported period", async () => {
    await expect(
      timeSeriesTool.handler(
        { schema: "demo", table: "events", date_column: "event_at", period: "decade" },
        env.ctx,
        env.deps,
      ),
    ).rejects.toThrow();
  });
});
