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
- 139 tests automatisés (dépôts + composants), intégralement verts.

**Pas encore fait (suite du plan) :**

- Rapport mensuel, recommandations.
- Chiffrement local (le module sera reconstruit isolément et testé, comme annoncé).
- **Comptes utilisateur et synchronisation entre appareils** — nécessite un serveur
  backend distinct ; voir SYNC_PLAN.md. Reporté après la version hors-ligne.

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
                            BudgetSubcategory, Debt, DebtPayment)
  lib/
    money.ts                Arithmétique et formatage monétaire (entiers uniquement)
    errors.ts                ValidationError, NotFoundError
    id.ts                     Génération d'identifiants
  db/
    schema.ts                 Schéma Dexie (source de vérité des tables/index, versionné)
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
    *.test.ts                     Tests des dépôts (base isolée par test)
  hooks/
    useAccountsWithBalances.ts    Comptes + solde calculé, réactif
    useBudgetSummary.ts            Résumé budgétaire du mois choisi, réactif
    useDebtSummaries.ts             Résumé des dettes/créances, réactif
  components/
    AccountsPanel.tsx / .test.tsx
    TransactionsPanel.tsx / .test.tsx
    BudgetPanel.tsx / .test.tsx
    DebtsPanel.tsx / .test.tsx
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

## Prochaine étape proposée

Rapport Mensuel (revenus/dépenses par mois, triés chronologiquement, avec un
graphique) puis Recommandations (analyse automatique fondée sur les données déjà
présentes — taux d'épargne, dépassements de budget, retards de remboursement),
en gardant la même discipline (dépôt/calcul typé + tests d'abord, composant
ensuite).
