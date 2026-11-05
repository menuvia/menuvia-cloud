import type { Translation } from '../../core'
import type ro from './ro'

const en: Translation<typeof ro> = {
  title: 'Accept the Terms to continue',
  body: 'We need your recorded consent to the Terms and the Privacy Policy. It takes a second and is asked only once.',
  sentence: 'I have read and accept the {terms} and the {privacy}.',
  linkTerms: 'Terms',
  linkPrivacy: 'Privacy Policy',
  recordFailed: 'We couldn’t record your acceptance. Try again.',
  network: 'No connection. Check your internet and try again.',
  recording: 'Recording...',
  accept: 'Accept and continue',
  signOut: 'Sign out',
}

export default en
