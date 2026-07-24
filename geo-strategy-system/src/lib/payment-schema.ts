export const PAYMENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_payment_orders (
  id TEXT PRIMARY KEY,
  out_trade_no TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  recharge_request_id TEXT,
  package_key TEXT,
  package_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  credits INTEGER NOT NULL CHECK (credits >= 0),
  provider TEXT NOT NULL CHECK (provider IN ('manual_transfer', 'wechat', 'alipay', 'other')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'credited', 'canceled', 'failed', 'refunding', 'refunded')),
  payer_name TEXT,
  payment_reference TEXT,
  contact TEXT,
  note TEXT,
  provider_trade_id TEXT,
  paid_cents INTEGER,
  failure_reason TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  paid_at BIGINT,
  credited_at BIGINT,
  canceled_at BIGINT,
  refunded_at BIGINT,
  credited_by TEXT
);

ALTER TABLE geo_payment_orders
  ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT credits;

ALTER TABLE geo_payment_orders
  ADD COLUMN IF NOT EXISTS managed_service_order_id TEXT;

CREATE INDEX IF NOT EXISTS geo_payment_orders_managed_service_idx
  ON geo_payment_orders (managed_service_order_id)
  WHERE managed_service_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS geo_payment_orders_provider_trade_idx
  ON geo_payment_orders (provider, provider_trade_id)
  WHERE provider_trade_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS geo_payment_orders_recharge_request_idx
  ON geo_payment_orders (recharge_request_id)
  WHERE recharge_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS geo_payment_orders_user_created_idx
  ON geo_payment_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS geo_payment_orders_status_updated_idx
  ON geo_payment_orders (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS geo_payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('wechat', 'alipay')),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  out_trade_no TEXT,
  provider_trade_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  received_at BIGINT NOT NULL,
  processed_at BIGINT,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS geo_payment_events_order_received_idx
  ON geo_payment_events (out_trade_no, received_at DESC);

CREATE INDEX IF NOT EXISTS geo_payment_events_status_received_idx
  ON geo_payment_events (status, received_at DESC);
`
