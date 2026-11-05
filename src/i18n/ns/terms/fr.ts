import type { Translation } from '../../core'
import type ro from './ro'

const fr: Translation<typeof ro> = {
  title: 'Acceptez les Conditions pour continuer',
  body: 'Nous avons besoin de votre accord enregistré pour les Conditions et la Politique de confidentialité. Cela prend une seconde et n’est demandé qu’une seule fois.',
  sentence: 'J’ai lu et j’accepte les {terms} et la {privacy}.',
  linkTerms: 'Conditions',
  linkPrivacy: 'Politique de confidentialité',
  recordFailed: 'Nous n’avons pas pu enregistrer votre accord. Réessayez.',
  network: 'Pas de connexion. Vérifiez votre connexion internet et réessayez.',
  recording: 'Enregistrement...',
  accept: 'Accepter et continuer',
  signOut: 'Se déconnecter',
}

export default fr
