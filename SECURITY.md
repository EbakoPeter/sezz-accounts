# Modèle de sécurité — SEZZ Accounts

Ce document explique ce que le chiffrement de cette application protège
réellement, ce qu'il ne protège délibérément pas, et pourquoi — pour que
personne ne surestime (ou ne sous-estime) ce qui est en place.

## Ce qui est chiffré, et comment

Toutes les données financières (comptes, opérations, budget, dettes,
remboursements) sont chiffrées au repos dans IndexedDB, champ sensible par
champ sensible (noms, montants, libellés, descriptions), avec AES-256-GCM.
Seuls les champs strictement nécessaires à l'indexation Dexie (identifiants,
dates, types énumérés, clés étrangères) restent en clair — voir
`src/db/encryptedRecord.ts`.

**Une seule clé de chiffrement (DEK — Data Encryption Key)** protège
l'ensemble de ces données. Elle est partagée entre tous les utilisateurs
ayant accès à l'application, parce que plusieurs utilisateurs peuvent
légitimement consulter et modifier les mêmes comptes (voir le système de
privilèges). Cette DEK n'est cependant **jamais stockée en clair** :

- Chaque utilisateur possède sa propre copie de la DEK, chiffrée
  ("enveloppée") sous une clé dérivée de son propre mot de passe (PBKDF2,
  150 000 itérations, sel individuel).
- Se connecter dérive cette clé à partir du mot de passe saisi, déballe la
  DEK, et la garde **en mémoire uniquement** pour la durée de la session
  (`src/lib/encryptionSession.ts`) — jamais écrite sur le disque, jamais
  dans le stockage du navigateur.
- Changer son mot de passe ne re-chiffre jamais les données elles-mêmes :
  seule l'enveloppe de cet utilisateur autour de la DEK change. Ajouter un
  nouvel utilisateur ne fait que lui donner, lui aussi, sa propre enveloppe
  autour de cette même DEK.

## Ce que ce chiffrement protège

- **La lecture directe du fichier IndexedDB** (par ex. en examinant le
  profil du navigateur sur disque, ou via un outil qui parcourt le stockage
  d'un autre profil/utilisateur du même appareil) ne révèle aucune donnée
  financière en clair — seulement des blobs chiffrés et les quelques champs
  structurels (dates, identifiants) déjà jugés non sensibles.
- **Un mot de passe utilisateur compromis isolément** ne compromet que
  l'accès de cet utilisateur, jusqu'à ce qu'il soit changé — pas les données
  elles-mêmes, qui restent protégées par la DEK.

## Ce que ce chiffrement ne protège PAS — et pourquoi ce n'est pas un oubli

- **Un appareil déjà déverrouillé, avec la session active.** Comme toute
  application chiffrée côté client, une fois qu'un utilisateur légitime est
  connecté, l'application affiche les données en clair à l'écran — c'est
  attendu, pas une faille.
- **Un attaquant capable d'exécuter du code dans la page** (extension de
  navigateur malveillante, faille XSS hypothétique) pourrait lire la DEK en
  mémoire pendant une session active, exactement comme il pourrait lire
  n'importe quelle variable JavaScript de la page. Le chiffrement au repos
  protège les données _stockées_, pas les données _en cours de traitement_
  dans un navigateur compromis — aucune application web ne peut se protéger
  entièrement contre ce scénario.
- **Une attaque par mot de passe faible.** PBKDF2 à 150 000 itérations
  ralentit sensiblement une attaque par force brute hors-ligne, mais un mot
  de passe court ou courant reste vulnérable. Aucune limite de tentatives de
  connexion n'est actuellement implémentée (voir la section suivante).
- **La perte du dernier mot de passe capable de déballer la DEK, sans aucune
  sauvegarde.** Il n'existe actuellement aucun mécanisme de récupération
  (code de récupération, question secrète, etc.) : si tous les utilisateurs
  oublient leur mot de passe, les données sont irrécupérables. C'est un
  compromis délibéré de cette étape (voir "Limites connues" ci-dessous),
  pas une négligence.

## Limites connues, non traitées à ce stade

- **Aucune limite de tentatives de connexion** (`usersRepository.authenticate`
  peut être appelé indéfiniment). Une protection simple (délai croissant ou
  verrouillage temporaire après quelques échecs) serait la prochaine
  amélioration de sécurité à apporter avant tout déploiement réel.
- **Aucun mécanisme de récupération de mot de passe.** L'ancienne version de
  l'application avait un code de récupération distinct ; cette réécriture ne
  l'a pas encore réintroduit.
- **La synchronisation entre appareils (SYNC_PLAN.md), une fois construite,
  devra décider comment un serveur distant traite cette DEK partagée** — soit
  le serveur ne voit jamais la DEK en clair (chiffrement de bout en bout,
  plus complexe), soit on accepte que le serveur soit un tiers de confiance
  qui la voit (plus simple, mais un changement de posture de sécurité qu'il
  faudra documenter explicitement le moment venu).

## Pourquoi cette architecture plutôt qu'un chiffrement plus simple

Une alternative plus simple — chiffrer tout avec une clé dérivée directement
du mot de passe d'un utilisateur unique — a été délibérément écartée : elle
ne fonctionne que pour une seule personne. Dès qu'un deuxième utilisateur
doit accéder aux mêmes comptes (le système de privilèges de cette
application le permet explicitement), il lui faudrait soit connaître le
premier mot de passe, soit voir ses propres données chiffrées séparément
(perdant alors le partage réel des comptes). L'enveloppement d'une DEK
partagée, par utilisateur, résout ce problème proprement : ajouter,
retirer, ou faire changer de mot de passe un utilisateur n'affecte jamais
les données elles-mêmes, seulement les enveloppes autour de la clé qui les
protège.
