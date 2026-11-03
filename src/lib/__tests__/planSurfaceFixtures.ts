// Fixturi de test pentru `planSurface` (lotul P), derivate din matricea
// ÎNGHEȚATĂ a lui `plan_features` (planFeatureMatrix.fixture.ts) — nu scrise de
// mână: o migrație care schimbă matricea actualizează fixtura (PD5/PL6), iar
// testele de randare urmează singure.
import type { RestaurantFeatures } from '../features'
import { planSurface, type PlanSurface } from '../planSurface'
import { PLAN_FEATURE_MATRIX, type DbPlan } from './planFeatureMatrix.fixture'

// Feature-urile românești (mig 296, `feature_requires_ro`): false pentru un
// restaurant din afara României, pe ORICE plan.
const RO_ONLY = ['fiscal_receipt', 'online_payments', 'split_bill', 'shifts', 'reports_vat']

/** Ce întoarce `get_restaurant_features` pentru un plan (opțional: în afara RO). */
export function featuresFor(plan: DbPlan, opts: { outsideRo?: boolean } = {}): RestaurantFeatures {
  const features: RestaurantFeatures['features'] = {}
  for (const [name, row] of Object.entries(PLAN_FEATURE_MATRIX)) {
    const enabled = row[plan] && !(opts.outsideRo === true && RO_ONLY.includes(name))
    features[name] = { enabled, limit: null }
  }
  return { plan, features }
}

/** `planSurface` pe un plan cunoscut (nu întoarce niciodată null). */
export function surfaceFor(plan: DbPlan, opts: { outsideRo?: boolean } = {}): PlanSurface {
  const s = planSurface(featuresFor(plan, opts))
  if (!s) throw new Error(`planSurface(${plan}) a întors null pe un plan cunoscut`)
  return s
}
