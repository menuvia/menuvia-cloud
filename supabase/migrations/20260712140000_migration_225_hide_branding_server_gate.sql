-- ═══════════════════════════════════════════════════════════════════
-- Migration 225: gate server-side pentru theme_settings.hide_branding
-- ─────────────────────────────────────────────────────────────────────
-- Review-ul adversarial pe E1 a confirmat: opt-out-ul de branding („Fără
-- badge «Creat cu Menuvia»", beneficiu growth+ prin plan_features
-- .remove_branding, mig 028) era gate-uit DOAR în UI (SettingsTab).
-- `theme_settings` are grant UPDATE column-level pentru authenticated
-- (mig 096B), deci un owner pe free/starter putea seta flag-ul direct
-- prin PostgREST — exact clasa de „gate-leak UI" reparată la order_qr
-- (mig 127) și accent_override (documentat în themes.ts).
--
-- Mecanism: BEFORE INSERT/UPDATE pe restaurants — dacă noul theme_settings
-- cere hide_branding=true dar restaurantul NU are feature-ul, flag-ul se
-- NORMALIZEAZĂ tăcut la false (nu respingem: salvarea legitimă a altor
-- setări de temă de pe un plan mic nu trebuie să eșueze). Badge-ul e buclă
-- virală, nu bani — normalizarea e suficientă și prietenoasă.
--
-- Reziduu documentat (acceptat): la DOWNGRADE flag-ul deja salvat rămâne
-- până la următoarea scriere pe theme_settings (trigger-ul nu re-rulează pe
-- schimbarea planului, care stă pe profiles). Citirile publice nu re-verifică
-- planul. Ne-critic: beneficiul dispare oricum din UI, iar orice salvare de
-- temă ulterioară curăță flag-ul.
-- ═══════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.fn_normalize_hide_branding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.theme_settings is not null
     and coalesce((new.theme_settings->>'hide_branding')::boolean, false)
     and not public.restaurant_has_feature(new.id, 'remove_branding') then
    new.theme_settings := jsonb_set(new.theme_settings, '{hide_branding}', 'false'::jsonb);
  end if;
  return new;
exception when others then
  -- Fail-safe pe jsonb malformat (ex. hide_branding ne-boolean): normalizăm
  -- flag-ul la false în loc să blocăm tot UPDATE-ul de restaurant.
  if new.theme_settings is not null then
    new.theme_settings := jsonb_set(new.theme_settings, '{hide_branding}', 'false'::jsonb);
  end if;
  return new;
end$$;

drop trigger if exists trg_normalize_hide_branding on public.restaurants;
create trigger trg_normalize_hide_branding
  before insert or update of theme_settings on public.restaurants
  for each row execute function public.fn_normalize_hide_branding();

comment on function public.fn_normalize_hide_branding() is
  $$Gate server-side pentru theme_settings.hide_branding (beneficiu
  plan_features.remove_branding, growth+): pe planuri fără feature flag-ul se
  normalizează la false în loc să fie respins (salvările legitime de temă
  trec). Oglindește gate-ul de UI din SettingsTab.$$;

-- ── Asserții fail-closed ──────────────────────────────────────────
do $$
declare v_def text;
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_normalize_hide_branding'
      and tgrelid = 'public.restaurants'::regclass
  ) then
    raise exception 'ASSERT FAIL (mig 225): trigger-ul de normalizare lipsește';
  end if;
  v_def := pg_get_functiondef('public.fn_normalize_hide_branding()'::regprocedure);
  if position('remove_branding' in v_def) = 0 or position('restaurant_has_feature' in v_def) = 0 then
    raise exception 'ASSERT FAIL (mig 225): funcția nu verifică plan_features.remove_branding';
  end if;
  if position('search_path' in v_def) = 0 then
    raise exception 'ASSERT FAIL (mig 225): funcția fără search_path fixat';
  end if;
end $$;

commit;
