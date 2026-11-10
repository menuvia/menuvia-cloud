import type { Translation } from '../../core'
import type ro from './ro'

const de: Translation<typeof ro> = {
  title: 'Akzeptieren Sie die Nutzungsbedingungen, um fortzufahren',
  body: 'Wir benötigen Ihre dokumentierte Zustimmung zu den Nutzungsbedingungen und zur Datenschutzerklärung. Das dauert eine Sekunde und wird nur einmal abgefragt.',
  sentence: 'Ich habe die {terms} und die {privacy} gelesen und akzeptiere sie.',
  linkTerms: 'Nutzungsbedingungen',
  linkPrivacy: 'Datenschutzerklärung',
  recordFailed: 'Wir konnten Ihre Zustimmung nicht speichern. Versuchen Sie es erneut.',
  network: 'Keine Verbindung. Prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.',
  recording: 'Wird gespeichert...',
  accept: 'Akzeptieren und fortfahren',
  signOut: 'Abmelden',
}

export default de
