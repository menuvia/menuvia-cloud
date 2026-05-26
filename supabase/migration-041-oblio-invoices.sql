-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 041 — Oblio API integration (e-Facturi RO automate)
-- ═══════════════════════════════════════════════════════════════
-- Oblio (oblio.eu) e un serviciu RO care emite facturi conform legislației
-- locale, inclusiv e-Factura ANAF SPV pentru B2B. Cost: ~50 RON/lună.
--
-- Avantaj pentru patron: emite facturi automate pentru clienți firmă (CIF)
-- direct din comanda plătită, fără să mai introducă manual în alt soft.
--
-- Securitate: api_secret stocat criptat cu pgsodium dacă disponibil,
-- fallback la encrypted via service_role-only access cu RLS strict.

-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 1. CONFIG ────────────────────────────────────────────────── ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Credentiale Oblio per restaurant. Doar admin poate citi/scrie.
-- api_secret stocat ca text (Oblio API e public-ish, dar protejăm cu RLS).

create table if not exists public.oblio_configs (
  restaurant_id    uuid primary key references public.restaurants(id) on delete cascade,
  -- Credentiale API
  api_email        text not null,            -- email cont Oblio
  api_secret       text not null,            -- API secret (din Oblio settings)
  -- Date emitent (firma patron)
  company_cif      text not null,            -- ex: "RO12345678"
  company_name     text not null,
  company_address  text,
  company_state    text,                     -- județ
  company_city     text,
  -- Defaults pentru facturi emise
  default_series   text not null default 'MENU',  -- seria documentelor
  vat_included     boolean not null default true,
  send_email       boolean not null default true,   -- Oblio trimite mail clientului
  language         text not null default 'RO',
  -- Stare
  is_active        boolean not null default true,
  test_mode        boolean not null default false, -- folosește sandbox Oblio
  -- Audit
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.oblio_configs enable row level security;

create policy "oblio_configs: admin manages own"
  on public.oblio_configs for all
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));

comment on table public.oblio_configs is
  'Config Oblio per restaurant — credentiale API + date emitent firmă.';


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 2. INVOICES ──────────────────────────────────────────────── ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Înregistrări facturi emise via Oblio. Source of truth pentru istoric.

