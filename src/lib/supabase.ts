import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './publicEnv'

const FALLBACK_SUPABASE_URL = 'https://placeholder.supabase.co'
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder'

// URL-ul și cheia anon vin din lib/publicEnv.ts (aceeași citire o folosește
// config.json-ul Bridge-ului, lib/bridgeSetup.ts).
const supabaseUrl = SUPABASE_URL
const supabaseKey = SUPABASE_ANON_KEY

export const SUPABASE_CONFIGURED = !!(supabaseUrl && supabaseKey)

export const supabase = createClient(
  supabaseUrl || FALLBACK_SUPABASE_URL,
  supabaseKey || FALLBACK_SUPABASE_ANON_KEY,
)
