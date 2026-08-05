-- 0001: Provision the isolated application schemas for stellar-launch.
-- The gateway, billing, and fee-sponsor services each own a schema, so their
-- tables are isolated while sharing one PostgreSQL instance.
CREATE SCHEMA IF NOT EXISTS "gateway";
CREATE SCHEMA IF NOT EXISTS "billing";
CREATE SCHEMA IF NOT EXISTS "fee-sponsor";