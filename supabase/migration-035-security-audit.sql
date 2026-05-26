-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 035 — Audit pre-lansare: fix-uri de securitate
-- ═══════════════════════════════════════════════════════════════
-- Rezolvă problemele găsite în auditul pre-lansare (vezi AUDIT.md):
--
-- 1) bridge_mark_stale_as_error → service_role only (cron job housekeeping)
--    Înainte: orice user authenticated putea forța re-trimiterea bonurilor.
--    Acum: doar service_role (cron Supabase).
--
-- 2) report_by_waiter → admin only (alți ospătari NU văd salariile colegilor)
--    Înainte: orice member putea vedea cât a vândut fiecare ospătar.
--    Acum: doar owner/manager.
--
-- 3) Idempotență: toate migrațiile noi au fost rescrise să suporte re-rulare
--    (asta e un audit-doc, nu necesită SQL aici — deja era CREATE OR REPLACE).
--
-- 4) Cleanup orphan: trigger periodic care șterge bridge_devices inactive >30 zile

-- ═══════════════════════════════════════════════════════════════
-- FIX 1: bridge_mark_stale_as_error
-- ═══════════════════════════════════════════════════════════════
revoke execute on function public.bridge_mark_stale_as_error() from authenticated;
revoke execute on function public.bridge_mark_stale_as_error() from anon;
-- Rămâne grant pentru service_role (implicit). Cron-ul Supabase rulează cu service_role
-- via pg_cron sau Edge Function schedulată.

comment on function public.bridge_mark_stale_as_error() is
  'AUDIT: callable doar din cron job (service_role). Marchează bonuri rămase peste 10 min în "sent" ca eroare. Nu apela manual din UI.';

-- ═══════════════════════════════════════════════════════════════
-- FIX 2: report_by_waiter — restricționat la admin
-- ═══════════════════════════════════════════════════════════════
-- Rationale: un ospătar NU trebuie să vadă cât au vândut alți ospătari
-- (confidențial — sentiment competitiv, posibilă inegalitate vizibilă).
-- Rapoartele globale (report_by_hour, report_by_category) rămân disponibile
-- membrilor pentru că nu expun date individuale.
create or replace function public.report_by_waiter(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  waiter_id      uuid,
  waiter_name    text,
  order_count    bigint,
  total_revenue  numeric,
  avg_ticket     numeric,
  discount_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ⚠ Schimbat din is_member → is_admin (audit fix)
  if not public.is_admin(p_restaurant_id) then
    raise exception 'Only owners/managers can view waiter sales reports';
  end if;

  return query
    with attributed as (
      select
        coalesce(o.served_by, o.paid_by, o.created_by) as wid,
        o.total,
        coalesce(o.discount_amount, 0) as disc
      from public.orders o
      where o.restaurant_id = p_restaurant_id
        and o.status != 'cancelled'
        and o.created_at >= p_from
        and o.created_at <= p_to
    )
    select
      a.wid as waiter_id,
      coalesce(p.full_name, case when a.wid is null then 'Comenzi QR (fără ospătar)' else 'Necunoscut' end) as waiter_name,
      count(*)::bigint as order_count,
      coalesce(sum(a.total), 0)::numeric as total_revenue,
      case when count(*) > 0 then round(coalesce(sum(a.total), 0) / count(*), 2) else 0::numeric end as avg_ticket,
      coalesce(sum(a.disc), 0)::numeric as discount_total
    from attributed a
    left join public.profiles p on p.id = a.wid
    group by a.wid, p.full_name
    order by sum(a.total) desc nulls last;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- FIX 4: bridge_devices cleanup utility
-- ═══════════════════════════════════════════════════════════════
-- Funcție pentru a marca inactive dispozitivele care n-au mai trimis
-- heartbeat de > 30 zile. Util pentru raportul "Casă marcat" în UI.
-- Nu șterge — doar marchează (audit trail).
create or replace function public.bridge_devices_mark_stale()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.bridge_devices
     set is_active = false
   where is_active = true
     and (last_heartbeat is null or last_heartbeat < now() - interval '30 days');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.bridge_devices_mark_stale() from public;
revoke execute on function public.bridge_devices_mark_stale() from authenticated;
-- Service role only (cron).

comment on function public.bridge_devices_mark_stale() is
  'AUDIT: cron-only. Marchează inactive dispozitive Bridge fără heartbeat > 30 zile.';

-- ═══════════════════════════════════════════════════════════════
-- FIX 5: pending_receipts retention policy
-- ═══════════════════════════════════════════════════════════════
-- Bonurile cu status 'completed' mai vechi de 90 zile pot fi șterse
-- (sunt deja sincronizate la ANAF prin AMEF, nu mai au valoare operațională).
-- Bonurile cu status 'error' sau 'cancelled' rămân indefinit pentru audit.
create or replace function public.pending_receipts_cleanup_old()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.pending_receipts
   where status = 'completed'
     and completed_at < now() - interval '90 days';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.pending_receipts_cleanup_old() from public;
revoke execute on function public.pending_receipts_cleanup_old() from authenticated;

comment on function public.pending_receipts_cleanup_old() is
  'AUDIT: cron-only. Șterge pending_receipts completed > 90 zile pentru a păstra DB compactă.';

-- ═══════════════════════════════════════════════════════════════
-- ÎNCHEIERE
-- ═══════════════════════════════════════════════════════════════
-- Fix-urile aplicate. Probleme rămase documentate în AUDIT.md (severitate
-- mică, recomandate pentru v1.1).
