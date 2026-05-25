// src/schemas/index.ts
// ─────────────────────────────────────────────────────────────────
// Zod schemas — single source of truth pentru validare forms + API
// Folosit pe client (forms) + pe server (Netlify Functions)
// ─────────────────────────────────────────────────────────────────
import { z } from 'zod'

// ── Regex-uri reutilizabile ─────────────────────────────────────
const RO_PHONE_RX = /^(\+4)?0[27]\d{8}$/ // 07XXXXXXXX sau +407XXXXXXXX (mobil) / 02XXXXXXXX (fix)
const CIF_RX = /^(RO)?\d{2,10}$/i

// ─────────────────────────────────────────────────────────────────
// AUTH — login, signup, reset
// ─────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().min(1, 'Email obligatoriu').email('Email invalid').max(120),
  password: z.string().min(6, 'Parola trebuie să aibă minim 6 caractere').max(200),
})
export type LoginInput = z.infer<typeof loginSchema>

export const signupSchema = z
  .object({
    email: z.string().min(1, 'Email obligatoriu').email('Email invalid').max(120),
    password: z
      .string()
      .min(8, 'Parola trebuie să aibă minim 8 caractere')
      .max(200, 'Parola e prea lungă'),
    passwordConfirm: z.string(),
    fullName: z.string().min(2, 'Nume prea scurt').max(100, 'Nume prea lung'),
    agreedTerms: z.literal(true, {
      errorMap: () => ({ message: 'Trebuie să accepți Termenii și Politica de Confidențialitate' }),
    }),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: 'Parolele nu coincid',
    path: ['passwordConfirm'],
  })
export type SignupInput = z.infer<typeof signupSchema>

export const passwordResetSchema = z.object({
  email: z.string().email('Email invalid').max(120),
})
export type PasswordResetInput = z.infer<typeof passwordResetSchema>

// ─────────────────────────────────────────────────────────────────
// RECRUTARE — formularul de pilot pe /recrutare
// ─────────────────────────────────────────────────────────────────
export const recrutareSchema = z.object({
  name: z.string().trim().min(2, 'Nume prea scurt').max(100, 'Nume prea lung'),
  cafe: z.string().trim().min(2, 'Numele localului prea scurt').max(120),
  city: z.string().trim().max(80).optional().default(''),
  phone: z
    .string()
    .trim()
    .min(1, 'Telefon obligatoriu')
    .max(40)
    .refine((v) => RO_PHONE_RX.test(v.replace(/\s/g, '')), {
      message: 'Telefon RO invalid (07XXXXXXXX sau +407XXXXXXXX)',
    }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Email obligatoriu')
    .email('Email invalid')
    .max(120),
  message: z.string().trim().max(2000, 'Mesaj prea lung').optional().default(''),
  consent: z.literal(true, {
    errorMap: () => ({ message: 'Trebuie să accepți prelucrarea datelor pentru contact' }),
  }),
})
export type RecrutareInput = z.infer<typeof recrutareSchema>

// ─────────────────────────────────────────────────────────────────
// RESTAURANT — setări de bază
// ─────────────────────────────────────────────────────────────────
export const restaurantSettingsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Doar litere mici, cifre și liniuțe'),
  address: z.string().trim().max(200).optional().default(''),
  phone: z.string().trim().max(40).optional().default(''),
  cif: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .refine((v) => !v || CIF_RX.test(v), {
      message: 'CIF invalid (ex: RO12345678)',
    }),
  currency: z.enum(['RON', 'EUR']).default('RON'),
})
export type RestaurantSettingsInput = z.infer<typeof restaurantSettingsSchema>

// ─────────────────────────────────────────────────────────────────
// PRODUCT — produs din meniu
// ─────────────────────────────────────────────────────────────────
export const productSchema = z.object({
  name: z.string().trim().min(2, 'Numele produsului prea scurt').max(120),
  description: z.string().trim().max(500).optional().default(''),
  price: z.coerce
    .number()
    .min(0, 'Prețul nu poate fi negativ')
    .max(99999, 'Preț prea mare')
    .multipleOf(0.01, 'Maxim 2 zecimale'),
  category_id: z.string().uuid().nullable(),
  vat_group: z.number().int().min(1).max(4),
  is_available: z.boolean().default(true),
  display_order: z.number().int().min(0).default(0),
  allergens: z.array(z.string()).default([]),
})
export type ProductInput = z.infer<typeof productSchema>

// ─────────────────────────────────────────────────────────────────
// INGREDIENT — pentru gestiunea stocurilor
// ─────────────────────────────────────────────────────────────────
export const ingredientUnitSchema = z.enum(['g', 'kg', 'ml', 'l', 'buc', 'pachet'])

