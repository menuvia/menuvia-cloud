-- ════════════════════════════════════════════════════════════════════════
-- SCRIPT ONE-OFF: Upgrade plan utilizator la 'business' (top tier)
-- ════════════════════════════════════════════════════════════════════════
-- Pentru cont: georgeradu119@gmail.com
--
-- Setează `profiles.plan = 'business'` (cel mai mare admis de CHECK
-- constraint profiles_plan_check) cu expiration în 100 ani.
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
-- Idempotent: poți rula de mai multe ori — re-execută UPDATE cu aceleași valori.
-- Side effects: ZERO pe alte conturi. ZERO pe restaurants. ZERO pe RLS.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare
  v_email     constant text := 'georgeradu119@gmail.com';
  v_user_id   uuid;
  v_old_plan  text;
  v_new_expires timestamptz := now() + interval '100 years';
begin
  -- 1) Localizează user-ul în auth.users
  select id into v_user_id
    from auth.users
   where lower(email) = lower(v_email)
   limit 1;

  if v_user_id is null then
    raise exception E'User "%" nu există în auth.users. Signup mai întâi prin app sau prin Supabase Dashboard (Authentication > Add User), apoi re-rulează scriptul.', v_email;
  end if;

  -- 2) Asigură row existent în profiles (insert dacă lipsește)
  insert into public.profiles (id, email, plan, plan_expires_at)
  values (v_user_id, v_email, 'business', v_new_expires)
  on conflict (id) do nothing;

  -- 3) Citește plan-ul curent (după potențialul insert)
  select plan into v_old_plan from public.profiles where id = v_user_id;

  -- 4) Upgrade la 'business' (idempotent dacă deja business)
  update public.profiles
     set plan            = 'business',
         plan_expires_at = v_new_expires,
         updated_at      = now()
   where id = v_user_id;

  raise notice E'✓ Plan upgrade pentru % (user_id=%): % → business; expires: %',
    v_email, v_user_id, coalesce(v_old_plan, '<no profile>'), v_new_expires;

  raise notice E'  Limite business: 5000 produse / 5 restaurante / 200 mese / 200 ai_imports/lună';
  raise notice E'  Features: qr_dynamic, ordering, analytics, ai_import, team, kitchen, waiter, multi_location';
end $$;
