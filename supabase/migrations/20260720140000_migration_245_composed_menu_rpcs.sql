-- Migration 245: RPC-uri COMPUSE pentru meniul client — 1 RTT în loc de 2 (OPT-4)
-- ─────────────────────────────────────────────────────────────────────
-- Cele mai fierbinți suprafețe anon fac azi 2 round-trip-uri SERIALE
-- dependente (~100-300ms fiecare pe 4G de restaurant):
--   • scanare QR:  resolve_qr_token(token)  → get_menu_for_restaurant(id)
--   • /m/:slug:    get_restaurant_by_slug   → get_menu_for_restaurant(id)
--
-- Compunem PURE (zero duplicare de proiecție): funcțiile noi DOAR cheamă
-- RPC-urile existente — whitelist-urile (fără wifi_password/qr_token,
-- mig 217/219), filtrele de vizibilitate anon (mig 212) și gate-urile de
-- modul se MOȘTENESC integral. O recreare viitoare a funcțiilor de bază se
-- propagă automat aici. Clientul le încearcă ÎNTÂI și cade pe fluxul în doi
-- pași dacă RPC-ul lipsește (frontend înaintea migrației) — fallback-ul din
-- qr.ts NU se șterge.
-- ─────────────────────────────────────────────────────────────────────
begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. resolve_qr_menu — scanarea QR pe un singur RTT ────────────────
create or replace function public.resolve_qr_menu(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resolved jsonb;
  v_rid      uuid;
begin
  -- Erorile de business (token invalid, plan gate, restaurant inactiv) se
  -- propagă NEschimbate din resolve_qr_token — același contract cu clientul.
  v_resolved := public.resolve_qr_token(p_token);
  v_rid := (v_resolved->'restaurant'->>'id')::uuid;
  return jsonb_build_object(
    'resolved', v_resolved,
    'menu', case
      when v_rid is not null then public.get_menu_for_restaurant(v_rid)
      else null
    end
  );
end$$;

revoke all on function public.resolve_qr_menu(text) from public;
grant execute on function public.resolve_qr_menu(text) to anon, authenticated;

comment on function public.resolve_qr_menu(text) is
  $$Compunere PURĂ resolve_qr_token + get_menu_for_restaurant (mig 245) — un
singur RTT la scanarea QR. Zero proiecții proprii: whitelist-urile și
gate-urile funcțiilor de bază se moștenesc integral.$$;

-- ── 2. get_menu_by_slug — /m/:slug pe un singur RTT ──────────────────
create or replace function public.get_menu_by_slug(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
begin
  select * into v_row from public.get_restaurant_by_slug(p_slug);
  if not found or v_row.id is null then
    return null;  -- slug inexistent — clientul afișează 404-ul existent
  end if;
  return jsonb_build_object(
    'restaurant', to_jsonb(v_row),
    'menu',       public.get_menu_for_restaurant(v_row.id)
  );
end$$;

revoke all on function public.get_menu_by_slug(text) from public;
grant execute on function public.get_menu_by_slug(text) to anon, authenticated;

comment on function public.get_menu_by_slug(text) is
  $$Compunere PURĂ get_restaurant_by_slug + get_menu_for_restaurant (mig 245)
— un singur RTT pe /m/:slug. Proiecția restaurantului vine EXCLUSIV din
get_restaurant_by_slug (anti-leak mig 217/219 moștenit).$$;

-- ── Asserții fail-closed ─────────────────────────────────────────────
do $$
declare v_src text;
begin
  -- resolve_qr_menu: compunere pură — fără citiri directe de tabele.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_qr_menu';
  if v_src is null then raise exception 'mig 245: resolve_qr_menu lipsește'; end if;
  if position('resolve_qr_token' in v_src) = 0
     or position('get_menu_for_restaurant' in v_src) = 0 then
    raise exception 'mig 245: resolve_qr_menu nu mai compune funcțiile de bază'; end if;
  if v_src ~* 'from\s+(public\.)?(restaurants|products|categories|qr_tokens)\b' then
    raise exception 'mig 245: resolve_qr_menu citește tabele direct — anti-leak compromis'; end if;

  -- get_menu_by_slug: proiecția vine DOAR din get_restaurant_by_slug.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_menu_by_slug';
  if v_src is null then raise exception 'mig 245: get_menu_by_slug lipsește'; end if;
  if position('get_restaurant_by_slug' in v_src) = 0
     or position('get_menu_for_restaurant' in v_src) = 0 then
    raise exception 'mig 245: get_menu_by_slug nu mai compune funcțiile de bază'; end if;
  if v_src ~* 'from\s+(public\.)?restaurants\b' then
    raise exception 'mig 245: get_menu_by_slug citește restaurants direct — anti-leak compromis'; end if;

  raise notice 'mig 245: RPC-uri compuse (1 RTT pe QR + /m/:slug) OK';
end $$;

commit;
