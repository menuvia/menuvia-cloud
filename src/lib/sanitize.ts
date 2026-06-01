import type { Restaurant, Category, Product } from '../hooks/useData'

// Coloane pe care clientul are voie să le scrie via .update() / .insert().
// Câmpuri controlate exclusiv server-side (id, owner_id, qr_token, is_active,
// timestamps) sunt OMISE intenționat — RLS owner_id-policy permite altfel
// transferul de proprietate prin payload fabricat.
export const RESTAURANT_UPDATE_FIELDS = [
  'name',
  'tagline',
  'city',
  'slug',
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
