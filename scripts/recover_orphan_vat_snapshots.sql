-- scripts/recover_orphan_vat_snapshots.sql
-- =============================================================================
-- RECUPERARE ISTORICĂ, rulată MANUAL de fondator — NU face parte din lanțul de
-- migrații (nu e în supabase/migrations/) și NU se rulează automat niciodată.
--
-- Context (mig 272 / audit v3 RES-20). Backfill-ul din mig 272 a pus grupa+cota
-- pe liniile care mai au un produs. Liniile al căror produs fusese ȘTERS înainte
-- de migrație au `product_id` NULL (FK `on delete set null`) și rămân fără
-- snapshot — cititorii cad pe `coalesce(..., 1)`, adică raportează TOATĂ istoria
-- lor în GRUPA 1, la cota curentă a grupei 1.
--
-- Măsurat pe producție la 11 sept 2026: 16 din 53 de linii (447,00 lei, toate pe
-- comenzi `paid`, un singur restaurant `enterprise`, deci INTRĂ în raportul TVA).
-- Dintre ele, „Vin pahar" (2 linii, 36,00 lei) era în grupa 2 — raportată azi ca
-- grupă 1. Restul chiar erau grupa 1, deci fără efect.
--
-- Sursa de adevăr e jurnalul de audit (mig 044): ștergerea unui produs scrie un
-- rând `audit_log` DELETE cu `old_data` complet, deci numele ȘI `vat_group` de la
-- momentul ștergerii sunt păstrate. Potrivirea se face pe (restaurant, nume), cu
-- `order_items.product_name_snapshot` — numele de la VÂNZARE (mig 003).
--
-- DISCIPLINĂ (jurnal fiscal, nu date de lucru):
--   * se ating DOAR liniile fără snapshot ȘI fără produs — nicio linie cu
--     snapshot nu e rescrisă, deci scriptul e idempotent;
--   * un nume care în același restaurant a aparținut unor produse cu grupe TVA
--     DIFERITE e AMBIGUU: se SARE (rămâne pe fallback-ul documentat), nu se
--     ghicește. A sări o linie o lasă exact cum e azi; a ghici ar da unui
--     jurnal fiscal aparența de certitudine peste o presupunere;
--   * liniile fără nicio potrivire (audit curățat, nume schimbat) rămân NULL;
--   * cota scrisă e cea CURENTĂ a grupei recuperate — aceeași regulă ca
--     backfill-ul din mig 272; pe producție s-a verificat că NICIUN restaurant
--     nu are `vat_rates.updated_at` după prima încasare, deci „curent" = „de la
--     vânzare" pentru tot istoricul de azi. Dacă grupa nu e configurată la acel
--     restaurant, se scrie doar grupa, iar cota rămâne NULL (cititorii cad pe
--     cota curentă a grupei — corect).
--
-- CUM SE RULEAZĂ (o singură tranzacție, se poate inspecta și da înapoi):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/recover_orphan_vat_snapshots.sql
--
-- Scriptul NU conține `begin`/`commit`: `psql -1` îl încadrează, iar suita de
-- teste îl include (`\i`) în propria tranzacție (VS9).
-- =============================================================================

-- Trigger-ul de sincronizare a subtotalului (mig 248) se dezactivează pe durata
-- tranzacției, exact ca în backfill-ul din mig 272: altfel fiecare comandă
-- atinsă ar primi un UPDATE pe `orders` (audit 044 + gate-urile BEFORE UPDATE),
-- iar un total deja bonat ar putea fi „reparat" tăcut din liniile curente.
alter table public.order_items disable trigger order_items_subtotal_sync_upd;
select set_config('menuvia.skip_item_audit', 'on', true);

do $$
declare
  v_fixed     bigint := 0;
  v_ambiguous bigint := 0;
  v_unmatched bigint := 0;
  v_rec       record;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'order_items'
       and column_name = 'vat_group_snapshot') then
    raise exception 'recover_orphan_vat_snapshots: mig 272 nu e aplicată (lipsește order_items.vat_group_snapshot)';
  end if;

  -- Candidații: linii orfane (fără produs) și fără snapshot, cu nume de la vânzare.
  create temp table _orphan_candidates on commit drop as
  select oi.id,
         o.restaurant_id,
         oi.product_name_snapshot as nume
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.vat_group_snapshot is null
     and oi.product_id is null
     and oi.product_name_snapshot is not null;

  -- Grupele ștergerilor din jurnal, per (restaurant, nume). `n_grupe > 1` =
  -- același nume a purtat grupe diferite → ambiguu → se sare.
  create temp table _deleted_groups on commit drop as
  select al.restaurant_id,
         al.old_data->>'name'                        as nume,
         min((al.old_data->>'vat_group')::smallint)  as vat_group,
         count(distinct al.old_data->>'vat_group')   as n_grupe
    from public.audit_log al
   where al.table_name = 'products'
     and al.operation  = 'DELETE'
     and al.old_data ? 'vat_group'
     and al.old_data ? 'name'
     and al.restaurant_id is not null
   group by 1, 2;

  update public.order_items oi
     set vat_group_snapshot = s.vat_group,
         vat_rate_snapshot  = vr.rate_percent
    from _orphan_candidates c
    join _deleted_groups s
      on s.restaurant_id = c.restaurant_id
     and s.nume          = c.nume
     and s.n_grupe       = 1                  -- fail-closed: ambiguu → nu se atinge
    left join public.vat_rates vr
      on vr.restaurant_id = c.restaurant_id
     and vr.vat_group     = s.vat_group
   where oi.id = c.id
     and s.vat_group between 1 and 4;         -- respectă CHECK-ul coloanei
  get diagnostics v_fixed = row_count;

  select count(*) into v_ambiguous
    from _orphan_candidates c
    join _deleted_groups s
      on s.restaurant_id = c.restaurant_id and s.nume = c.nume
   where s.n_grupe > 1;

  select count(*) into v_unmatched
    from _orphan_candidates c
   where not exists (select 1 from _deleted_groups s
                      where s.restaurant_id = c.restaurant_id and s.nume = c.nume);

  raise notice 'recover_orphan_vat_snapshots: % linii recuperate din jurnalul de audit, % sărite ca AMBIGUE, % fără potrivire (rămân pe fallback-ul grupei 1)',
    v_fixed, v_ambiguous, v_unmatched;

  for v_rec in
    select c.nume, count(*) as linii
      from _orphan_candidates c
      join _deleted_groups s
        on s.restaurant_id = c.restaurant_id and s.nume = c.nume
     where s.n_grupe > 1
     group by 1 order by 2 desc
  loop
    raise notice '  AMBIGUU (nesetat): „%" — % linii, nume purtat de produse cu grupe TVA diferite', v_rec.nume, v_rec.linii;
  end loop;
end $$;

alter table public.order_items enable trigger order_items_subtotal_sync_upd;
