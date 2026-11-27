// Editorul de regulă Happy Hour (lotul C4a): dialog real, un singur „Creează”,
// prețuri cu virgulă, ordinea meniului. Textele în limbi sunt în
// HappyHourLang.test.tsx (HP0–HP6). Reducerea se aplică pe SERVER (mig 077);
// aici se verifică doar ce trimite editorul.
// (Prefixul HHM: verificat cu grep în src/, tests/, e2e/, supabase/, docs/ și
// CLAUDE.md, nefolosit înainte.)
//   HHM1 editorul e un dialog cu nume (`role="dialog"`, titlul „Regulă nouă”),
//        iar câmpurile au nume accesibile din etichetă (`<label htmlFor>`):
//        „Nume *”, „De la”, „Până la”, lista de categorii. Control pozitiv:
//        butonul „Creează regulă” e în dialog. Mutația care pică: overlay-ul
//        `div` de dinainte readus (fără rol) sau etichetele `<div style={lbl}>`.
//   HHM2 dublu-click pe „Creează regulă” cât cererea e în aer → regula se
//        creează O SINGURĂ dată, iar butonul arată „Se salvează…” dezactivat;
//        după un refuz butonul revine (control: a doua încercare pleacă).
//        Mutația care pică: garda `savingRef` / `disabled={saving}` scoasă.
//   HHM3 închiderea cu formularul modificat întreabă („Renunți la
//        modificări?”, „Rămân în editor”): refuzul lasă editorul deschis, ✕ +
//        acceptul îl închide; FĂRĂ modificări, „Anulează” închide direct, fără
//        întrebare (control). Mutația care pică: `confirmClose` scos de pe Modal
//        sau „Anulează” legat direct de `onClose`.
//   HHM4 valoarea și plafonul cu virgulă („12,5” / „7,5”) pleacă 12.5 / 7.5; un
//        plafon fără formă de număr („abc”) e o eroare, nu un plafon șters
//        tăcut (NaN → `null` în JSON). Mutația care pică: `type="number"` readus
//        (jsdom golește „12,5”) sau verificarea NaN a plafonului scoasă.
//   HHM5 categoriile se cer în ordinea MENIULUI (`display_order`), nu pe coloana
//        veche `position`. Mutația care pică: `.order('position')` readus.
//   HHM6 ștergerea trece prin confirm() (ui/confirm): refuzată → nimic șters;
//        acceptată → regula aleasă e ștearsă. Mutația care pică: ștergerea
//        fără confirmare.
// Recenzia lotului C4a:
//   HHM7 o valoare sau un plafon prea mare (309 cifre de 9 — `Infinity` pentru
//        `parseFloat`) e o eroare, nu o regulă trimisă: un plafon `Infinity`
//        pleca în JSON ca `null`, adică „fără plafon”. Control: „50” pe sumă
//        fixă pleacă. Mutația care pică: garda `Number.isFinite` scoasă din
//        `parseDecimalInput`.
//   HHM8 trecerea pe „Sumă fixă” șterge erorile care țin DOAR de procent
//        (plafon invalid, „Procent max 100”) — plafonul dispare, mesajul rămânea
//        lângă un câmp ascuns; o eroare care încă se aplică (numele gol) RĂMÂNE.
//        Mutația care pică: `setErr` scos din butonul „Sumă fixă”.
//   HHM9 cât cererea e în aer, formularul e blocat (o modificare tastată atunci
//        nu intra în cerere și se pierdea la succes) și la fel ÎNCHIDEREA:
//        „Anulează” (în formular), ✕, Escape și fundalul nu închid și nu
//        întreabă, chiar cu „Renunță” acceptat — altfel succesul cererii vechi
//        închidea un editor redeschis între timp, iar regula redeschisă pornea
//        de la valorile de dinainte de salvare (salvată, readucea reducerea
//        veche). După un refuz totul se deblochează cu ce s-a tastat. Controale:
//        fără cerere în aer, ACELAȘI Escape întreabă (deci ajunge la editor),
//        iar după succes editorul se închide. Mutațiile care pică:
//        `fieldset disabled={saving}` scos, sau `confirmDiscard` care lasă
//        închiderea cât se salvează (varianta cu `editorSeq` din a2e908a).
//   HHM10 o salvare fără răspuns NU blochează panoul la nesfârșit: exact la
//        HAPPY_HOUR_SAVE_TIMEOUT_MS cererea e ANULATĂ (semnalul ei), formularul
//        se deblochează cu ce s-a tastat, apare mesajul termenului (nu refuzul
//        `AbortError` al cererii anulate) și lista se reîncarcă (un INSERT
//        expirat poate fi totuși în bază — regula apare sub editor). Control: cu
//        1 ms înainte de termen totul e încă blocat, nimic reîncărcat. Mutațiile
//        care pică: fără `Promise.race` cu termenul (blocaj), fără
//        `ctrl.abort()`, fără `load()` la termen, sau refuzul cererii anulate
//        lăsat să ajungă în editor.
//   HHM11 o reîncărcare în FUNDAL (cea de la termen) nu demontează editorul
//        deschis pe o filă FĂRĂ reguli: același dialog, aceeași ciornă, fără
//        spinnerul filei, cât reîncărcarea e în aer și după ce aduce regula
//        (INSERT-ul expirat ajunsese în bază). Control: PRIMA
//        încărcare chiar arată spinnerul pe toată fila. Mutația care pică:
//        `if (loading && rules.length === 0) return <InlineSpinner/>` readus.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HappyHourRule } from '../../lib/happyHour'
import type { ConfirmOptions } from '../ui/confirm'
import promotionsRo from '../../i18n/ns/promotions/ro'

