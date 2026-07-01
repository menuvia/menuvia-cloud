-- Migration 177: hardening — revoke select on invite_tokens from anon
-- ─────────────────────────────────────────────────────────────────────
-- Audit (severity low): mig 095 (`20260614001000`) revocă SELECT de la
-- `anon` pe tabele sensibile (bridge_devices, pending_receipts). Lipsea,
-- simetric, revoke-ul echivalent pe `public.invite_tokens` (email/role/
-- token bearer). `anon` nu deține azi grant-ul (revoke-ul e inert), deci
-- e pur defense-in-depth; îl adăugăm pentru simetrie și claritate.
-- Revoke pe un grant inexistent nu dă eroare în Postgres → idempotent.
-- Citirea unui token specific rămâne exclusiv prin RPC `preview_invite`.
-- ─────────────────────────────────────────────────────────────────────

-- ── invite_tokens: revoke select on anon (simetrie cu 095) ────
revoke select on public.invite_tokens from anon;
