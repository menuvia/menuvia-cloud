-- migration_312_table_payment_public_status.sql
-- =============================================================================
-- Lotul E: „Plătit” pe meniul QR apare DOAR după confirmarea SERVERULUI.
--
-- ── Ce era ───────────────────────────────────────────────────────────────────
-- PayTableSheet declara „Plătit” pe baza rezultatului din BROWSER al lui
-- `stripe.confirmPayment` (`paymentIntent.status === 'succeeded'`). Comenzile
-- trec însă în `paid` abia când webhook-ul (stripe-connect-webhook.js →
-- `settle_table_payment`, lanț 203→207→211→229) decontează plata. Două goluri:
--   • „Plătit” putea apărea deși banii nu erau încă decontați în DB (metodele
--     care rezolvă în `processing`, un webhook întârziat sau un settle eșuat);
--   • la revenirea din redirect (`return_url`, ex. 3DS), starea se pierdea —
--     pagina se reîncărca și nimic nu relua confirmarea.
-- Oaspetele nu avea NICIO cale să întrebe serverul: `table_payments` nu e
-- citibilă de anon (RLS admin, mig 203), iar RPC-urile plății sunt
-- service_role-only (le cheamă doar funcțiile Netlify).
--
-- ── Fix ──────────────────────────────────────────────────────────────────────
-- `get_table_payment_public_status(p_token, p_session_id, p_payment_ref)` →
-- `{status}`, cu `status ∈ pending|processing|succeeded|failed|canceled|unknown`.
-- NIMIC altceva în răspuns: nici sumă, nici id Stripe, nici comenzi.
--   • `p_payment_ref` = id-ul plății (uuid, întors de `begin`) SAU id-ul
--     PaymentIntent-ului (`pi_…`, singurul identificator pe care Stripe îl pune
--     în `return_url` dacă parametrii noștri lipsesc). Clientul le are pe
--     amândouă după `begin`/redirect; nu primește nimic în plus.
--   • Dovada „ești la masă” = paritate EXACTĂ cu `cancel_table_payment` (208):
--     token QR activ + sesiunea rândului de plată pe aceeași masă/restaurant.
--     Sesiunea NU trebuie să fie deschisă: după un settle reușit pe toată nota,
--     `trg_maybe_close_session` (084) o închide — exact momentul în care
--     oaspetele întreabă.
--   • Maparea statusului e 1:1 pe `table_payments.status`, cu `created` →
--     `pending` (rând fără intent atașat). `succeeded` vine DOAR din DB: singurul
--     scriitor al lui `table_payments.status='succeeded'` e `settle_table_payment`
--     (begin/cancel/supersede scriu doar `canceled`, attach doar `processing`) —
--     deci „succeeded” înseamnă „decontat”, nu „Stripe a zis da”.
--   • ANTI-ORACLE: token inexistent/inactiv, sesiune străină, plată a altei
--     sesiuni, referință inexistentă, argumente NULL/prea lungi → ACELAȘI
--     `{status:'unknown'}`. Nicio ramură nu aruncă (o eroare diferită ar fi
--     oracolul, tiparul `receipt_tenant_mismatch` din 278).
--   • RATE-LIMIT `check_rate_limit('table_payment_public_status', <qr_tokens.id>,
--     120, 5)` — cheia e TABELA (token-ul rezolvat), ca `get_loyalty_state`
--     (258): mai multe telefoane la aceeași masă împart bugetul, iar un client
--     face ~12 cereri pe confirmare (polling cu backoff, ~40 s). Peste plafon →
--     `unknown` (clientul NU declară „Plătit” pe `unknown`, deci degradarea e
--     sigură). Token-urile invalide se resping ÎNAINTE de rate-limit: nu scriu
--     rânduri în `function_rate_limits` (un atacator cu token-uri aleatorii nu
--     poate umfla tabela), iar lookup-ul lor e același SELECT ieftin ca
--     `resolve_qr_token`.
--   • DEFINER `public, pg_temp`, VOLATILE (rate-limit-ul scrie). Revoke EXPLICIT
--     pe fiecare rol (`public, anon, authenticated, service_role` — default
--     privileges din Supabase re-acordă EXECUTE funcțiilor noi), apoi grant
--     anon + authenticated (oaspetele poate fi logat). Intră în allowlist-ul
--     AH1 (tests/sql/advisor_hardening_assertions.sql) cu motiv.
--
-- Regula de aur: funcția e DOAR citire de status — nu deschide plata pe niciun
-- plan; gate-urile din `begin_table_payment`/`begin_split_payment` rămân
-- singura intrare în fluxul de bani.
--
-- Teste permanente: tests/sql/auto/312_table_payment_public_status.sql (TS1–TS5).
-- =============================================================================

