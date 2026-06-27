-- mig 108 — Întărirea RPC-ului anonim record_affiliate_touch (findings AF-1/AF-2)
--
-- Auditul a găsit două probleme la endpoint-ul anonim (anon) de la /r/:cod:
--   AF-1: visitor_id nu era validat server-side. Slice(0,64) exista DOAR în
--         client → un caller direct putea trimite visitor_id arbitrar (gol,
--         uriaș, sau de o singură literă) și polua tabela affiliate_touches.
--   AF-2: niciun rate-limit → un atacator putea flood-a tabela cu touch-uri pe
--         visitor_id-uri unice (dedup-ul nu ajută când cookie_value variază).
--
-- Fix (bariere REALE în RPC, nu în UI):
--   (a) BOUND pe lungimea p_visitor_id: 8..128 caractere (după btrim). În afara
--       intervalului → return {ok:false, reason:'bad_visitor_id'}, fără insert.
--   (b) RATE-LIMIT defensiv per cod: ≥ 200 touch-uri în ultimele 60s pentru acest
--       referral_code → return {ok:false, reason:'rate_limited'}, fără insert.
--       Plafon larg, ca să nu afecteze trafic legit; previne flood-ul tabelei.
--
-- Restul logicii (dedup natural, întoarce jsonb, grant anon) rămâne IDENTIC.

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ═══════════════════════════════════════════════════════════════════════════
-- record_affiliate_touch — aceeași semnătură, același comportament + bariere
--   server-side (length bound pe visitor_id + rate-limit defensiv per cod).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.record_affiliate_touch(
  p_referral_code text,
  p_visitor_id    text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_aff_id   uuid;
  v_visitor  text;
  v_recent   bigint;
begin
  if p_referral_code is null or btrim(p_referral_code) = ''
     or p_visitor_id is null or btrim(p_visitor_id) = '' then
    return jsonb_build_object('ok', true, 'skipped', 'bad_input');
  end if;

  -- (a) BOUND pe lungimea visitor_id-ului (bariera reală — nu doar slice în client).
  --     Folosim valoarea trimmed și pentru validare, și pentru insert (consistent).
  v_visitor := btrim(p_visitor_id);
  if length(v_visitor) < 8 or length(v_visitor) > 128 then
    return jsonb_build_object('ok', false, 'reason', 'bad_visitor_id');
  end if;

  select id into v_aff_id
    from public.affiliates
   where referral_code = lower(btrim(p_referral_code)) and status = 'active';
  if not found then
    return jsonb_build_object('ok', true, 'skipped', 'unknown_code');
  end if;

  -- (b) RATE-LIMIT defensiv per cod: dacă în ultimele 60s s-au înregistrat deja
  --     ≥ 200 touch-uri pentru acest afiliat → refuzăm (anti-flood al tabelei).
  select count(*) into v_recent
    from public.affiliate_touches
   where affiliate_id = v_aff_id
     and created_at >= now() - interval '60 seconds';
  if v_recent >= 200 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Un singur touch per (afiliat, visitor): păstrăm PRIMUL (earliest) — exact
  -- ce-i trebuie gate-ului. Dedup → fără pile-up la /r/ repetate, anti-spam.
  insert into public.affiliate_touches (affiliate_id, referred_profile_id, cookie_value)
  select v_aff_id, null, v_visitor
   where not exists (
     select 1 from public.affiliate_touches
      where affiliate_id = v_aff_id and cookie_value = v_visitor
   );

  return jsonb_build_object('ok', true);
end$$;

revoke all on function public.record_affiliate_touch(text, text) from public;
grant execute on function public.record_affiliate_touch(text, text) to anon, authenticated;

comment on function public.record_affiliate_touch(text, text) is
  'Înregistrează un touch (server-side) la /r/:cod. Un rând per (afiliat, visitor). '
  'mig 108: bound 8..128 pe visitor_id + rate-limit defensiv (≥200/60s per cod).';

-- ── Asserții inline ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='record_affiliate_touch'
       and p.pronargs=2 and p.prosecdef) then
    raise exception 'mig 108: record_affiliate_touch missing (2 args, security definer)';
  end if;
  raise notice 'mig 108: affiliate touch hardening OK';
end $$;

commit;
