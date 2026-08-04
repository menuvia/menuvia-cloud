-- Migration 255: notificare EMAIL către restaurant la fiecare rezervare nouă
--
-- Închide finding-ul CRITIC din auditul pe capitole: restaurantul nu afla în
-- niciun fel de o rezervare nouă (toate notificările curgeau către CLIENT).
-- Pattern identic cu triggerele SMS din mig 228: AFTER INSERT, exception-
-- wrapped (un eșec de enqueue NU avortează NICIODATĂ rezervarea), dedup pe id.
--
-- De ce EMAIL și nu SMS: emailul către owner merge pe ORICE plan (e semnal
-- operațional către operator, nu feature de plan — enqueue_email nu are gate
-- de plan, spre deosebire de enqueue_sms care consumă plafonul lunar destinat
-- clienților). Destinatarul = profiles.email al owner-ului (același izvor ca
-- win-back/nps, mig 061). Owner fără email în profil → skip tăcut.
--
-- Enum-ul 'reservation_created' vine din mig 254 (fișier separat, fără
-- tranzacție — valorile noi de enum nu se pot folosi în aceeași tranzacție).

begin;

create or replace function public.trg_email_on_reservation_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rest_name   text;
  v_owner_id    uuid;
  v_owner_email text;
  v_owner_name  text;
begin
  begin
    select r.name, r.owner_id, p.email, p.full_name
      into v_rest_name, v_owner_id, v_owner_email, v_owner_name
      from public.restaurants r
      left join public.profiles p on p.id = r.owner_id
     where r.id = new.restaurant_id;

    -- Owner fără email în profil = nu avem unde trimite; skip tăcut (nu raise:
    -- rezervarea clientului nu are voie să depindă de igiena profilului).
    if v_owner_email is null then
      return null;
    end if;

    perform public.enqueue_email(
      v_owner_email,
      'reservation_created'::email_template_kind,
      jsonb_build_object(
        'restaurant_name',   v_rest_name,
        'customer_name',     new.customer_name,
        'customer_phone',    new.customer_phone,
        'party_size',        new.party_size,
        'starts_at',         new.starts_at,
        'status',            new.status,
        'source',            new.source,
        'special_requests',  new.special_requests,
        'confirmation_code', new.confirmation_code
      ),
      v_owner_id,
      v_owner_name,
      null,
      -- Dedup pe id-ul rezervării: un singur email per rezervare, indiferent
      -- de re-intrări (enqueue_email face on conflict (dedup_key) do nothing).
      'resv_created:' || new.id::text
    );
  exception when others then
    -- Un eșec de notificare NU are voie să avorteze rezervarea clientului —
    -- aceeași disciplină ca triggerele SMS (mig 228, test SQ9).
    raise warning 'email owner rezervare % a esuat: %', new.id, sqlerrm;
  end;
  return null; -- AFTER trigger
end;
$$;

revoke all on function public.trg_email_on_reservation_created() from public, anon, authenticated;

drop trigger if exists trg_email_reservation_created on public.reservations;
create trigger trg_email_reservation_created
  after insert on public.reservations
  for each row
  execute function public.trg_email_on_reservation_created();

-- ── Asserții fail-closed ─────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_email_reservation_created') then
    raise exception 'mig 255: triggerul trg_email_reservation_created lipsește';
  end if;
  if not exists (
    select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'email_template_kind' and e.enumlabel = 'reservation_created'
  ) then
    raise exception 'mig 255: enum-ul email_template_kind nu are reservation_created (mig 254 lipsă?)';
  end if;
  -- Exception-wrapper-ul e obligatoriu: fără el, un blip pe email_queue ar
  -- avorta rezervarea clientului.
  v_def := pg_get_functiondef('public.trg_email_on_reservation_created()'::regprocedure);
  if v_def !~* 'when\s+others' then
    raise exception 'mig 255: trigger-ul de notificare nu mai e exception-wrapped';
  end if;
end $$;

commit;
