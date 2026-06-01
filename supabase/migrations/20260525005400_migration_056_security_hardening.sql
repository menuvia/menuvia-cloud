-- =============================================================
-- Migration 056: security hardening — search_path on SECURITY
-- DEFINER + advisory lock on rate limit + hex CHECK on
-- restaurants.primary_color.
--
-- Findings F-C, F-D, F-O din audit rundă 4.
-- =============================================================

-- F-C: `check_qr_order_rate_limit` a fost creat în mig 012 SECURITY DEFINER
-- dar fără `set search_path`. Mig 038 a fixat enforce_product/table/restaurant_limit
-- analog, dar a sărit peste această funcție.
--
-- F-O: rate-limit-ul citește count() + clientul cheamă RPC ulterior — TOCTOU
-- race permite burst-uri care depășesc pragul 3-comenzi/2-min. Adăugarea unui
-- pg_advisory_xact_lock pe hash(qr_token_id) serializează request-urile pe
-- același token (zero impact pe tokenuri diferite).
create or replace function public.check_qr_order_rate_limit(p_qr_token_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_qr_token_id is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('qr_rate:' || p_qr_token_id::text));
  if (
    select count(*) from public.orders
    where qr_token_id = p_qr_token_id
      and created_at > now() - interval '2 minutes'
      and status not in ('cancelled', 'paid')
  ) >= 3 then
    raise exception 'Prea multe comenzi în ultimele 2 minute de la această masă.';
  end if;
end;
$$;

-- F-D: validare format '#rrggbb' pentru primary_color. Client-side validarea
-- e în src/lib/themes.ts:isValidHexColor, dar și DB-ul trebuie să refuze
-- payload-uri fabricate (mass-assignment + alte căi viitoare).
do $$ begin
  alter table public.restaurants
    add constraint restaurants_primary_color_hex_chk
    check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null; end $$;