type NewRule = Omit<HappyHourRule, 'id' | 'restaurant_id' | 'created_at' | 'updated_at'>

const h = vi.hoisted(() => ({
  rules: [] as HappyHourRule[],
  created: [] as NewRule[],
  // Semnalul primit de fiecare creare (HHM10: anulată la termen).
  signals: [] as (AbortSignal | null)[],
  deleted: [] as string[],
  // Cererea de creare rămâne „în aer” până o rezolvă testul (HHM2).
  pending: null as null | { resolve: () => void; reject: (e: unknown) => void },
  holdCreate: false,
  // Încărcările listei: numărate, și ținute „în aer” la cerere (HHM11).
  fetches: 0,
  holdFetch: false,
  releaseFetch: (() => {}) as () => void,
  orders: [] as [string, string][],
  confirm: [] as ConfirmOptions[],
  answer: false,
}))

vi.mock('../ui/confirm', () => ({
  confirm: async (o: ConfirmOptions) => {
    h.confirm.push(o)
    return h.answer
  },
}))
vi.mock('../../lib/happyHour', () => ({
  fetchHappyHourRules: () => {
    h.fetches += 1
    if (!h.holdFetch) return Promise.resolve(h.rules)
    return new Promise<HappyHourRule[]>((resolve) => {
      h.releaseFetch = () => resolve(h.rules)
    })
  },
  evaluateHappyHourForNow: async () => [],
  createHappyHourRule: (_rid: string, fields: NewRule, signal?: AbortSignal) => {
    h.created.push(fields)
    h.signals.push(signal ?? null)
    if (!h.holdCreate) return Promise.resolve(h.rules[0])
    return new Promise<void>((resolve, reject) => {
      h.pending = { resolve, reject }
      // Ca supabase-js: o cerere anulată se încheie cu eroarea `AbortError`.
      signal?.addEventListener('abort', () =>
        reject({ message: 'AbortError: signal is aborted without reason', code: '20' }),
      )
    })
  },
  updateHappyHourRule: async () => {},
  deleteHappyHourRule: async (id: string) => {
    h.deleted.push(id)
  },
}))
vi.mock('../../lib/supabase', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) b[m] = () => b
    b.order = (col: string) => {
      h.orders.push([table, col])
      return b
    }
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({
        data:
          table === 'categories'
            ? [
                { id: 'c1', name: 'Cocktailuri', emoji: '🍹' },
                { id: 'c2', name: 'Bere', emoji: '🍺' },
              ]
            : [],
        error: null,
      }).then(resolve)
    return b
  }
  return { supabase: { from: (t: string) => builder(t) } }
})
vi.mock('../../hooks/usePollWhileVisible', () => ({ usePollWhileVisible: () => {} }))
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))

