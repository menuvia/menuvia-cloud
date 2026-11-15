// src/components/RoleGateScreen.tsx — ecranul porții de rol de pe /kitchen și
// /waiter (ProtectedRoute din App.tsx), scos în fișier propriu în lotul L4d ca
// textele lui să poată fi testate în fiecare limbă (App.tsx trage după el tot
// ruterul). Decizia (cine are voie, unde duce ieșirea) rămâne în App.tsx.
//
// Limba e a PERSONALULUI, citită direct din provider (`useUiLang`), nu din
// `<html lang>`: `StaffDocumentLang` de deasupra pune limba pe document abia
// în efect, deci prima randare ar fi ieșit în română. Textele stau în
// `chrome.ts` (graful intrării nu are voie la `src/i18n/ns`, SK4); în română
// sunt EXACT cele de dinainte.
import { D } from '../lib/constants'
import { useUiLang } from '../i18n/UiLangContext'
import { chromeLangOf, chromeT } from '../i18n/chrome'
import { QueryError } from './PageLoader'

export function RoleGateScreen({
  loadFailed,
  onRetry,
}: {
  /** Membership-urile nu s-au putut încărca (blip de rețea), nu „fără drept”. */
  loadFailed: boolean
  /** Ieșirea din „fără acces”: ecranul rolului (lib/roleRouting.ts). */
  onRetry: () => void
}) {
  const lang = chromeLangOf(useUiLang().lang)
  return (
    <div
      style={{
        minHeight: '100vh',
        background: D.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      {loadFailed ? (
        // Rolul e null NU pentru că n-are drept, ci pentru că fetch-ul a picat:
        // „reîncearcă" (reload), nu mesajul alarmant de „fără acces".
        <QueryError message={chromeT(lang, 'gate_perms_error')} onRetry={() => window.location.reload()} />
      ) : (
        <QueryError
          message={chromeT(lang, 'gate_no_access')}
          retryLabel={chromeT(lang, 'gate_go_home')}
          onRetry={onRetry}
        />
      )}
    </div>
  )
}
