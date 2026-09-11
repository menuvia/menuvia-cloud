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
-- Sursa de adevăr e jurnalul de audit (mig 044): orice scriere pe `products`
-- lasă `old_data`/`new_data` complete, deci numele ȘI `vat_group` sunt păstrate.
-- Potrivirea se face pe (restaurant, nume), cu `order_items.product_name_snapshot`
-- — numele de la VÂNZARE (mig 003). Se citește TOT istoricul numelui, nu doar
-- rândul de ștergere: un produs reclasificat ÎNAINTE de ștergere ar face ca
-- ștergerea să raporteze o grupă pe care vânzarea nu a avut-o.
--
-- DISCIPLINĂ (jurnal fiscal, nu date de lucru):
--   * se ating DOAR liniile fără snapshot ȘI fără produs — nicio linie cu
--     snapshot nu e rescrisă, deci scriptul e idempotent;
--   * un nume care în acel restaurant a purtat VREODATĂ grupe TVA diferite —
--     fie prin produse diferite, fie prin reclasificarea aceluiași produs, fie
--     fiindcă un produs VIU poartă azi acel nume cu altă grupă — e AMBIGUU: se
--     SARE (rămâne pe fallback-ul documentat), nu se ghicește. A sări o linie o
--     lasă exact cum e azi; a ghici ar da unui jurnal fiscal aparența de
--     certitudine peste o presupunere;
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

-- Totul stă într-UN SINGUR bloc, cu handler de excepție: trigger-ul de
-- sincronizare a subtotalului (mig 248) se dezactivează pe durata lucrului —
-- altfel fiecare comandă atinsă ar primi un UPDATE pe `orders` (audit 044 +
-- gate-urile BEFORE UPDATE), iar un total deja bonat ar putea fi „reparat" tăcut
-- din liniile curente. Dezactivarea trebuie să se RIDICE și pe calea de eroare:
-- dacă scriptul e rulat fără `-1` (fiecare instrucțiune își face commit), un
-- `alter table ... disable` urmat de o excepție ar lăsa trigger-ul STINS în
-- producție — adică subtotalurile ar înceta tăcut să se mai sincronizeze. Într-un
-- `do` cu `exception`, eșecul dă înapoi subtranzacția (deci și dezactivarea), iar
-- handler-ul re-activează explicit înainte de a re-arunca: fail-safe în ambele
-- moduri de rulare.
do $$
declare
  v_fixed     bigint := 0;
  v_ambiguous bigint := 0;
  v_unmatched bigint := 0;
  v_rec       record;
begin
  execute 'alter table public.order_items disable trigger order_items_subtotal_sync_upd';
  perform set_config('menuvia.skip_item_audit', 'on', true);
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

  -- Grupele TVA pe care le-a purtat VREODATĂ un nume, per restaurant.
  --
  -- Rândul DELETE singur NU e de ajuns: un produs poate fi RECLASIFICAT (grupa 1
  -- → 2) și abia apoi șters, caz în care ștergerea spune 2, dar vânzarea s-ar fi
  -- putut face cât timp era 1 — exact defectul pe care îl repară mig 272, doar
  -- că strecurat înapoi prin ușa din dos. De aceea se ia TOT istoricul de audit
  -- al numelui (orice operație, grupa din AMBELE instantanee) plus produsele
  -- care încă EXISTĂ cu acel nume (un nume reutilizat de un produs viu cu altă
  -- grupă e la fel de ambiguu). `n_grupe > 1` → se sare, nu se ghicește.
  create temp table _deleted_groups on commit drop as
  with hist as (
    select al.restaurant_id,
           coalesce(al.old_data->>'name', al.new_data->>'name') as nume,
           v.vg::smallint                                       as vat_group
      from public.audit_log al
      cross join lateral (values (al.old_data->>'vat_group'),
                                 (al.new_data->>'vat_group')) as v(vg)
     where al.table_name    = 'products'
       and al.restaurant_id is not null
       and v.vg ~ '^[0-9]+$'          -- old_data poate conține orice; nu presupunem un număr
    union all
    select p.restaurant_id, p.name, p.vat_group
      from public.products p
     where p.vat_group is not null
  )
  select restaurant_id,
         nume,
         min(vat_group)           as vat_group,
         count(distinct vat_group) as n_grupe
    from hist
   where nume is not null
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

  execute 'alter table public.order_items enable trigger order_items_subtotal_sync_upd';
exception
  when others then
    -- Ieșirea din subtranzacție a dat deja înapoi dezactivarea; re-activăm
    -- explicit fiindcă e idempotent și fiindcă ne bazăm pe STARE, nu pe presupuneri.
    execute 'alter table public.order_items enable trigger order_items_subtotal_sync_upd';
    raise;
end $$;
