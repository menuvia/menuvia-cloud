import { createClient } from '@supabase/supabase-js'

const FALLBACK_SUPABASE_URL = 'https://placeholder.supabase.co'
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder'

const rawSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const rawSupabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const supabaseUrl = isValidSupabaseUrl(rawSupabaseUrl) ? rawSupabaseUrl : ''
const supabaseKey = rawSupabaseKey

export const SUPABASE_CONFIGURED = !!(supabaseUrl && supabaseKey)

export const supabase = createClient(
  supabaseUrl || FALLBACK_SUPABASE_URL,
  supabaseKey || FALLBACK_SUPABASE_ANON_KEY,
)
