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
  de passe court ou courant reste vulnérable face à quelqu'un qui
  contournerait l'interface (voir la limite de tentatives ci-dessous, qui ne
  protège que l'interface elle-même).

## Limite de tentatives de connexion (implémentée)

Après 5 échecs consécutifs sur un même compte, l'accès est bloqué
temporairement, avec un délai qui double à chaque nouvel échec (30 s, 1 min,
2 min, ... jusqu'à un plafond de 15 minutes) — voir `src/lib/loginRateLimit.ts`.
Une tentative réussie remet le compteur à zéro. Un nom d'utilisateur
inexistant n'est jamais bloqué (il n'y a rien à protéger derrière).

**Limite honnête de cette protection** : elle ne protège que le passage par
l'interface de l'application. Une personne ayant accès à la console de
développement du navigateur pourrait appeler `usersRepository.authenticate()`
directement et contourner ce compteur — aucun mécanisme purement côté client
ne peut empêcher cela. Ce verrou augmente le coût d'un essai rapide et
répété via l'interface normale ; il ne remplace pas un mot de passe robuste.

## Mécanisme de récupération (implémenté)

Chaque utilisateur reçoit, à la création de son compte, un **code de
récupération** à usage détourné du mot de passe : 16 caractères (alphabet
sans caractères ambigus), affiché une seule fois, jamais stocké en clair.
Comme pour le mot de passe, seul un hachage (pour une vérification rapide)
et une copie de la DEK partagée chiffrée sous une clé dérivée de ce code
sont conservés.

En cas de mot de passe oublié, ce code permet de définir un nouveau mot de
passe sans perdre l'accès aux données (voir le lien « Mot de passe oublié ? »
sur l'écran de connexion). Utiliser le code le fait immédiatement pivoter
(un nouveau code est généré et affiché) — l'ancien cesse de fonctionner,
exactement comme un code de sauvegarde à usage unique d'une authentification
à deux facteurs. Un utilisateur peut aussi régénérer son propre code à tout
moment (avec son mot de passe actuel) sans attendre d'en avoir besoin.

**Ce que cela ne couvre pas** : si le code de récupération ET le mot de passe
sont tous deux perdus, l'accès à ce compte est définitivement perdu — il n'y
a délibérément aucune porte dérobée supplémentaire. Si cet utilisateur était
le seul administrateur, cela signifie perdre l'accès à l'administration de
l'application (mais pas aux données elles-mêmes : si un autre utilisateur
existe, cette personne reste malgré tout connectée avec un accès normal ;
voir aussi `adminResetPassword`, qui permet à un administrateur de
réinitialiser le mot de passe d'un autre utilisateur sans son code).

## Limites connues, non traitées à ce stade

- **Un nouvel appareil ne peut pas encore « rejoindre » un foyer existant via
  la synchronisation sans risque.** La synchronisation (SYNC_PLAN.md) est
  maintenant construite avec le même principe : le serveur ne voit jamais la
  DEK en clair. Mais un appareil réellement neuf passe d'abord par « créez le
  compte administrateur principal » (qui génère sa propre DEK) _avant_ de
  pouvoir se connecter à la synchronisation — il n'existe pas encore de
  chemin pour configurer la synchronisation en premier et récupérer une DEK
  existante à la place. Si deux appareils créent chacun leur propre
  administrateur puis se synchronisent ensemble, chacun reçoit les données de
  l'autre chiffrées sous une clé qu'il ne possède pas : ces données
  deviennent invisibles sur cet appareil (voir ci-dessous), pas corrompues,
  mais illisibles tant que ce décalage n'est pas résolu manuellement. En
  pratique : un seul appareil doit créer le compte administrateur ; tous les
  autres doivent se connecter à la synchronisation existante plutôt que de
  créer leur propre administrateur indépendamment.
- **Conséquence directe, déjà corrigée : un enregistrement provenant d'une
  clé différente ne doit jamais faire planter l'application.** Avant
  correction, un seul enregistrement synchronisé sous la mauvaise clé
  rendait tout illisible (y compris les propres données de l'appareil).
  `fromStorageRows` (voir `src/db/encryptedRecord.ts`) ignore désormais
  silencieusement (avec un message dans la console) les enregistrements
  qu'il ne peut pas déchiffrer, plutôt que de faire échouer tout l'affichage
  à cause d'un seul. Cela rend le décalage de clé invisible sans message à
  l'écran pour l'instant plutôt que fatal — une amélioration de l'affichage
  d'un statut de synchronisation visible reste à faire.
- **Aucune protection contre un mot de passe et un code de récupération tous
  deux compromis simultanément** (par ex. les deux notés au même endroit
  physique). C'est un compromis inhérent à ce mode de récupération, pas
  spécifique à cette application.

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
