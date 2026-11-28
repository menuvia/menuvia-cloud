// Formularul mic de „extra nou” din fișa produsului (Extras & Pereche).
//
// Lotul C4a: prețul era `type="number"` + `parseFloat`. Pe o tastatură
// românească „4,50” nu trecea: browserul raporta câmpul GOL, iar butonul
// „Adaugă” rămânea dezactivat fără nicio explicație. Acum câmpul e text cu
// tastatură zecimală (`inputMode="decimal"`), parsat cu `parseDecimalInput`, ca
// prețul produsului (lotul O5a). Un preț lipsă, negativ sau fără formă de număr
// primește un mesaj lângă câmp, niciodată un 0 tăcut sau un buton mort.
import { useId, useState } from 'react'
import { D } from '../../lib/constants'
import { Inp } from './sharedUI'
import { Button } from '../ui/Button'
import { parseDecimalInput } from '../../lib/decimal'
import { useT } from '../../i18n/useT'
import { productsNs } from '../../i18n/ns/products'

type PriceError = 'val_priceRequired' | 'val_priceNegative' | 'val_priceInvalid'

export function ExtraForm({
  onAdd,
}: {
  onAdd: (name: string, price: number, emoji: string) => void | Promise<void>
}) {
  const { t } = useT(productsNs)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [emoji, setEmoji] = useState('')
  // Eroarea ținută ca CHEIE (se traduce la randare, în limba curentă).
  const [priceError, setPriceError] = useState<PriceError | null>(null)
  const errorId = useId()

  function submit() {
    if (name.trim().length === 0) return
    // Minusul întâi: „-5” n-are formă de preț, deci altfel ar fi primit mesajul
    // generic (aceeași ordine ca fișa produsului).
    if (price.trim().startsWith('-')) {
      setPriceError('val_priceNegative')
      return
    }
    const p = parseDecimalInput(price)
    if (p == null) {
      setPriceError('val_priceRequired')
      return
    }
    if (Number.isNaN(p)) {
      setPriceError('val_priceInvalid')
      return
    }
    setPriceError(null)
    void onAdd(name, p, emoji)
    setName('')
    setPrice('')
    setEmoji('')
  }

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '40px 1fr 80px 70px',
          gap: 6,
          alignItems: 'center',
        }}
      >
        <Inp label={t('extra_emoji')} value={emoji} onChange={setEmoji} placeholder="🧀" />
        <Inp label={t('extra_name')} value={name} onChange={setName} placeholder={t('extra_namePh')} />
        <Inp
          label={t('extra_price')}
          value={price}
          onChange={(v) => {
            setPrice(v)
            if (priceError) setPriceError(null)
          }}
          inputMode="decimal"
          invalid={priceError != null}
          describedBy={priceError ? errorId : undefined}
          placeholder="5.00"
        />
        <Button variant="primary" size="sm" onClick={submit} disabled={name.trim().length === 0}>
          {t('add')}
        </Button>
      </div>
      {priceError && (
        <div id={errorId} role="alert" style={{ color: D.red, fontSize: '0.76rem', marginTop: 6 }}>
          {t(priceError)}
        </div>
      )}
    </div>
  )
}
