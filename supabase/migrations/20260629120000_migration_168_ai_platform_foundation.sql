-- mig 168 — Fundația platformei AI (chatbot + import meniu din poze)
-- ─────────────────────────────────────────────────────────────────────
-- Construiește backend-ul pentru:
--   • BYO API per restaurant (provider + model + base_url + cheie CRIPTATĂ)
--     — cheia se criptează în funcția Netlify `ai-proxy` (AES, secret în env);
--       DB-ul stochează DOAR ciphertext, niciodată plaintext, și nu îl întoarce
--       vreodată în client (revoke column-level pe api_key_encrypted).
--   • Metering consum AI per restaurant (`ai_usage`).
--   • Cotă HIBRIDĂ (`ai_quota`): tokens incluși/lună (din plan, ajustabili de
--     fondator) + sold de credite cumpărate (top-up). Consum: întâi incluși,
--     apoi credite.
--   • Admin de platformă (fondator): flag `profiles.is_platform_admin` +
--     `is_platform_admin()` + RPC-uri de overview/limite gate-uite pe el.
--
-- Convenții (vezi CLAUDE.md): RPC-uri SECURITY DEFINER cu search_path fix,
-- PUBLIC zero EXECUTE, grant explicit; scrierile sensibile pe service_role;
-- idempotent; asserții fail-closed la final.
-- ─────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout      = '10s';
set local statement_timeout = '120s';

-- ── 1. Platform admin (fondator) ────────────────────────────────────
alter table public.profiles
  add column if not exists is_platform_admin boolean not null default false;

-- Seed: fondatorul (după email-ul din profiles). Idempotent; dacă profilul nu
-- există încă, nu face nimic (se poate re-rula migrarea fără efect).
update public.profiles
   set is_platform_admin = true
 where lower(email) = lower('georgeradu119@gmail.com')
   and is_platform_admin = false;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;
revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

