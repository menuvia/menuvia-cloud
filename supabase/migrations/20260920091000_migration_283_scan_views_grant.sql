-- migration_283_scan_views_grant.sql
-- =============================================================================
-- `daily_scans` / `weekly_scans` devin CITIBILE (RESID-14, partea de citire).
--
-- ── Ce s-a măsurat ───────────────────────────────────────────────────────────
-- Pe PRODUCȚIE, 20 sept 2026, înainte de a scrie codul:
--
--   relname       relkind  security_invoker  auth_select  politici
--   daily_scans   v        true              FALSE        0
--   weekly_scans  v        true              FALSE        0
--   qr_scans      r        —                 true         1   ("qr_scans: member read")
--
-- Adică: view-urile există din `base_schema` (recreate cu `security_invoker` în
-- mig 008), dar **n-au avut NICIODATĂ grant de SELECT pentru `authenticated`**.
-- Sunt suprafețe MOARTE: rolul cu care vorbește aplicația nu le poate citi.
--
-- ── De ce contează acum ──────────────────────────────────────────────────────
-- Acest PR conectează `record_qr_scan` (necheamat de nimeni din mai 2026;
-- `qr_scans` = 0 rânduri pe prod, cu 35 de mese cu token activ). A scrie rânduri
-- într-o tabelă ale cărei agregate nu pot fi citite de aplicație ar reproduce
-- exact clasa `invoices.oblio_einvoice`: scris din mig 041, citit de NIMENI până
-- în mig 269 — date capturate și aruncate la UI. Grantul închide bucla.
--
-- ── De ce e SIGUR ────────────────────────────────────────────────────────────
-- Ambele view-uri sunt `security_invoker = true` (mig 008), deci se evaluează cu
-- drepturile APELANTULUI: RLS-ul de pe `qr_scans` ("qr_scans: member read", cu
-- `public.is_member(restaurant_id)`) rămâne autoritatea. Grantul nu lărgește
-- vizibilitatea — doar o face ACCESIBILĂ. Un membru vede scanările localului
-- lui și ale nimănui altcuiva; `anon` NU primește nimic (nu are nici pe tabelă).
-- Clichetul de clasă RP9 (orice view citibil de client are `security_invoker`)
-- rămâne satisfăcut, fiindcă amândouă îl au deja.
-- =============================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant select on public.daily_scans  to authenticated;
grant select on public.weekly_scans to authenticated;

comment on view public.daily_scans is
  'Scanari QR agregate pe zi. mig 283: a primit grant SELECT pentru authenticated — pana atunci era security_invoker DAR fara grant, deci necitibila de aplicatie (suprafata moarta). RLS-ul de pe qr_scans ramane autoritatea.';
comment on view public.weekly_scans is
  'Scanari QR agregate pe saptamana. Vezi nota de pe daily_scans (mig 283).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Asserțiuni: grantul EXISTĂ, `security_invoker` n-a fost pierdut, iar `anon`
-- NU a primit nimic. Fără a treia verificare, un `grant ... to public` viitor ar
-- trece neobservat.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_v text;
begin
  foreach v_v in array array['daily_scans', 'weekly_scans'] loop
    if not has_table_privilege('authenticated', 'public.' || v_v, 'select') then
      raise exception 'mig 283: % tot nu e citibila de authenticated', v_v;
    end if;
    if has_table_privilege('anon', 'public.' || v_v, 'select') then
      raise exception 'mig 283: % a devenit citibila de ANON — scanarile sunt date de business', v_v;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = v_v and c.relkind = 'v'
         and 'security_invoker=true' = any(c.reloptions)
    ) then
      raise exception 'mig 283: % nu mai are security_invoker=true — grantul ar ocoli RLS-ul de pe qr_scans', v_v;
    end if;
  end loop;
end$$;

commit;
