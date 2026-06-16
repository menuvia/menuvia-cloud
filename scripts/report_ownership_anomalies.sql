-- scripts/report_ownership_anomalies.sql
--
-- Read-only diagnostic. Rulat de operator înainte de a folosi
-- scripts/apply_ownership_remediation.sql, ca să identifice exact ce
-- restaurante au state inconsistent de ownership și să producă input-ul
-- aprobat pentru remediere.
--
-- Tipuri de anomalii detectate:
--   A. owner orfan         — restaurants.owner_id nu are membership cu role='owner'
--   B. owner multiplu       — restaurants are >1 membership cu role='owner'
--   C. owner inconsistent   — singurul owner membership are user_id <> restaurants.owner_id
--   D. owner ghost          — există membership cu role='owner' pentru restaurant inexistent
--                             (nu ar trebui să apară; FK ON DELETE CASCADE previne)
--
-- Output: o linie per restaurant cu anomalie, plus un sumar la final.

\pset format wrapped
\pset border 2

select '─── A. Owner orfan (owner_id fără membership) ───' as section;
select r.id as restaurant_id, r.slug, r.owner_id as restaurants_owner_id,
       (select count(*) from public.restaurant_memberships rm
         where rm.restaurant_id = r.id and rm.role = 'owner') as owner_membership_count
from public.restaurants r
where not exists (
  select 1 from public.restaurant_memberships rm
   where rm.restaurant_id = r.id and rm.role = 'owner'
)
order by r.created_at;

select '─── B. Owner multiplu (>1 membership cu role=owner) ───' as section;
select rm.restaurant_id, r.slug, r.owner_id as restaurants_owner_id,
       array_agg(rm.user_id order by rm.user_id) as owner_user_ids,
       count(*) as owner_count
from public.restaurant_memberships rm
join public.restaurants r on r.id = rm.restaurant_id
where rm.role = 'owner'
group by rm.restaurant_id, r.slug, r.owner_id
having count(*) > 1;

select '─── C. Owner inconsistent (membership user_id ≠ restaurants.owner_id) ───' as section;
select r.id as restaurant_id, r.slug, r.owner_id as restaurants_owner_id,
       rm.user_id as membership_owner_user_id
from public.restaurants r
join public.restaurant_memberships rm on rm.restaurant_id = r.id and rm.role = 'owner'
where rm.user_id is distinct from r.owner_id;

select '─── D. Owner ghost (membership cu role=owner pe restaurant șters) ───' as section;
select rm.restaurant_id, rm.user_id, rm.joined_at
from public.restaurant_memberships rm
left join public.restaurants r on r.id = rm.restaurant_id
where rm.role = 'owner' and r.id is null;

select '─── SUMMARY ───' as section;
select
  (select count(*) from public.restaurants r
    where not exists (select 1 from public.restaurant_memberships rm
                       where rm.restaurant_id = r.id and rm.role = 'owner'))
  as anomaly_A_orphan_count,
  (select count(*) from (
     select restaurant_id from public.restaurant_memberships
      where role = 'owner' group by restaurant_id having count(*) > 1
   ) d) as anomaly_B_multi_count,
  (select count(*) from public.restaurants r
    join public.restaurant_memberships rm on rm.restaurant_id = r.id and rm.role = 'owner'
    where rm.user_id is distinct from r.owner_id) as anomaly_C_mismatch_count,
  (select count(*) from public.restaurant_memberships rm
    left join public.restaurants r on r.id = rm.restaurant_id
    where rm.role = 'owner' and r.id is null) as anomaly_D_ghost_count;