-- ── 2. Config AI per restaurant (BYO) ───────────────────────────────
create table if not exists public.ai_provider_configs (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null unique references public.restaurants(id) on delete cascade,
  provider          text not null check (provider in ('openai', 'anthropic', 'gemini', 'custom')),
  model             text not null default '',
  base_url          text,                       -- doar pt 'custom' (OpenAI-compatible)
  api_key_encrypted text,                       -- ciphertext (AES din ai-proxy); NICIODATĂ plaintext
  enabled           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.ai_provider_configs enable row level security;

-- RLS: owner/manager al restaurantului poate citi rândul (dar NU cheia — vezi
-- revoke column-level mai jos). Scrierile trec prin Netlify (service_role).
drop policy if exists "ai_config: admin read" on public.ai_provider_configs;
create policy "ai_config: admin read"
  on public.ai_provider_configs for select
  to authenticated
  using (public.is_admin(restaurant_id));

-- Column-level: clientul NU vede ciphertext-ul cheii. Revocăm tot, apoi
-- acordăm SELECT doar pe coloanele ne-sensibile.
revoke all on public.ai_provider_configs from anon, authenticated;
grant select (id, restaurant_id, provider, model, base_url, enabled, created_at, updated_at)
  on public.ai_provider_configs to authenticated;

-- ── 3. Metering consum AI ───────────────────────────────────────────
create table if not exists public.ai_usage (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  created_at     timestamptz not null default now(),
  feature        text not null check (feature in ('chat', 'menu_import')),
  provider       text not null default '',
  model          text not null default '',
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  total_tokens   integer generated always as (input_tokens + output_tokens) stored,
  cost_estimate  numeric(12, 6) not null default 0,
  success        boolean not null default true,
  error          text
);

create index if not exists idx_ai_usage_restaurant_time
  on public.ai_usage(restaurant_id, created_at desc);

alter table public.ai_usage enable row level security;

-- RLS: owner/manager citește consumul propriu; fondatorul vede tot. Insert
-- DOAR prin service_role (proxy) — revocat de la authenticated.
drop policy if exists "ai_usage: read own or platform" on public.ai_usage;
create policy "ai_usage: read own or platform"
  on public.ai_usage for select
  to authenticated
  using (public.is_admin(restaurant_id) or public.is_platform_admin());

revoke insert, update, delete on public.ai_usage from anon, authenticated;

-- ── 4. Cotă hibridă (incluși din plan + credite top-up) ─────────────
create table if not exists public.ai_quota (
  restaurant_id    uuid primary key references public.restaurants(id) on delete cascade,
  period_start     date not null default date_trunc('month', now())::date,
  included_tokens  integer not null default 50000,  -- cota lunară inclusă (ajustabilă de fondator)
  used_tokens      integer not null default 0,       -- consum în perioada curentă
  credit_balance   integer not null default 0,       -- tokens cumpărați (top-up), nu expiră
  updated_at       timestamptz not null default now()
);

alter table public.ai_quota enable row level security;

drop policy if exists "ai_quota: read own or platform" on public.ai_quota;
create policy "ai_quota: read own or platform"
  on public.ai_quota for select
  to authenticated
  using (public.is_admin(restaurant_id) or public.is_platform_admin());

-- Scrieri doar prin RPC-uri definer / service_role.
revoke insert, update, delete on public.ai_quota from anon, authenticated;

-- Asigură existența rândului de cotă + rulează (roll) perioada lunară.
create or replace function public.ai_ensure_quota(p_restaurant_id uuid)
returns public.ai_quota
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.ai_quota;
  v_month date := date_trunc('month', now())::date;
begin
  insert into public.ai_quota (restaurant_id, period_start)
    values (p_restaurant_id, v_month)
  on conflict (restaurant_id) do nothing;

  -- Roll perioada: lună nouă → reset consum inclus (creditele rămân).
  update public.ai_quota
     set period_start = v_month, used_tokens = 0, updated_at = now()
   where restaurant_id = p_restaurant_id and period_start < v_month;

  select * into v_row from public.ai_quota where restaurant_id = p_restaurant_id;
  return v_row;
end;
$$;
revoke all on function public.ai_ensure_quota(uuid) from public, anon, authenticated;
grant execute on function public.ai_ensure_quota(uuid) to service_role;

-- Poate restaurantul să mai consume ~p_est_tokens? (incluși rămași + credite)
create or replace function public.ai_can_use(p_restaurant_id uuid, p_est_tokens integer default 0)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.ai_quota;
  v_remaining integer;
begin
  v := public.ai_ensure_quota(p_restaurant_id);
  v_remaining := greatest(v.included_tokens - v.used_tokens, 0) + v.credit_balance;
  return v_remaining >= greatest(coalesce(p_est_tokens, 0), 0);
end;
$$;
revoke all on function public.ai_can_use(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_can_use(uuid, integer) to service_role;

-- Înregistrează consum: scrie ai_usage + scade cota (întâi incluși, apoi credite).
create or replace function public.ai_record_usage(
  p_restaurant_id uuid,
  p_feature       text,
  p_provider      text,
  p_model         text,
  p_input_tokens  integer,
  p_output_tokens integer,
  p_cost          numeric default 0,
  p_success       boolean default true,
  p_error         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.ai_quota;
  v_total integer := greatest(coalesce(p_input_tokens, 0), 0) + greatest(coalesce(p_output_tokens, 0), 0);
  v_from_included integer;
  v_from_credit integer;
begin
  insert into public.ai_usage (restaurant_id, feature, provider, model,
                               input_tokens, output_tokens, cost_estimate, success, error)
    values (p_restaurant_id, p_feature, coalesce(p_provider, ''), coalesce(p_model, ''),
            greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0),
            coalesce(p_cost, 0), coalesce(p_success, true), p_error);

  -- Scade din cotă DOAR pentru apeluri reușite.
  if coalesce(p_success, true) then
    v := public.ai_ensure_quota(p_restaurant_id);
    v_from_included := least(greatest(v.included_tokens - v.used_tokens, 0), v_total);
    v_from_credit   := least(v.credit_balance, v_total - v_from_included);
    update public.ai_quota
       set used_tokens    = used_tokens + v_from_included,
           credit_balance = credit_balance - v_from_credit,
           updated_at     = now()
     where restaurant_id = p_restaurant_id;
  end if;

  v := public.ai_ensure_quota(p_restaurant_id);
  return jsonb_build_object(
    'recorded_tokens', v_total,
    'included_remaining', greatest(v.included_tokens - v.used_tokens, 0),
    'credit_balance', v.credit_balance
  );
end;
$$;
revoke all on function public.ai_record_usage(uuid, text, text, text, integer, integer, numeric, boolean, text)
  from public, anon, authenticated;
grant execute on function public.ai_record_usage(uuid, text, text, text, integer, integer, numeric, boolean, text)
  to service_role;

-- Adaugă credite cumpărate (top-up) — apelat de webhook-ul Stripe (service_role).
create or replace function public.ai_add_credits(p_restaurant_id uuid, p_tokens integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.ai_quota;
begin
  if coalesce(p_tokens, 0) <= 0 then
    raise exception 'ai_add_credits: numărul de tokens trebuie să fie pozitiv';
  end if;
  perform public.ai_ensure_quota(p_restaurant_id);
  update public.ai_quota
     set credit_balance = credit_balance + p_tokens, updated_at = now()
   where restaurant_id = p_restaurant_id
  returning * into v;
  return jsonb_build_object('credit_balance', v.credit_balance);
end;
$$;
revoke all on function public.ai_add_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_add_credits(uuid, integer) to service_role;

-- Cota pt UI restaurant (owner/manager): cât a rămas. NU expune cheia.
create or replace function public.ai_get_quota(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.ai_quota;
begin
  if not (public.is_admin(p_restaurant_id) or public.is_platform_admin()) then
    raise exception 'Acces interzis';
  end if;
  v := public.ai_ensure_quota(p_restaurant_id);
  return jsonb_build_object(
    'period_start', v.period_start,
    'included_tokens', v.included_tokens,
    'used_tokens', v.used_tokens,
    'included_remaining', greatest(v.included_tokens - v.used_tokens, 0),
    'credit_balance', v.credit_balance
  );
end;
$$;
revoke all on function public.ai_get_quota(uuid) from public, anon;
grant execute on function public.ai_get_quota(uuid) to authenticated, service_role;

-- ── 5. RPC-uri fondator (platform admin) ────────────────────────────
-- Overview consum + cotă per restaurant. Gate strict pe is_platform_admin().
create or replace function public.admin_ai_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis: doar platform admin';
  end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_result
  from (
    select r.id   as restaurant_id,
           r.name as restaurant_name,
           q.included_tokens,
           q.used_tokens,
           q.credit_balance,
           coalesce(u.total_30d, 0)        as tokens_30d,
           coalesce(u.cost_30d, 0)         as cost_30d
      from public.restaurants r
      left join public.ai_quota q on q.restaurant_id = r.id
      left join (
        select restaurant_id,
               sum(total_tokens) as total_30d,
               sum(cost_estimate) as cost_30d
          from public.ai_usage
         where created_at >= now() - interval '30 days'
         group by restaurant_id
      ) u on u.restaurant_id = r.id
     order by coalesce(u.total_30d, 0) desc
  ) t;
  return v_result;
end;
$$;
revoke all on function public.admin_ai_overview() from public, anon;
grant execute on function public.admin_ai_overview() to authenticated;

-- Setează cota lunară inclusă pt un restaurant (limită). Doar platform admin.
create or replace function public.admin_set_ai_limit(p_restaurant_id uuid, p_included_tokens integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.ai_quota;
begin
  if not public.is_platform_admin() then
    raise exception 'Acces interzis: doar platform admin';
  end if;
  if coalesce(p_included_tokens, -1) < 0 then
    raise exception 'admin_set_ai_limit: limita nu poate fi negativă';
  end if;
  perform public.ai_ensure_quota(p_restaurant_id);
  update public.ai_quota
     set included_tokens = p_included_tokens, updated_at = now()
   where restaurant_id = p_restaurant_id
  returning * into v;
  return jsonb_build_object('restaurant_id', v.restaurant_id, 'included_tokens', v.included_tokens);
end;
$$;
revoke all on function public.admin_set_ai_limit(uuid, integer) from public, anon;
grant execute on function public.admin_set_ai_limit(uuid, integer) to authenticated;

-- ── Asserții fail-closed ────────────────────────────────────────────
do $$
begin
  -- Tabele + RLS active
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='ai_provider_configs') then
    raise exception 'mig 168: ai_provider_configs lipsește'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='ai_usage') then
    raise exception 'mig 168: ai_usage lipsește'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='ai_quota') then
    raise exception 'mig 168: ai_quota lipsește'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ai_provider_configs'::regclass) then
    raise exception 'mig 168: RLS off pe ai_provider_configs'; end if;

  -- Clientul NU trebuie să poată citi cheia criptată (column-level)
  if has_column_privilege('authenticated', 'public.ai_provider_configs', 'api_key_encrypted', 'SELECT') then
    raise exception 'mig 168: authenticated poate citi api_key_encrypted (trebuie revocat)'; end if;

  -- Scrieri sensibile NU sunt permise lui authenticated
  if has_table_privilege('authenticated', 'public.ai_usage', 'INSERT') then
    raise exception 'mig 168: authenticated poate insera în ai_usage'; end if;
  if has_table_privilege('authenticated', 'public.ai_quota', 'UPDATE') then
    raise exception 'mig 168: authenticated poate modifica ai_quota'; end if;

  -- Funcțiile de fondator nu sunt executabile de anon
  if has_function_privilege('anon', 'public.admin_ai_overview()', 'EXECUTE') then
    raise exception 'mig 168: anon poate executa admin_ai_overview'; end if;

  -- Proxy-ul (service_role) poate înregistra consum
  if not has_function_privilege('service_role',
       'public.ai_record_usage(uuid, text, text, text, integer, integer, numeric, boolean, text)', 'EXECUTE') then
    raise exception 'mig 168: service_role nu poate executa ai_record_usage'; end if;

  raise notice 'mig 168: AI platform foundation OK';
end $$;

commit;
