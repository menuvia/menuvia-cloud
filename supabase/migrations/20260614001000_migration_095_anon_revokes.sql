-- Migration 095: P1 — închide enumerări/leak-uri pe RLS public
-- ─────────────────────────────────────────────────────────────────────
-- Audit critic §6 (MEDIU): tabele cu grant la anon care pot scurge PII
-- sau permit enumerare tenant. Toate inerte azi (RLS blochează SELECT),
-- dar sunt footgun: dacă cineva adaugă vreodată policy USING(true)/all,
-- expunerea devine instantanee. Defense in depth.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. bridge_devices: revoke select on anon ──────────────────
-- Audit: bridge_devices conține `device_secret` (256 biți, scope per
-- restaurant). Grant inerte la anon (RLS cere is_member, anon=0 rânduri),
-- dar dacă viitor: anon poate citi instant toate secretele.
revoke select on public.bridge_devices from anon;

-- ── 2. pending_receipts: idem ─────────────────────────────────
-- Conține detalii fiscale (bon_number, customer info), accesate doar
-- prin RPC bridge_get_pending care derivă restaurant_id din device_secret.
revoke select on public.pending_receipts from anon;

-- ── 3. invite_tokens: strânge policy public USING(true) ───────
-- Audit: mig 007:131 `invite_tokens: public read using(true)` →
-- expune email/role/token la anon (enumerare PII + bearer token).
-- Înlocuim cu policy strict care nu permite SELECT *. Citirea unui
-- token specific rămâne prin RPC `preview_invite` (mig 012:397).
do $$ begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invite_tokens'
      and policyname = 'invite_tokens: public read'
  ) then
    drop policy "invite_tokens: public read" on public.invite_tokens;
  end if;
end $$;

-- ── 4. restaurants: strânge policy „public read by slug" ──────
-- Audit: mig 013:142 `using (is_active = true)` permite SELECT *
-- (enumerare tenant). Înlocuim cu policy care întoarce 0 rânduri pe
-- citire directă; pagina publică folosește deja RPC
-- `get_restaurant_by_slug` (mig 054, SECURITY DEFINER).
do $$ begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'restaurants'
      and policyname = 'restaurants: public read by slug'
  ) then
    drop policy "restaurants: public read by slug" on public.restaurants;
  end if;
end $$;

-- Verificare manuală post-deploy:
-- 1. ca anon: select count(*) from invite_tokens; -- 0 rânduri (nu mai există policy)
-- 2. ca anon: select count(*) from restaurants; -- 0 rânduri (citirea trece doar prin RPC)
-- 3. ca anon: select 1 from bridge_devices limit 1; -- permission denied
-- 4. supabase.rpc('get_restaurant_by_slug', {p_slug:'tinctura'}) → întoarce restaurantul