begin;

set local lock_timeout = '10s';

create or replace function public.get_table_payment_public_status(
  p_token       text,
  p_session_id  uuid,
  p_payment_ref text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok    record;
  v_pid    uuid;
  v_status text;
begin
  if p_token is null or p_session_id is null or p_payment_ref is null
     or length(p_token) > 128 or length(p_payment_ref) > 255 then
    return jsonb_build_object('status', 'unknown');
  end if;

  select id, table_id, restaurant_id
    into v_tok
    from public.qr_tokens
   where token = p_token
     and is_active;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  -- Peste plafon: `unknown`, nu o eroare (oaspetele nu declară „Plătit”).
  if not public.check_rate_limit('table_payment_public_status', v_tok.id::text, 120, 5) then
    return jsonb_build_object('status', 'unknown');
  end if;

  -- Referința: uuid-ul plății sau id-ul PaymentIntent-ului. Cast-ul se face
  -- AICI, sub regex — într-un WHERE ordinea de evaluare nu e garantată și un
  -- `::uuid` pe `pi_…` ar arunca (adică exact o eroare-oracol).
  if p_payment_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_pid := p_payment_ref::uuid;
  end if;

  select tp.status
    into v_status
    from public.table_payments tp
    join public.table_sessions s on s.id = tp.session_id
   where tp.session_id = p_session_id
     and tp.restaurant_id = v_tok.restaurant_id
     and s.table_id = v_tok.table_id
     and s.restaurant_id = v_tok.restaurant_id
     and ((v_pid is not null and tp.id = v_pid)
          or (v_pid is null and tp.stripe_payment_intent_id = p_payment_ref));
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  return jsonb_build_object('status', case v_status
    when 'created'    then 'pending'
    when 'processing' then 'processing'
    when 'succeeded'  then 'succeeded'
    when 'failed'     then 'failed'
    when 'canceled'   then 'canceled'
    else 'unknown'
  end);
end;
$$;

revoke all on function public.get_table_payment_public_status(text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_table_payment_public_status(text, uuid, text)
  to anon, authenticated;

comment on function public.get_table_payment_public_status(text, uuid, text) is
  $$Lotul E (mig 312): statusul PUBLIC al unei plăți online la masă, pentru
oaspete — DOAR {status} (pending|processing|succeeded|failed|canceled|unknown).
Dovada: token QR activ + sesiunea plății pe aceeași masă (paritate cu 208).
succeeded = decontat de settle_table_payment, nu rezultatul din browser.
Anti-oracle (orice pereche invalidă → unknown), rate-limit 120/5 min per masă.$$;

-- ── Asserții fail-closed (o singură evaluare; clichetul VIU e suita din auto/) ─
do $$
declare
  v_fn regprocedure := 'public.get_table_payment_public_status(text, uuid, text)'::regprocedure;
begin
  if not (select prosecdef from pg_proc where oid = v_fn) then
    raise exception 'mig 312: get_table_payment_public_status trebuie să fie SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where oid = v_fn
                  and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') then
    raise exception 'mig 312: search_path = public, pg_temp lipsește';
  end if;
  if not has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'mig 312: oaspetele (anon/authenticated) trebuie să poată apela RPC-ul';
  end if;
  if has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'mig 312: service_role nu are ce căuta pe suprafața oaspetelui';
  end if;
  if position('check_rate_limit' in pg_get_functiondef(v_fn)) = 0 then
    raise exception 'mig 312: rate-limit-ul lipsește';
  end if;
end $$;

commit;
