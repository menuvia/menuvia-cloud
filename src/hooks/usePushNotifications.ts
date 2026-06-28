// usePushNotifications
// Manages Web Push subscription for kitchen staff.
// Saves PushSubscription JSON to push_subscriptions table in Supabase.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

// Convert VAPID base64 public key to Uint8Array (required by subscribe())
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function usePushNotifications(restaurantId: string | null) {
  const [permission, setPermission] = useState<PushPermission>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [swReady, setSwReady] = useState(false)

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window

  // 1. Register Service Worker + check current state
  useEffect(() => {
    if (!supported) {
      setPermission('unsupported')
      return
    }
    setPermission(Notification.permission as PushPermission)

    navigator.serviceWorker.ready
      .then((reg) => {
        setSwReady(true)
        // Check if we already have a subscription
        return reg.pushManager.getSubscription()
      })
      .then((sub) => {
        setSubscribed(!!sub)
      })
      .catch(() => {
        /* SW not available */
      })
  }, [supported])

  // 2. Subscribe
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!supported || !swReady || !restaurantId) return false
    if (!VAPID_PUBLIC_KEY) {
      console.warn('VITE_VAPID_PUBLIC_KEY not set — push notifications disabled')
      return false
    }
    setLoading(true)
    try {
      // Request permission
      const perm = await Notification.requestPermission()
      setPermission(perm as PushPermission)
      if (perm !== 'granted') {
        setLoading(false)
        return false
      }

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      })

      // user_id e NOT NULL si face parte din onConflict — fara el upsert-ul esua tacut
      // (P1: notificarile nu se salvau niciodata).
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        console.error('Push subscription: no authenticated user')
        setLoading(false)
        return false
      }

      // Save to Supabase (upsert — one subscription per user per restaurant)
      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: user.id,
          restaurant_id: restaurantId,
          subscription: sub.toJSON(),
        },
        { onConflict: 'user_id,restaurant_id' },
      )

      if (error) {
        console.error('Push subscription save error:', error)
        setLoading(false)
        return false
      }
      setSubscribed(true)
      setLoading(false)
      return true
    } catch (err) {
      console.error('Subscribe error:', err)
      setLoading(false)
      return false
    }
  }, [supported, swReady, restaurantId])

  // 3. Unsubscribe
  const unsubscribe = useCallback(async () => {
    if (!supported || !restaurantId) return
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) await sub.unsubscribe()

      await supabase.from('push_subscriptions').delete().eq('restaurant_id', restaurantId)

      setSubscribed(false)
    } catch (err) {
      console.error('Unsubscribe error:', err)
    }
    setLoading(false)
  }, [supported, restaurantId])

  return { supported, permission, subscribed, loading, subscribe, unsubscribe }
}