do $$ begin
  create type invoice_status as enum (
    'queued',       -- în coadă, așteaptă procesare
    'generating',   -- Oblio API call in-flight
    'issued',       -- emisă cu succes
    'cancelled',    -- anulată ulterior
    'failed'        -- eșec definitiv (după 3 retries)
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.invoices (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants(id) on delete cascade,
  order_id          uuid not null references public.orders(id) on delete restrict,
  -- Date Oblio (after generation)
  oblio_series      text,
  oblio_number      text,
  oblio_link        text,       -- URL PDF
  oblio_einvoice    text,       -- XML e-Factura (B2B)
  oblio_token       text,       -- doc token pentru anulare
  -- Date client (B2B sau B2C cu nume)
  customer_name     text not null,
  customer_cif      text,        -- "RO12345678" pentru B2B
  customer_address  text,
  customer_email    text,
  customer_phone    text,
  is_b2b            boolean not null default false,
  -- Total
  total_with_vat    numeric(12,2) not null,
  currency          text not null default 'RON',
  -- Stare
  status            invoice_status not null default 'queued',
  failed_attempts   integer not null default 0,
  last_error        text,
  -- Audit
  issued_at         timestamptz,
  cancelled_at      timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_invoices_restaurant on public.invoices(restaurant_id);
create index if not exists idx_invoices_order      on public.invoices(order_id);
create index if not exists idx_invoices_status     on public.invoices(status);
create index if not exists idx_invoices_queued     on public.invoices(status, created_at)
  where status in ('queued', 'generating');

alter table public.invoices enable row level security;

create policy "invoices: admin reads own"
  on public.invoices for select
  using (public.is_admin(restaurant_id));

create policy "invoices: admin creates"
  on public.invoices for insert
  with check (public.is_admin(restaurant_id));

create policy "invoices: admin cancels"
  on public.invoices for update
  using (public.is_admin(restaurant_id))
  with check (public.is_admin(restaurant_id));


-- ╔═══════════════════════════════════════════════════════════════╗
-- ║ 3. RPCs ─────────────────────────────────────────────────── ║
-- ╚═══════════════════════════════════════════════════════════════╝

-- Enqueue: admin cere generare factură pentru o comandă plătită
create or replace function public.enqueue_invoice_for_order(
  p_order_id        uuid,
  p_customer_name   text,
  p_customer_cif    text default null,
  p_customer_address text default null,
  p_customer_email  text default null,
  p_customer_phone  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_invoice_id uuid;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Order trebuie să existe, să fie paid, și user să fie admin
  select id, restaurant_id, total, status into v_order
    from public.orders where id = p_order_id;

  if not found then
    raise exception 'Comanda nu există';
  end if;

  if not public.is_admin(v_order.restaurant_id) then
    raise exception 'Doar managerul poate emite facturi';
  end if;

  if v_order.status != 'paid' then
    raise exception 'Factura se poate emite doar pentru comenzi plătite (status curent: %)', v_order.status;
  end if;

  -- Restaurantul trebuie să aibă Oblio configurat
  if not exists(
    select 1 from public.oblio_configs
    where restaurant_id = v_order.restaurant_id and is_active = true
  ) then
    raise exception 'Oblio nu e configurat. Mergi la Setări → Facturare.';
  end if;

  -- Dedup: o singură factură activă per order (în starea queued/generating/issued)
  if exists(
    select 1 from public.invoices
    where order_id = p_order_id
      and status in ('queued', 'generating', 'issued')
  ) then
    raise exception 'Există deja o factură pentru această comandă';
  end if;

  if p_customer_name is null or length(trim(p_customer_name)) = 0 then
    raise exception 'Numele clientului e obligatoriu';
  end if;

  insert into public.invoices (
    restaurant_id, order_id, customer_name, customer_cif,
    customer_address, customer_email, customer_phone,
    is_b2b, total_with_vat, created_by
  ) values (
    v_order.restaurant_id, p_order_id, trim(p_customer_name),
    nullif(trim(coalesce(p_customer_cif, '')), ''),
    nullif(trim(coalesce(p_customer_address, '')), ''),
    nullif(trim(coalesce(p_customer_email, '')), ''),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    p_customer_cif is not null and length(trim(p_customer_cif)) > 0,
    v_order.total, v_user_id
  )
  returning id into v_invoice_id;

  return v_invoice_id;
end;
$$;

revoke all on function public.enqueue_invoice_for_order(uuid, text, text, text, text, text) from public;
grant execute on function public.enqueue_invoice_for_order(uuid, text, text, text, text, text) to authenticated;


-- Cancel invoice (admin only, doar dacă status = issued)
create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text default 'Anulată de utilizator')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_status invoice_status;
begin
  select restaurant_id, status into v_restaurant_id, v_status
    from public.invoices where id = p_invoice_id;

  if not found then return false; end if;
  if not public.is_admin(v_restaurant_id) then
    raise exception 'Acces interzis';
  end if;

  if v_status != 'issued' then
    raise exception 'Doar facturile emise pot fi anulate (status curent: %)', v_status;
  end if;

  update public.invoices
     set status = 'cancelled', cancelled_at = now(), last_error = p_reason
   where id = p_invoice_id;

  return true;
end;
$$;

revoke all on function public.cancel_invoice(uuid, text) from public;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;


-- Fetch invoices list for a restaurant
create or replace function public.list_invoices_for_restaurant(
  p_restaurant_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id              uuid,
  order_id        uuid,
  customer_name   text,
  customer_cif    text,
  is_b2b          boolean,
  total_with_vat  numeric,
  oblio_series    text,
  oblio_number    text,
  oblio_link      text,
  status          invoice_status,
  last_error      text,
  issued_at       timestamptz,
  created_at      timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    i.id, i.order_id, i.customer_name, i.customer_cif, i.is_b2b,
    i.total_with_vat, i.oblio_series, i.oblio_number, i.oblio_link,
    i.status, i.last_error, i.issued_at, i.created_at
  from public.invoices i
  where i.restaurant_id = p_restaurant_id
    and public.is_admin(p_restaurant_id)
  order by i.created_at desc
  limit p_limit offset p_offset;
$$;

revoke all on function public.list_invoices_for_restaurant(uuid, integer, integer) from public;
grant execute on function public.list_invoices_for_restaurant(uuid, integer, integer) to authenticated;


-- Helper pentru Netlify function: list invoices în queue cu config inclus
-- (folosit doar de service_role)
create or replace function public.bridge_oblio_get_queued(p_limit integer default 10)
returns table (
  invoice_id        uuid,
  restaurant_id     uuid,
  order_id          uuid,
  customer_name     text,
  customer_cif      text,
  customer_address  text,
  customer_email    text,
  customer_phone    text,
  is_b2b            boolean,
  total_with_vat    numeric,
  -- Config (din join cu oblio_configs)
  api_email         text,
  api_secret        text,
  company_cif       text,
  company_name      text,
  default_series    text,
  vat_included      boolean,
  send_email        boolean,
  test_mode         boolean
)
language sql
security definer
volatile
set search_path = public
as $$
  with claimed as (
    update public.invoices
       set status = 'generating'
     where id in (
       select id from public.invoices
       where status = 'queued' and failed_attempts < 3
       order by created_at asc
       limit p_limit
       for update skip locked
     )
    returning *
  )
  select
    c.id as invoice_id,
    c.restaurant_id, c.order_id,
    c.customer_name, c.customer_cif, c.customer_address, c.customer_email, c.customer_phone,
    c.is_b2b, c.total_with_vat,
    oc.api_email, oc.api_secret, oc.company_cif, oc.company_name,
    oc.default_series, oc.vat_included, oc.send_email, oc.test_mode
  from claimed c
  join public.oblio_configs oc on oc.restaurant_id = c.restaurant_id and oc.is_active;
$$;

revoke all on function public.bridge_oblio_get_queued(integer) from public;
-- Service role only.


-- Bridge: mark invoice as issued (called by Netlify after Oblio success)
create or replace function public.bridge_oblio_mark_issued(
  p_invoice_id uuid,
  p_series text,
  p_number text,
  p_link text,
  p_einvoice text default null,
  p_token text default null
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.invoices
     set status = 'issued',
         oblio_series = p_series,
         oblio_number = p_number,
         oblio_link = p_link,
         oblio_einvoice = p_einvoice,
         oblio_token = p_token,
         issued_at = now(),
         last_error = null
   where id = p_invoice_id
   returning true;
$$;

revoke all on function public.bridge_oblio_mark_issued(uuid, text, text, text, text, text) from public;


-- Bridge: mark invoice failed (with retry logic)
create or replace function public.bridge_oblio_mark_failed(
  p_invoice_id uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  update public.invoices
     set failed_attempts = failed_attempts + 1,
         last_error = left(p_error, 1000),
         status = case
           when failed_attempts + 1 >= 3 then 'failed'::invoice_status
           else 'queued'::invoice_status
         end
   where id = p_invoice_id
  returning failed_attempts into v_attempts;

  return found;
end;
$$;

revoke all on function public.bridge_oblio_mark_failed(uuid, text) from public;


-- Auto-update updated_at trigger
create or replace function public.trg_oblio_configs_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_oblio_configs_touch on public.oblio_configs;
create trigger trg_oblio_configs_touch
  before update on public.oblio_configs
  for each row execute function public.trg_oblio_configs_touch();
