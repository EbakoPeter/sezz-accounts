# SEZZ Accounts — réécriture normalisée

Réécriture, depuis zéro, de l'application de gestion budgétaire personnelle, avec les
standards d'ingénierie applicative : schéma de données normalisé, typage strict,
tests automatisés, lint/format appliqués, sans Excel ni Capacitor.

## État d'avancement

**Fait (Étapes 1 et 2 du plan, + installabilité) :**

- Socle du projet : Vite + React 18 + TypeScript strict, ESLint (flat config), Prettier, Vitest.
- Couche de données normalisée sur IndexedDB (via Dexie) : `Account` et `Transaction`
  sont deux entités distinctes reliées par un identifiant (`accountId`), et non plus
  par une correspondance de chaîne de caractères comme dans la version précédente.
  Revenus et dépenses sont unifiés dans une seule table `Transaction` (champ `kind`).
- Couche de dépôts (repositories) typée : validation métier, erreurs typées
  (`ValidationError`, `NotFoundError`), intégrité référentielle (impossible de
  supprimer un compte ayant des opérations sans le demander explicitement).
- Interface fonctionnelle minimale (Comptes + Opérations), branchée sur cette couche
  de données, avec mise à jour réactive automatique (`dexie-react-hooks`).
- **Installable comme application (PWA)**, sur ordinateur (Chrome/Edge) et sur
  Android (Chrome), sans Capacitor ni React Native : manifeste + service worker
  générés automatiquement (`vite-plugin-pwa`), icônes dédiées (y compris l'icône
  "maskable" adaptative d'Android). Vérifié par `npm run verify:pwa`, qui contrôle
  les critères réels que Chrome utilise pour proposer l'installation.
- **Budget Prévisionnel** : catégories et sous-catégories normalisées (une
  catégorie n'est qu'un regroupement, jamais de montant propre — tout vit sur la
  sous-catégorie), comparaison prévisionnel/réel par mois calculée à la lecture,
  intégrité référentielle (supprimer une catégorie/sous-catégorie encore utilisée
  est bloqué sauf suppression forcée explicite — qui _déconnecte_ les opérations
  concernées plutôt que de les supprimer). Le formulaire de dépense affiche, comme
  dans l'ancienne version, le montant restant disponible sur chaque ligne avant
  de la choisir.
- **Dettes & Créances** : référence auto-incrémentale (D01, D02…) purement
  d'affichage — le lien réel entre un remboursement et sa dette est un identifiant,
  jamais cette référence. Mensualité prévisionnelle calculée automatiquement
  (montant ÷ mois jusqu'à l'échéance), statut dérivé (Soldé / En retard / En cours).
  Une dette/créance affecte immédiatement le solde du compte concerné, un
  remboursement dans le sens inverse — logique désormais centralisée dans
  `accountFlows.ts` (voir "Principes de conception" ci-dessous) plutôt que
  dupliquée. Supprimer une dette encore remboursée est bloqué sauf suppression
  forcée (qui supprime alors ses remboursements aussi, contrairement aux
  catégories budgétaires : un remboursement sans sa dette n'a pas de sens).
- **Rapport Mensuel** : revenus/dépenses par mois, toujours triés de janvier à
  décembre, avec solde net et solde cumulé (remis à zéro à chaque nouvelle année),
  et un graphique en barres. Ne compte volontairement ni les dettes ni les
  remboursements comme revenu/dépense — emprunter n'est pas un revenu, rembourser
  le principal n'est pas une dépense courante ; ce choix comptable est documenté
  directement dans le code.
- **Recommandations** : analyse automatique du mois en cours (taux d'épargne,
  hausse des dépenses par rapport au mois précédent, dépassements de budget,
  soldes de comptes négatifs, dettes en retard), entièrement calculée à partir des
  modules déjà présents — aucune nouvelle donnée stockée.
- **Comptes utilisateur et privilèges configurables** : profils locaux protégés par
  mot de passe (haché via PBKDF2, 150 000 itérations — jamais stocké en clair),
  avec un rôle de départ (Administrateur / Standard / Lecture seule) dont chaque
  privilège individuel (gérer les comptes, les opérations, le budget, les dettes,
  consulter les rapports, gérer les utilisateurs) reste modifiable indépendamment
  ensuite — les rôles ne sont que des préréglages, pas une liste fermée. Le système
  refuse de retirer le dernier utilisateur capable de gérer les utilisateurs, pour
  qu'il ne soit jamais possible de verrouiller sa propre administration.
  Session en mémoire uniquement (choix délibéré : aucun jeton persisté, donc
  reconnexion obligatoire à chaque ouverture — voir le composant `LoginScreen`).
- **Chiffrement des données au repos.** Chaque champ sensible (noms, montants,
  libellés, descriptions — tout sauf les identifiants, dates et clés étrangères
  nécessaires à l'indexation Dexie) est regroupé et chiffré (AES-256-GCM) avant
  d'atteindre IndexedDB. Une seule clé de chiffrement (DEK) protège l'ensemble des
  données — partagée, puisque plusieurs utilisateurs peuvent légitimement accéder
  aux mêmes comptes/opérations — mais jamais stockée en clair : chaque utilisateur
  détient sa propre copie de cette clé, chiffrée ("enveloppée") sous une clé dérivée
  de son propre mot de passe (PBKDF2). Changer son mot de passe ne re-chiffre donc
  jamais les données elles-mêmes, seulement l'enveloppe de cet utilisateur. Voir
  SECURITY.md pour le modèle de menace complet (ce que ce chiffrement protège,
  et ce qu'il ne protège délibérément pas).
- **Limite de tentatives de connexion.** Après 5 échecs consécutifs, blocage
  temporaire avec un délai qui double à chaque nouvel échec (30 s → 15 min max).
  Protège l'interface normale, pas un accès direct à la console — voir SECURITY.md
  pour cette nuance assumée plutôt que cachée.
- **Mécanisme de récupération.** Chaque utilisateur reçoit, à la création de son
  compte, un code de récupération à usage unique (affiché une seule fois, jamais
  stocké en clair — seuls un hachage et une seconde enveloppe de la DEK le sont),
  permettant de définir un nouveau mot de passe en cas d'oubli sans perdre l'accès
  aux données. Utiliser le code le fait pivoter automatiquement ; régénérable à
  tout moment avec le mot de passe actuel.
- 272 tests automatisés (dépôts + composants), intégralement verts.

**Pas encore fait (suite du plan) :**

- **Synchronisation entre appareils** — nécessite un serveur backend distinct ;
  voir SYNC_PLAN.md. Reporté après la version hors-ligne. (Les comptes utilisateur,
  le chiffrement, la limite de tentatives et la récupération sont faits ; c'est la
  synchronisation multi-appareils qui reste liée à ce chantier — et qui devra
  composer avec la clé partagée : voir SECURITY.md.)

## Démarrer

```bash
npm install
npm run dev        # serveur de développement
npm run build       # build de production (tsc -b && vite build)
npm run test         # suite de tests (Vitest)
npm run lint          # ESLint, zéro avertissement toléré
npm run format:check   # vérifie le formatage Prettier
npm run typecheck       # tsc --noEmit, mode strict
npm run verify:pwa       # vérifie que le build respecte les critères d'installabilité
```

### Tester l'installation (PWA)

L'installation ne peut pas être testée avec `npm run dev` (le service worker n'y est
pas actif). Il faut servir le build de production :

```bash
npm run build
npm run preview     # sert dist/ sur http://localhost:4173
```

- **Sur ordinateur (Chrome/Edge)** : ouvrir l'URL, une icône d'installation apparaît
  dans la barre d'adresse ; cliquer dessus installe l'application dans sa propre
  fenêtre, sans onglet de navigateur.
- **Sur Android (Chrome)** : ouvrir l'URL (l'ordinateur et le téléphone doivent être
  sur le même réseau ; utiliser l'adresse IP locale de l'ordinateur plutôt que
  `localhost`, ex. `http://192.168.1.x:4173`), puis menu ⋮ → "Ajouter à l'écran
  d'accueil" / bandeau d'installation automatique.
- Une fois hébergée en HTTPS (obligatoire pour un vrai déploiement), l'installation
  fonctionne à l'identique sur les deux plateformes, sans configuration
  supplémentaire.

## Structure

```
src/
  types/models.ts          Types du domaine (Account, Transaction, BudgetCategory,
                            BudgetSubcategory, Debt, DebtPayment, User, Permissions)
  lib/
    money.ts                Arithmétique et formatage monétaire (entiers uniquement)
    errors.ts                ValidationError, NotFoundError, AuthenticationError, AccountLockedError
    id.ts                     Génération d'identifiants
    passwordHash.ts            Hachage PBKDF2 (150 000 itérations), jamais de mot de
                                passe en clair, comparaison en temps constant
    permissions.ts              Préréglages de rôle (ROLE_DEFAULT_PERMISSIONS) et libellés
    encryption.ts                 Primitives : DEK, enveloppement par mot de passe,
                                    chiffrement/déchiffrement AES-256-GCM d'un objet
    encryptionSession.ts            Détient la DEK active en mémoire uniquement (jamais
                                     persistée) — miroir de AuthContext pour les dépôts,
                                     qui ne sont pas des composants React
    loginRateLimit.ts                 Calcul pur du blocage progressif (aucun accès
                                      base de données ici — voir usersRepository.ts)
    recoveryCode.ts                    Génération et normalisation du code de récupération
  db/
    schema.ts                 Schéma Dexie (source de vérité des tables/index, versionné) ;
                                définit aussi les types "Row" (forme réellement stockée,
                                champs sensibles regroupés dans un blob chiffré `_enc`)
    encryptedRecord.ts          toStorageRow/fromStorageRow : convertit entre la forme
                                 logique (Account, Transaction, ...) et sa forme stockée,
                                 chiffrée — le seul endroit qui connaît ce découpage
    accountFlows.ts            Calcul centralisé de ce qui affecte un solde de compte
                                (transactions + dettes + remboursements) — une seule
                                formule, utilisée par le dépôt ET par le hook réactif
    accountsRepository.ts       CRUD + intégrité référentielle pour les comptes
    transactionsRepository.ts    CRUD + filtres pour les opérations
    budgetCategoriesRepository.ts  CRUD + intégrité référentielle pour les catégories
    budgetSubcategoriesRepository.ts CRUD + intégrité référentielle pour les sous-catégories
    budgetSummary.ts              Calcul prévisionnel/réel par mois (lecture pure)
    debtsRepository.ts             CRUD + référence auto-incrémentale + intégrité référentielle
    debtPaymentsRepository.ts       CRUD des remboursements
    debtSummary.ts                   Restant, statut, mensualité prévisionnelle (lecture pure)
    monthlyReport.ts                  Revenus/dépenses/solde par mois, janvier→décembre (lecture pure)
    recommendations.ts                 Analyse automatique (lecture pure, aucun stockage)
    usersRepository.ts                  CRUD utilisateurs, authentification, gestion de la DEK
    *.test.ts                     Tests des dépôts (base isolée par test)
  auth/
    AuthContext.tsx           Session (en mémoire uniquement) + hook useAuth()
  hooks/
    useAccountsWithBalances.ts    Comptes + solde calculé, réactif
    useBudgetSummary.ts            Résumé budgétaire du mois choisi, réactif
    useDebtSummaries.ts             Résumé des dettes/créances, réactif
    useMonthlyReport.ts               Rapport du mois choisi, réactif
    useRecommendations.ts              Recommandations du mois choisi, réactif
  components/
    AccountsPanel.tsx / .test.tsx
    TransactionsPanel.tsx / .test.tsx
    BudgetPanel.tsx / .test.tsx
    DebtsPanel.tsx / .test.tsx
    MonthlyReportPanel.tsx / .test.tsx
    RecommendationsPanel.tsx / .test.tsx
    LoginScreen.tsx / .test.tsx    Première connexion (création admin) et connexions suivantes
    UsersPanel.tsx / .test.tsx      Gestion des utilisateurs et de leurs privilèges
  test/
    testDatabase.ts             Base IndexedDB isolée par test (dépôts)
    testDek.ts                    Active une DEK de test (dépôts, qui ne passent jamais
                                   par usersRepository) — voir useTestEncryptionSession()
    encryptedFixture.ts             Construit une ligne chiffrée pour les tests de
                                     composants qui insèrent une donnée directement
                                     (avec un id précis) plutôt que via le dépôt
    renderAuthenticated.tsx       Rendu de composant dans une session déjà authentifiée
                                   (utilisateur + DEK actifs avant même le premier rendu)
  repositories.ts             Instances des dépôts liées à la base réelle
  App.tsx, main.tsx, App.css
```

## Principes de conception retenus

1. **Normalisation des données** : toute relation est une clé étrangère (id), jamais
   une correspondance par nom. Renommer un compte ne touche aucune autre table.
2. **Aucune valeur dérivée stockée** : le solde d'un compte n'est jamais écrit en
   base, toujours recalculé à la lecture à partir des opérations. Une seule source
   de vérité par donnée.
3. **L'argent est toujours un entier.** Aucune valeur monétaire flottante nulle part.
4. **Les dépôts ne connaissent pas l'UI.** Ils lèvent des erreurs typées ; c'est aux
   composants de décider comment les afficher (jamais de `alert()`/`confirm()` dans
   cette couche).
5. **Chaque dépôt est injectable** (`createXRepository(database)`) : les tests
   utilisent une base IndexedDB isolée par test (`fake-indexeddb`), jamais la base
   réelle ni un état partagé entre tests.
6. **Les rôles sont des préréglages, pas une liste fermée.** Un rôle initialise les
   privilèges ; chaque privilège reste ensuite modifiable individuellement.
7. **Impossible de verrouiller sa propre administration.** Le dépôt utilisateurs
   refuse toute opération (suppression, changement de rôle) qui retirerait le
   dernier utilisateur capable de gérer les utilisateurs.
8. **Le chiffrement vit dans la couche dépôt, jamais dans l'UI ni le schéma.**
   Chaque dépôt convertit vers/depuis la forme chiffrée (`toStorageRow`/
   `fromStorageRow`) ; le reste de l'application continue de manipuler les mêmes
   types (`Account`, `Transaction`, ...) qu'avant le chiffrement, inchangés.

## Prochaine étape proposée

La version hors-ligne couvre désormais tout ce qui était prévu à l'origine :
comptes, opérations, budget, dettes, rapport, recommandations, comptes
utilisateur à privilèges configurables, chiffrement au repos, limite de
tentatives et récupération de mot de passe. La suite naturelle est le
chantier de synchronisation multi-appareils décrit dans SYNC_PLAN.md — qui
devra composer avec la clé partagée décrite dans SECURITY.md plutôt qu'avec
un chiffrement par mot de passe unique.
