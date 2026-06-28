-- mig 136 — Fix P2 (leak cross-tenant): push_subscriptions cere membership (PUSH-RLS-1)
--
-- Auditul rundei 3 (kitchen_waiter). Politica "push_subs: user manage own" verifica
-- doar user_id=auth.uid(), fara apartenenta la restaurant. Un user putea INSERT-a o
-- subscriptie push cu restaurant_id-ul ALTUI restaurant si primea notificarile de
-- comenzi (KDS) ale acestuia => leak cross-tenant. Adaugam is_member(restaurant_id)
-- pe ambele clauze (acopera INSERT — vectorul principal — si SELECT/DELETE).

begin;
set local lock_timeout = '10s';

drop policy if exists "push_subs: user manage own" on public.push_subscriptions;
create policy "push_subs: user manage own"
  on public.push_subscriptions for all
  using (user_id = auth.uid() and public.is_member(restaurant_id))
  with check (user_id = auth.uid() and public.is_member(restaurant_id));

do $$ begin
  if not exists (select 1 from pg_policy where polname='push_subs: user manage own'
                  and polrelid='public.push_subscriptions'::regclass) then
    raise exception 'mig 136: politica lipseste'; end if;
  raise notice 'mig 136: push_subscriptions cere is_member(restaurant_id) OK';
end $$;
commit;
