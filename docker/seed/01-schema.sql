-- Demo schema for the docker-compose Postgres backend.
-- Loaded automatically by the official postgres image from /docker-entrypoint-initdb.d/.

CREATE SCHEMA IF NOT EXISTS demo;

CREATE TABLE demo.customers (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  country      TEXT NOT NULL,
  signup_date  DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE demo.products (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL,
  category  TEXT NOT NULL,
  price     NUMERIC(10,2) NOT NULL
);

CREATE TABLE demo.orders (
  id           SERIAL PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES demo.customers(id),
  product_id   INTEGER NOT NULL REFERENCES demo.products(id),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  order_date   DATE NOT NULL,
  total_cents  INTEGER NOT NULL
);

CREATE INDEX idx_orders_customer ON demo.orders(customer_id);
CREATE INDEX idx_orders_product  ON demo.orders(product_id);
CREATE INDEX idx_orders_date     ON demo.orders(order_date);

-- Read-only role the MCP server connects as. Mirrors the recommendation
-- in docs/adapters/postgres.md.
CREATE ROLE mcp_reader WITH LOGIN PASSWORD 'mcp_reader_demo_pw';
GRANT CONNECT ON DATABASE warehouse TO mcp_reader;
GRANT USAGE ON SCHEMA demo TO mcp_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA demo TO mcp_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA demo GRANT SELECT ON TABLES TO mcp_reader;
