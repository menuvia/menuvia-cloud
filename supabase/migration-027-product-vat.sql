-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 027 — Cota TVA pe produs
-- ═══════════════════════════════════════════════════════════════
-- În România cotele de TVA pentru HoReCa sunt:
--   • 9%  — mâncare, băuturi nealcoolice, cazare
--   • 19% — alcool, țigări, băuturi cu peste 0,5% alcool, alte
--   • 5%  — cazuri speciale (cărți, manuale, locuințe sociale)
--   • 0%  — scutit TVA
-- Default = 1 (9%) pentru că majoritatea produselor sunt mâncare.

alter table public.products
  add column if not exists vat_group smallint not null default 1
  check (vat_group between 1 and 4);

comment on column public.products.vat_group is
  'Cota TVA: 1=9% (mâncare/băuturi nealc.), 2=19% (alcool/țigări), 3=5% (special), 4=0% (scutit)';

-- Index pentru rapoarte contabile (group by vat_group)
create index if not exists idx_products_vat_group 
  on public.products(restaurant_id, vat_group)
  where is_active = true;
