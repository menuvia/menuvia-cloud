-- Migration 067: upgrade cont georgeradu119@gmail.com → enterprise (acces test)
-- One-off data migration — cont fondator/tester pentru validare features stoc.

update public.profiles
set
  plan            = 'enterprise',
  plan_expires_at = null   -- fără expirare (manual override, fără Stripe)
where email = 'georgeradu119@gmail.com';
