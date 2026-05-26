-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 029 — Cote TVA configurabile per restaurant
-- ═══════════════════════════════════════════════════════════════
-- Cotele de TVA se schimbă de la stat la stat și de la lege la lege.
-- România în 2024-2025: 9%/19%/5%/0%, dar asta poate să se modifice.
-- Owner-ul își setează singur cele 4 cote, iar produsele/ingrediente
-- doar referențiază "grupa" (1-4), nu cota fixă.

-- ── Tabela: vat_rates per restaurant ──────────────────────────
create table if not exists public.vat_rates (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  vat_group     smallint not null check (vat_group between 1 and 4),
  rate_percent  numeric(5,2) not null check (rate_percent >= 0 and rate_percent <= 100),
  label         text not null check (length(label) > 0 and length(label) <= 60),
  description   text,
  is_active     boolean not null default true,
  updated_at    timestamptz not null default now(),
  primary key (restaurant_id, vat_group)
);

comment on table public.vat_rates is 'Cote TVA configurabile per restaurant. 4 grupe (1-4) cu cotă procentuală + label custom.';

alter table public.vat_rates enable row level security;

-- Owner can manage own rates
create policy "vat_rates: admin manage" on public.vat_rates for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

-- Public read pentru afișare în meniu QR (anon)
create policy "vat_rates: public read" on public.vat_rates for select
  using (is_active = true);

-- ── Trigger: auto-create defaults pentru restaurant nou ──────
create or replace function public.create_default_vat_rates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vat_rates (restaurant_id, vat_group, rate_percent, label, description)
  values
    (NEW.id, 1, 9.00,  'Mâncare',     'Mâncare, băuturi nealcoolice, apă, sucuri, cafea, ceai'),
    (NEW.id, 2, 19.00, 'Alcool',      'Bere, vin, spirtoase, țigări, accize'),
    (NEW.id, 3, 5.00,  'Special',     'Cazuri rare — verifică cu contabilul'),
    (NEW.id, 4, 0.00,  'Scutit',      'Produse scutite explicit de TVA')
  on conflict (restaurant_id, vat_group) do nothing;
  return NEW;
end;
$$;

drop trigger if exists create_vat_rates_trigger on public.restaurants;
create trigger create_vat_rates_trigger
  after insert on public.restaurants
  for each row execute function public.create_default_vat_rates();

-- ── Backfill pentru restaurantele existente ──────────────────
-- Toate restaurantele EXISTENTE primesc cote default (9/19/5/0)
insert into public.vat_rates (restaurant_id, vat_group, rate_percent, label, description)
select r.id, vg.vat_group, vg.rate_percent, vg.label, vg.description
from public.restaurants r
cross join (values
  (1::smallint, 9.00,  'Mâncare',  'Mâncare, băuturi nealcoolice'),
  (2::smallint, 19.00, 'Alcool',   'Alcool, țigări, accize'),
  (3::smallint, 5.00,  'Special',  'Cazuri rare'),
  (4::smallint, 0.00,  'Scutit',   'Scutit TVA')
) as vg(vat_group, rate_percent, label, description)
on conflict (restaurant_id, vat_group) do nothing;

-- ── Update vat_report_daily view to use dynamic rates ────────
create or replace view public.vat_report_daily as
select
  o.restaurant_id,
  date_trunc('day', o.paid_at)::date as report_date,
  coalesce(p.vat_group, 1) as vat_group,
  coalesce(vr.rate_percent, 0) as vat_rate_percent,
  coalesce(vr.label, '?') as vat_label,
  count(distinct o.id) as orders_count,
  sum(oi.item_total) as gross_total,
  -- TVA = gross × (rate / (100 + rate))
  sum(oi.item_total * (coalesce(vr.rate_percent, 0) / (100.0 + coalesce(vr.rate_percent, 0)))) as vat_amount,
  sum(oi.item_total * (100.0 / (100.0 + coalesce(vr.rate_percent, 0)))) as net_total
from public.orders o
join public.order_items oi on oi.order_id = o.id
left join public.products p on p.id = oi.product_id
left join public.vat_rates vr on vr.restaurant_id = o.restaurant_id
                              and vr.vat_group = coalesce(p.vat_group, 1)
where o.status = 'paid' and o.paid_at is not null
group by o.restaurant_id, date_trunc('day', o.paid_at)::date,
         coalesce(p.vat_group, 1), coalesce(vr.rate_percent, 0), coalesce(vr.label, '?');

grant select on public.vat_report_daily to authenticated;
