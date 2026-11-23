-- A pairing code for a memory client carries the owner's personal-facts choice and the name they
-- gave it in Home to the device row made when it is redeemed.
ALTER TABLE pair_codes ADD COLUMN personal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pair_codes ADD COLUMN name TEXT NOT NULL DEFAULT '';
