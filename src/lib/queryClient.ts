// src/lib/queryClient.ts
// ─────────────────────────────────────────────────────────────────
// TanStack Query — config global pentru caching și fetching
// Adăugare în App.tsx:
//   import { QueryClientProvider } from '@tanstack/react-query'
//   import { queryClient } from './lib/queryClient'
//   <QueryClientProvider client={queryClient}>...</QueryClientProvider>
// ─────────────────────────────────────────────────────────────────
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache timpi adaptați pentru SaaS gestiune cafenea:
      // - staleTime mare = mai puține re-fetches inutile
      // - dar realtime via Supabase Subscribe va invalida când e nevoie
      staleTime: 60_000, // 1 min — datele rămân "proaspete" 1 min după fetch
      gcTime: 5 * 60_000, // 5 min — păstrat în memorie chiar dacă nu mai e referit

      // Refetch policy pentru UX bun fără refetch agresiv:
      refetchOnWindowFocus: false, // nu refetch când utilizatorul revine la tab
      refetchOnReconnect: true, // dar refetch la reconectare (relevant pentru offline)
      refetchOnMount: true, // refetch la mount dacă data e stale

      // Retry: doar pe erori tranzitorii (network), nu pe 4xx (cele logice)
      retry: (failureCount, error) => {
        // Nu retry pe erori 4xx (RLS, validare etc.)
        const status = (error as { status?: number })?.status
        if (status && status >= 400 && status < 500) return false
        // Max 2 retries pentru erori 5xx / network
        return failureCount < 2
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),

      // Eroare nu se aruncă pe component — handle prin error state
      throwOnError: false,
    },

    mutations: {
      // Mutations nu retry automat — utilizatorul controlează
      retry: false,
      throwOnError: false,
    },
  },
})

// ─────────────────────────────────────────────────────────────────
// Query Keys — convenție centralizată pentru type safety + clarity
// Folosire: useQuery({ queryKey: queryKeys.orders(restaurantId), ... })
// Invalidare: queryClient.invalidateQueries({ queryKey: queryKeys.orders(restaurantId) })
// ─────────────────────────────────────────────────────────────────
export const queryKeys = {
  // Restaurants
  restaurants: () => ['restaurants'] as const,
  restaurant: (id: string) => ['restaurants', id] as const,

  // Orders
  orders: (restaurantId: string, filter?: 'active' | 'today' | 'all') =>
    ['orders', restaurantId, filter ?? 'active'] as const,
  order: (id: string) => ['orders', 'detail', id] as const,

  // Products & Menu
  products: (restaurantId: string) => ['products', restaurantId] as const,
  categories: (restaurantId: string) => ['categories', restaurantId] as const,
  modifiers: (restaurantId: string) => ['modifiers', restaurantId] as const,

  // Stocks
  ingredients: (restaurantId: string) => ['ingredients', restaurantId] as const,
  suppliers: (restaurantId: string) => ['suppliers', restaurantId] as const,

  // Cash & Shifts
  currentShift: (restaurantId: string) => ['shifts', 'current', restaurantId] as const,
  recentShifts: (restaurantId: string) => ['shifts', 'recent', restaurantId] as const,
  shiftSummary: (shiftId: string) => ['shifts', 'summary', shiftId] as const,

  // Invoices
  invoices: (restaurantId: string, status?: string) =>
    ['invoices', restaurantId, status ?? 'all'] as const,

  // Reports
  reports: (restaurantId: string, range: { from: string; to: string }) =>
    ['reports', restaurantId, range.from, range.to] as const,

  // VAT & Settings
  vatRates: (restaurantId: string) => ['vat_rates', restaurantId] as const,
  happyHourRules: (restaurantId: string) => ['happy_hour', restaurantId] as const,

  // User
  profile: () => ['profile'] as const,
  memberships: () => ['memberships'] as const,
} as const