import HappyHourTab, { HAPPY_HOUR_SAVE_TIMEOUT_MS } from '../HappyHourTab'

function rule(over: Partial<HappyHourRule>): HappyHourRule {
  return {
    id: 'r1',
    restaurant_id: 'rest-1',
    name: 'Happy',
    is_active: true,
    starts_at: '17:00:00',
    ends_at: '19:00:00',
    days_of_week: [],
    scope: 'all',
    category_id: null,
    product_id: null,
    discount_type: 'percent',
    discount_value: 20,
    max_discount: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    ...over,
  }
}

beforeEach(() => {
  h.rules = [rule({}), rule({ id: 'r2', name: 'Seara' })]
  h.created = []
  h.signals = []
  h.deleted = []
  h.pending = null
  h.holdCreate = false
  h.fetches = 0
  h.holdFetch = false
  h.releaseFetch = () => {}
  h.orders = []
  h.confirm = []
  h.answer = false
})
// HHM10/HHM11 folosesc ceasul fals doar în jurul termenului; un test picat în
// mijloc nu are voie să-l lase următorului.
afterEach(() => {
  vi.useRealTimers()
})

// Avansează ceasul fals și lasă promisiunile să se așeze (tiparul din
// PayTableSheet.test.tsx). Doar `fireEvent` și interogări sincrone cât ceasul e
// fals: `userEvent` și `waitFor`/`findBy` își programează pașii pe `setTimeout`.
async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function openNew() {
  const user = userEvent.setup()
  render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
  await screen.findByText('Seara')
  await user.click(screen.getByRole('button', { name: 'Regulă nouă' }))
  return { user, dlg: screen.getByRole('dialog', { name: 'Regulă nouă' }) }
}

