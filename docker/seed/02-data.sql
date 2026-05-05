-- Small ecommerce dataset so the demo has something interesting to query.
-- Volumes are deliberately small (rows, not gigabytes) — the goal is for
-- a developer evaluating warehouse-mcp to ask "top customers by revenue?"
-- and get a result that proves the chain works end-to-end.

INSERT INTO demo.customers (name, email, country, signup_date) VALUES
  ('Ada Lovelace',       'ada@example.com',     'UK', '2024-01-15'),
  ('Alan Turing',        'alan@example.com',    'UK', '2024-02-03'),
  ('Grace Hopper',       'grace@example.com',   'US', '2024-02-22'),
  ('Linus Torvalds',     'linus@example.com',   'FI', '2024-03-10'),
  ('Margaret Hamilton',  'margaret@example.com','US', '2024-03-28'),
  ('Tim Berners-Lee',    'tim@example.com',     'UK', '2024-04-12'),
  ('Donald Knuth',       'donald@example.com',  'US', '2024-04-30'),
  ('Barbara Liskov',     'barbara@example.com', 'US', '2024-05-15'),
  ('Brian Kernighan',    'brian@example.com',   'CA', '2024-06-01'),
  ('Vint Cerf',          'vint@example.com',    'US', '2024-06-20');

INSERT INTO demo.products (name, category, price) VALUES
  ('Mechanical Keyboard',    'electronics', 149.99),
  ('Standing Desk',          'furniture',    449.00),
  ('Aeron Chair',            'furniture',    995.00),
  ('USB-C Hub',              'electronics',   59.99),
  ('Noise-Cancel Headphones','electronics',  349.00),
  ('Coffee Beans 1kg',       'food',          22.50),
  ('Espresso Machine',       'appliances',   799.00),
  ('Notebook (pack of 5)',   'office',        18.00),
  ('Monitor 27"',            'electronics',  329.00),
  ('Bookshelf',              'furniture',    179.00);

-- 30 orders spread across customers + products + dates.
INSERT INTO demo.orders (customer_id, product_id, quantity, order_date, total_cents) VALUES
  (1, 1, 1, '2024-04-02', 14999),
  (1, 4, 2, '2024-04-15',  11998),
  (1, 9, 1, '2024-05-10', 32900),
  (2, 2, 1, '2024-04-20', 44900),
  (2, 5, 1, '2024-05-05', 34900),
  (3, 3, 1, '2024-04-25', 99500),
  (3, 7, 1, '2024-05-12', 79900),
  (3, 9, 2, '2024-06-01', 65800),
  (4, 1, 2, '2024-04-18', 29998),
  (4, 8, 5, '2024-05-20',  9000),
  (5, 6, 4, '2024-05-22',  9000),
  (5, 4, 1, '2024-06-05',  5999),
  (6, 5, 1, '2024-05-15', 34900),
  (6, 9, 1, '2024-06-10', 32900),
  (7, 3, 1, '2024-05-25', 99500),
  (7, 2, 1, '2024-06-15', 44900),
  (8, 1, 1, '2024-06-02', 14999),
  (8, 7, 1, '2024-06-25', 79900),
  (9, 10, 1,'2024-06-08', 17900),
  (9, 6, 2, '2024-06-22',  4500),
  (10, 4, 3,'2024-06-12', 17997),
  (10, 8, 2,'2024-06-28',  3600),
  (1, 6, 3, '2024-06-30',  6750),
  (2, 8, 4, '2024-06-30',  7200),
  (3, 1, 1, '2024-07-01', 14999),
  (4, 5, 1, '2024-07-03', 34900),
  (5, 3, 1, '2024-07-05', 99500),
  (6, 7, 1, '2024-07-07', 79900),
  (7, 9, 1, '2024-07-09', 32900),
  (8, 2, 1, '2024-07-11', 44900);
