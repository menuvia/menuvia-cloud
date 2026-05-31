-- ════════════════════════════════════════════════════════════════════════
-- SCRIPT ONE-OFF: Upgrade plan utilizator la 'business' (top tier)
-- ════════════════════════════════════════════════════════════════════════
-- Pentru cont: georgeradu119@gmail.com
--
-- Setează `profiles.plan = 'business'` (cel mai mare admis de CHECK
-- constraint profiles_plan_check) cu expiration în 100 ani și înregistrează
-- modificarea în `audit_log` pentru compliance trail.
--
-- Cerință: utilizatorul trebuie să aibă DEJA cont Supabase (signup prin UI
-- cu email-ul georgeradu119@gmail.com). Acest script NU creează auth.users
-- direct (Supabase Auth folosește encrypted_password etc; trebuie signup
-- via UI/Dashboard).
--
-- Pași de rulare (3 minute):
--   1. Mergi pe app, signup cu georgeradu119@gmail.com + parola dorită
--      (sau Supabase Dashboard > Authentication > Add User)
--   2. Mergi pe Supabase Dashboard > SQL Editor
--   3. Paste conținutul acestui script, click Run
--   4. Vei vedea: "✓ Plan upgrade: free → business; expires: 2126-…"
--
-- Idempotent: poți rula de mai multe ori — re-execută UPDATE cu aceleași
-- valori. Audit log primește o intrare per rulare (acceptabil — trail
-- complet al modificărilor).
--
-- Side effects ZERO pe alte conturi/restaurants/RLS. Singura modificare:
-- public.profiles + un row în public.audit_log per rulare.
--
-- Pentru alt email: înlocuiește valoarea v_email de mai jos (linia 35).
-- ════════════════════════════════════════════════════════════════════════

do $$
declare
  v_email         constant text := 'georgeradu119@gmail.com';
  v_target_plan   constant text := 'business';
  v_duration      constant interval := interval '100 years';
  v_user_id       uuid;
  v_old_plan      text;
  v_old_expires   timestamptz;
  v_new_expires   timestamptz := now() + v_duration;
  v_old_data      jsonb;
  v_new_data      jsonb;
begin
  -- 1) Validare: plan target trebuie să existe în plan_limits (defensive).
  if not exists (select 1 from public.plan_limits where plan = v_target_plan) then
    raise exception 'Plan "%" nu există în public.plan_limits. Available: %',
      v_target_plan,
      (select string_agg(plan, ', ' order by plan) from public.plan_limits);
  end if;

  -- 2) Localizează user-ul în auth.users (case-insensitive).
  select id into v_user_id
    from auth.users
   where lower(email) = lower(v_email)
   limit 1;

  if v_user_id is null then
    raise exception E'User "%" nu există în auth.users. Signup mai întâi prin app sau prin Supabase Dashboard (Authentication > Add User), apoi re-rulează scriptul.', v_email;
  end if;

  -- 3) Citește state-ul curent (pentru diff în audit_log).
  select plan, plan_expires_at into v_old_plan, v_old_expires
    from public.profiles where id = v_user_id;

  -- 4) Asigură row existent în profiles (insert dacă lipsește).
  insert into public.profiles (id, email, plan, plan_expires_at)
  values (v_user_id, v_email, v_target_plan, v_new_expires)
  on conflict (id) do nothing;

  -- 5) Upgrade (idempotent dacă deja la valoarea target).
  update public.profiles
     set plan            = v_target_plan,
         plan_expires_at = v_new_expires,
         updated_at      = now()
   where id = v_user_id;

  -- 6) Audit trail. audit_log.operation acceptă INSERT/UPDATE/DELETE; folosim
  -- UPDATE cu old_data/new_data diff pentru compliance.
  v_old_data := jsonb_build_object(
    'plan',            coalesce(v_old_plan, '<no profile>'),
    'plan_expires_at', v_old_expires
  );
  v_new_data := jsonb_build_object(
    'plan',            v_target_plan,
    'plan_expires_at', v_new_expires,
    'rationale',       'Manual upgrade via grant_business_plan script — internal account / testing top-tier features'
  );

  insert into public.audit_log (
    actor_id, actor_role, table_name, operation, row_id, restaurant_id,
    old_data, new_data, changed_keys
  ) values (
    null,                          -- system action (no auth context in SQL Editor)
    'system_script',
    'profiles',
    'UPDATE',
    v_user_id::text,
    null,                          -- no restaurant scope
    v_old_data,
    v_new_data,
    array['plan', 'plan_expires_at']::text[]
  );

  -- 7) Confirmare.
  raise notice E'✓ Plan upgrade pentru % (user_id=%): % → %; expires: %',
    v_email, v_user_id, coalesce(v_old_plan, '<no profile>'),
    v_target_plan, v_new_expires;
  raise notice E'  Audit log: înregistrare INSERT/UPDATE/DELETE marker UPDATE pe profiles.';
  raise notice E'  Limite business (per plan_limits): 5000 produse / 5 restaurante / 200 mese / 200 ai_imports/lună';
  raise notice E'  Features: qr_dynamic, ordering, analytics, ai_import, team, kitchen, waiter, multi_location';
end $$;
