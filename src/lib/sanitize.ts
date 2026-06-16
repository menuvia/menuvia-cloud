import type { Restaurant, Category, Product } from '../hooks/useData'

// Coloane pe care clientul are voie să le scrie via .update() / .insert().
// Câmpuri controlate exclusiv server-side (id, owner_id, qr_token, is_active,
// timestamps) sunt OMISE intenționat — RLS owner_id-policy permite altfel
// transferul de proprietate prin payload fabricat.
//
// `slug` este OMIS deliberat din PR 1B (mig 096B): privilegiul column-level
// UPDATE pe `restaurants.slug` este revocat la nivel de DB. Schimbarea slug-ului
// trece exclusiv prin RPC-ul `change_restaurant_slug` (vezi
// src/lib/restaurants.ts:130 + src/components/SettingsTab.tsx:124). Dacă slug-ul
// ar fi păstrat în whitelist, un caller hipotetic l-ar putea trimite prin
// `useRestaurants.update()` și PostgREST l-ar respinge cu 42501 — fail-closed
// dar inutil. Mai bine îl excludem aici ca whitelist-ul TS să oglindească exact
// privilegiile DB.
export const RESTAURANT_UPDATE_FIELDS = [
  'name',
  'tagline',
  'city',
  'description',
  'address',
  'phone',
  'hours',
  'hours_structured',
  'timezone',
  'wifi_password',
  'primary_color',
  'logo_url',
  'cover_url',
  'floor_layout',
  'socials',
  'amenities',
  'checkout_suggestion_settings',
  'theme_settings',
  'pickup_settings',
  'google_place_id',
  'google_review_url',
] as const satisfies readonly (keyof Restaurant)[]

export const CATEGORY_UPDATE_FIELDS = [
  'name',
  'emoji',
  'display_order',
  'meta_text',
] as const satisfies readonly (keyof Category)[]

export const PRODUCT_UPDATE_FIELDS = [
  'category_id',
  'name',
  'description',
  'price',
  'emoji',
  'image_url',
  'is_active',
  'is_daily_special',
  'is_sold_out',
  'is_draft',
  'display_order',
  'allergens',
  'dietary_tags',
  'prep_time_minutes',
  'portion_size',
  'vat_group',
] as const satisfies readonly (keyof Product)[]

export function pickAllowed<T extends object, K extends keyof T>(
  obj: Partial<T>,
  allowed: readonly K[],
): Pick<Partial<T>, K> {
  const out = {} as Pick<Partial<T>, K>
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      out[key] = obj[key]
    }
  }
  return out
}
