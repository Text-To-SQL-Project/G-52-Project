-- Minimal sample database so the DB is real from day one.
-- Swap for a Chinook/Northwind or a BIRD database later (your eval reuses it).

CREATE TABLE customers (
    id       SERIAL PRIMARY KEY,
    name     VARCHAR(120) NOT NULL,
    country  VARCHAR(60)
);

CREATE TABLE orders (
    id           SERIAL PRIMARY KEY,
    customer_id  INTEGER NOT NULL REFERENCES customers(id),
    total        NUMERIC(10,2) NOT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO customers (name, country) VALUES
    ('Acme Corp','US'), ('Globex','US'), ('Initech','IN'),
    ('Umbrella','DE'), ('Soylent','US');

INSERT INTO orders (customer_id, total) VALUES
    (1, 12000.50), (1, 36210.00),
    (2, 39980.00),
    (3, 31245.75),
    (4, 28870.10),
    (5, 25510.00);

-- A read-only role: second layer of defence behind the guardrails.
CREATE ROLE readonly_app LOGIN PASSWORD 'readonly';
GRANT CONNECT ON DATABASE sample_shop TO readonly_app;
GRANT USAGE ON SCHEMA public TO readonly_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_app;