describe('editorul Happy Hour (lotul C4a)', () => {
  it('HHM1 dialog real, cu câmpuri numite', async () => {
    const { user, dlg } = await openNew()
    expect(within(dlg).getByRole('button', { name: 'Creează regulă' })).toBeInTheDocument()
    expect(within(dlg).getByLabelText('Nume *')).toHaveAttribute('placeholder', 'ex: Happy Hour 17-19')
    expect(within(dlg).getByLabelText('De la')).toHaveValue('17:00')
    expect(within(dlg).getByLabelText('Până la')).toHaveValue('19:00')
    expect(within(dlg).getByRole('group', { name: 'Zilele săptămânii (gol = toate)' })).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Categorie' }))
    expect(within(dlg).getByRole('button', { name: 'Categorie' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dlg).getByRole('combobox', { name: 'Categorie' })).toBeInTheDocument()
  })

  it('HHM2 dublu-click: regula se creează o singură dată', async () => {
    h.holdCreate = true
    const { user, dlg } = await openNew()
    await user.type(within(dlg).getByLabelText('Nume *'), 'Seara de joi')
    const create = within(dlg).getByRole('button', { name: 'Creează regulă' })
    await user.dblClick(create)
    await user.click(create)
    expect(h.created).toHaveLength(1)
    const busy = within(dlg).getByRole('button', { name: 'Se salvează…' })
    expect(busy).toBeDisabled()

    // Refuzul deblochează butonul: a doua încercare pleacă (control).
    h.pending?.reject({ message: 'Nu ai voie.', code: '42501' })
    expect(await within(dlg).findByRole('button', { name: 'Creează regulă' })).toBeEnabled()
    h.holdCreate = false
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(h.created).toHaveLength(2))
  })

  it('HHM3 închiderea cu modificări întreabă; fără modificări, nu', async () => {
    const { user, dlg } = await openNew()
    // Control: neatins → „Anulează” închide direct, fără întrebare.
    await user.click(within(dlg).getByRole('button', { name: 'Anulează' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.confirm).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Regulă nouă' }))
    let open = screen.getByRole('dialog', { name: 'Regulă nouă' })
    await user.type(within(open).getByLabelText('Nume *'), 'Brunch')
    await user.click(within(open).getByRole('button', { name: 'Anulează' }))
    await waitFor(() => expect(h.confirm).toHaveLength(1))
    expect(h.confirm[0]).toMatchObject({ title: 'Renunți la modificări?', cancelLabel: 'Rămân în editor' })
    open = screen.getByRole('dialog', { name: 'Regulă nouă' })
    expect(within(open).getByLabelText('Nume *')).toHaveValue('Brunch')

    h.answer = true
    await user.click(within(open).getByRole('button', { name: 'Închide' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(h.confirm).toHaveLength(2)
    expect(h.created).toHaveLength(0)
  })

  it('HHM4 valoarea și plafonul cu virgulă; plafonul invalid e o eroare', async () => {
    const { user, dlg } = await openNew()
    await user.type(within(dlg).getByLabelText('Nume *'), 'Happy')
    const value = within(dlg).getByLabelText('Valoarea reducerii')
    await user.clear(value)
    await user.type(value, '12,5')
    const cap = within(dlg).getByLabelText('Plafon maxim în lei, opțional')
    await user.type(cap, 'abc')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Plafonul nu e un număr valid')
    expect(cap).toHaveAttribute('aria-invalid', 'true')
    expect(h.created).toHaveLength(0)

    await user.clear(cap)
    await user.type(cap, '7,5')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(h.created).toHaveLength(1))
    expect(h.created[0]).toMatchObject({ discount_type: 'percent', discount_value: 12.5, max_discount: 7.5 })
  })

  it('HHM5 categoriile în ordinea meniului', async () => {
    render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
    await screen.findByText('Seara')
    expect(h.orders).toContainEqual(['categories', 'display_order'])
    expect(h.orders).not.toContainEqual(['categories', 'position'])
  })

  it('HHM6 ștergerea cere confirmare', async () => {
    const user = userEvent.setup()
    render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
    await screen.findByText('Seara')
    await user.click(screen.getByRole('button', { name: 'Șterge regula Seara' }))
    await waitFor(() => expect(h.confirm).toHaveLength(1))
    expect(h.confirm[0]).toMatchObject({
      title: 'Ștergi regula?',
      description: 'Vrei să ștergi Seara? Acțiunea e ireversibilă.',
      confirmLabel: 'Șterge',
      cancelLabel: 'Anulează',
      destructive: true,
    })
    expect(h.deleted).toEqual([])

    h.answer = true
    await user.click(screen.getByRole('button', { name: 'Șterge regula Seara' }))
    await waitFor(() => expect(h.deleted).toEqual(['r2']))
  })

  it('HHM7 o valoare sau un plafon prea mare e o eroare', async () => {
    const huge = '9'.repeat(309)
    const { user, dlg } = await openNew()
    await user.type(within(dlg).getByLabelText('Nume *'), 'Happy')
    const cap = within(dlg).getByLabelText('Plafon maxim în lei, opțional')
    fireEvent.change(cap, { target: { value: huge } })
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Plafonul nu e un număr valid')
    expect(cap).toHaveAttribute('aria-invalid', 'true')
    expect(h.created).toHaveLength(0)

    await user.click(within(dlg).getByRole('button', { name: 'Sumă fixă (lei)' }))
    const value = within(dlg).getByLabelText('Valoarea reducerii')
    fireEvent.change(value, { target: { value: huge } })
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Valoarea nu e un număr valid')
    expect(value).toHaveAttribute('aria-invalid', 'true')
    expect(h.created).toHaveLength(0)

    // Control: o sumă obișnuită pleacă.
    fireEvent.change(value, { target: { value: '50' } })
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(h.created).toHaveLength(1))
    expect(h.created[0]).toMatchObject({
      discount_type: 'amount',
      discount_value: 50,
      max_discount: null,
    })
  })

  it('HHM8 „Sumă fixă” șterge doar erorile de procent', async () => {
    const { user, dlg } = await openNew()
    await user.type(within(dlg).getByLabelText('Nume *'), 'Happy')
    await user.type(within(dlg).getByLabelText('Plafon maxim în lei, opțional'), 'abc')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Plafonul nu e un număr valid')
    await user.click(within(dlg).getByRole('button', { name: 'Sumă fixă (lei)' }))
    expect(within(dlg).queryByRole('alert')).toBeNull()
    expect(within(dlg).queryByLabelText('Plafon maxim în lei, opțional')).toBeNull()

    // „Procent max 100” nu se aplică unei sume în lei: 150 lei pleacă.
    await user.click(within(dlg).getByRole('button', { name: 'Procent (%)' }))
    const value = within(dlg).getByLabelText('Valoarea reducerii')
    await user.clear(value)
    await user.type(value, '150')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Procent max 100')
    await user.click(within(dlg).getByRole('button', { name: 'Sumă fixă (lei)' }))
    expect(within(dlg).queryByRole('alert')).toBeNull()
    expect(value).not.toHaveAttribute('aria-invalid')

    // Control: o eroare care încă se aplică (numele gol) rămâne.
    await user.click(within(dlg).getByRole('button', { name: 'Procent (%)' }))
    await user.clear(within(dlg).getByLabelText('Nume *'))
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Numele e obligatoriu')
    await user.click(within(dlg).getByRole('button', { name: 'Sumă fixă (lei)' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Numele e obligatoriu')
    expect(h.created).toHaveLength(0)

    await user.type(within(dlg).getByLabelText('Nume *'), 'Happy')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await waitFor(() => expect(h.created).toHaveLength(1))
    expect(h.created[0]).toMatchObject({
      discount_type: 'amount',
      discount_value: 150,
      max_discount: null,
    })
  })

  it('HHM9 cât se salvează, formularul și închiderea sunt blocate; refuzul le deblochează', async () => {
    h.holdCreate = true
    const { user, dlg } = await openNew()
    const name = within(dlg).getByLabelText('Nume *')
    await user.type(name, 'Brunch')
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(h.created).toHaveLength(1)
    expect(name).toBeDisabled()
    expect(within(dlg).getByLabelText('Valoarea reducerii')).toBeDisabled()
    expect(within(dlg).getByRole('button', { name: 'Categorie' })).toBeDisabled()
    expect(within(dlg).getByRole('button', { name: 'Anulează' })).toBeDisabled()

    // ✕ (în antetul dialogului, în afara formularului), Escape și fundalul nu
    // închid și nu întreabă, chiar dacă „Renunță” ar fi acceptat.
    h.answer = true
    await user.click(within(dlg).getByRole('button', { name: 'Închide' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    await user.click(dlg.parentElement as HTMLElement)
    expect(h.confirm).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: 'Regulă nouă' })).toBe(dlg)

    // Refuzul deblochează totul, cu ce s-a tastat.
    h.pending?.reject({ message: 'Nu ai voie.', code: '42501' })
    await waitFor(() => expect(name).toBeEnabled())
    expect(name).toHaveValue('Brunch')
    expect(within(dlg).getByRole('button', { name: 'Anulează' })).toBeEnabled()

    // Control: fără cerere în aer, ACELAȘI Escape întreabă (deci ajunge la
    // editor); refuzată, întrebarea lasă editorul deschis.
    h.answer = false
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(h.confirm).toHaveLength(1))
    expect(screen.getByRole('dialog', { name: 'Regulă nouă' })).toBe(dlg)

    // Control: după succes editorul se închide.
    await user.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    expect(h.created).toHaveLength(2)
    h.pending?.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('HHM10 fără răspuns, la termen: cererea anulată, formularul deblocat, eroare, lista reîncărcată', async () => {
    h.holdCreate = true
    const { user, dlg } = await openNew()
    const name = within(dlg).getByLabelText('Nume *')
    await user.type(name, 'Brunch')
    expect(h.fetches).toBe(1)

    vi.useFakeTimers()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await flush()
    expect(h.created).toHaveLength(1)
    const signal = h.signals[0]
    expect(signal?.aborted).toBe(false)

    // Control: cu 1 ms înainte de termen, totul e încă blocat.
    await flush(HAPPY_HOUR_SAVE_TIMEOUT_MS - 1)
    expect(name).toBeDisabled()
    expect(within(dlg).queryByRole('alert')).toBeNull()
    expect(signal?.aborted).toBe(false)
    expect(h.fetches).toBe(1)

    // INSERT-ul poate fi ajuns totuși în bază: lista reîncărcată îl arată.
    h.rules = [...h.rules, rule({ id: 'r3', name: 'Brunch' })]
    await flush(1)
    vi.useRealTimers()

    expect(signal?.aborted).toBe(true)
    expect(name).toBeEnabled()
    expect(name).toHaveValue('Brunch')
    expect(within(dlg).getByRole('button', { name: 'Creează regulă' })).toBeEnabled()
    // Mesajul termenului, nu refuzul `AbortError` al cererii anulate.
    const alert = within(dlg).getByRole('alert')
    expect(alert).toHaveTextContent('Salvarea nu a putut fi confirmată')
    expect(alert.textContent).toBe(promotionsRo.err_saveTimeout)
    expect(h.fetches).toBe(2)
    expect(await screen.findByText('Brunch')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Regulă nouă' })).toBe(dlg)
    expect(h.created).toHaveLength(1)
  })

  it('HHM11 o reîncărcare în fundal nu demontează editorul deschis (fila fără reguli)', async () => {
    h.rules = []
    h.holdCreate = true
    h.holdFetch = true
    const user = userEvent.setup()
    render(<HappyHourTab restaurantId="rest-1" payAtTable={false} />)
    // Control: PRIMA încărcare ține spinnerul pe toată fila.
    expect(await screen.findByText('Se încarcă regulile...')).toBeInTheDocument()
    h.releaseFetch()
    expect(await screen.findByText('Nicio regulă încă')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Regulă nouă' }))
    const dlg = screen.getByRole('dialog', { name: 'Regulă nouă' })
    const name = within(dlg).getByLabelText('Nume *')
    await user.type(name, 'Brunch')

    // Salvarea ajunge la termen; reîncărcarea de după rămâne „în aer”.
    vi.useFakeTimers()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Creează regulă' }))
    await flush(HAPPY_HOUR_SAVE_TIMEOUT_MS)
    vi.useRealTimers()
    expect(h.fetches).toBe(2)
    expect(screen.queryByText('Se încarcă regulile...')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Regulă nouă' })).toBe(dlg)
    expect(name).toHaveValue('Brunch')
    expect(name).toBeEnabled()
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Salvarea nu a putut fi confirmată')

    // Și după ce reîncărcarea se termină (INSERT-ul expirat ajunsese în bază,
    // regula apare sub editor): același editor, aceeași ciornă.
    h.rules = [rule({ id: 'r3', name: 'Brunch' })]
    h.releaseFetch()
    expect(await screen.findByText('Brunch')).toBeInTheDocument()
    expect(screen.queryByText('Nicio regulă încă')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Regulă nouă' })).toBe(dlg)
    expect(name).toHaveValue('Brunch')
  })
})
