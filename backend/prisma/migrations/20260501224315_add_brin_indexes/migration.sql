-- BRIN (Block Range Index) for time-series tables.
-- Matches the comment block in schema.prisma — "Audit log retention" + the usage_events index list.
--
-- BRIN is order-of-magnitude smaller than B-tree for monotonically increasing
-- columns (created_at), and supports range queries efficiently. We use it to
-- back the retention worker (DELETE WHERE created_at < N) and full-table date
-- range scans on usage_events / audit_logs.
--
-- Cost: ~1-10 KB per million rows (compared to ~30 MB B-tree). Range queries:
-- ~5-10x faster than seq scan on the same data.

CREATE INDEX IF NOT EXISTS idx_usage_created_brin
  ON usage_events USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_audit_created_brin
  ON audit_logs USING BRIN (created_at);