export const ingredientSchema = z.object({
  name: z.string().trim().min(2).max(100),
  unit: ingredientUnitSchema,
  current_stock: z.coerce.number().min(0).default(0),
  min_stock: z.coerce.number().min(0).optional(),
  cost_per_unit: z.coerce.number().min(0).default(0),
  supplier_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(500).optional().default(''),
})
export type IngredientInput = z.infer<typeof ingredientSchema>

// ─────────────────────────────────────────────────────────────────
// SUPPLIER — furnizor
// ─────────────────────────────────────────────────────────────────
export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(100),
  vat_id: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .refine((v) => !v || CIF_RX.test(v), {
      message: 'CUI invalid',
    }),
  contact_name: z.string().trim().max(100).optional().default(''),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .refine((v) => !v || RO_PHONE_RX.test(v.replace(/\s/g, '')), {
      message: 'Telefon invalid',
    }),
  email: z.string().trim().toLowerCase().email().max(120).optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().default(''),
  payment_terms_days: z.coerce.number().int().min(0).max(365).default(0),
  notes: z.string().trim().max(1000).optional().default(''),
  is_active: z.boolean().default(true),
})
export type SupplierInput = z.infer<typeof supplierSchema>

// ─────────────────────────────────────────────────────────────────
// HAPPY HOUR — regulă de discount
// ─────────────────────────────────────────────────────────────────
export const happyHourRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    is_active: z.boolean().default(true),
    starts_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Format ora invalidă (HH:MM)'),
    ends_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Format ora invalidă (HH:MM)'),
    days_of_week: z.array(z.number().int().min(1).max(7)).default([]),
    scope: z.enum(['all', 'category', 'product']),
    category_id: z.string().uuid().nullable().optional(),
    product_id: z.string().uuid().nullable().optional(),
    discount_type: z.enum(['percent', 'amount']),
    discount_value: z.coerce.number().min(0).max(99999),
    max_discount: z.coerce.number().min(0).max(99999).nullable().optional(),
  })
  .refine(
    (d) => {
      if (d.scope === 'category' && !d.category_id) return false
      if (d.scope === 'product' && !d.product_id) return false
      return true
    },
    {
      message: 'Trebuie să selectezi categoria sau produsul în funcție de scope',
      path: ['scope'],
    },
  )
  .refine((d) => (d.discount_type === 'percent' ? d.discount_value <= 100 : true), {
    message: 'Procentul nu poate depăși 100%',
    path: ['discount_value'],
  })
export type HappyHourRuleInput = z.infer<typeof happyHourRuleSchema>

// ─────────────────────────────────────────────────────────────────
// CASH MOVEMENT
// ─────────────────────────────────────────────────────────────────
export const cashMovementSchema = z.object({
  amount: z.coerce.number().min(0.01, 'Suma trebuie să fie pozitivă').max(999999),
  type: z.enum(['deposit', 'withdrawal', 'tip_payout', 'expense', 'safe_deposit', 'correction']),
  reason: z.string().trim().min(2, 'Motivul trebuie specificat').max(200),
  send_to_fiscal: z.boolean().default(false),
})
export type CashMovementInput = z.infer<typeof cashMovementSchema>

// ─────────────────────────────────────────────────────────────────
// INVOICE — facturare prin Oblio
// ─────────────────────────────────────────────────────────────────
export const invoiceClientSchema = z.object({
  type: z.enum(['individual', 'company']),
  name: z.string().trim().min(2).max(120),
  cif: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .refine((v) => !v || CIF_RX.test(v), {
      message: 'CUI invalid',
    }),
  cnp: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{13}$/.test(v), {
      message: 'CNP invalid (13 cifre)',
    }),
  address: z.string().trim().max(300).optional().default(''),
  email: z.string().trim().toLowerCase().email().max(120).optional().or(z.literal('')),
})
export type InvoiceClientInput = z.infer<typeof invoiceClientSchema>

// ─────────────────────────────────────────────────────────────────
// HELPER — validare cu erori user-friendly
// ─────────────────────────────────────────────────────────────────
export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const firstIssue = result.error.issues[0]
    throw new Error(firstIssue?.message || 'Date invalide')
  }
  return result.data
}

export function validateFirstError<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { ok: true; data: T } | { ok: false; error: string; field?: string } {
  const result = schema.safeParse(data)
  if (result.success) return { ok: true, data: result.data }
  const firstIssue = result.error.issues[0]
  return {
    ok: false,
    error: firstIssue?.message || 'Date invalide',
    field: firstIssue?.path.join('.'),
  }
}
