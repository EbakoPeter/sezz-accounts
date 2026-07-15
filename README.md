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
- 57 tests automatisés (dépôts + composants), intégralement verts.

**Pas encore fait (suite du plan) :**

- Budget prévisionnel par catégories/sous-catégories.
- Dettes & créances, remboursements.
- Rapport mensuel, recommandations.
- Chiffrement local (le module sera reconstruit isolément et testé, comme annoncé).
- **Comptes utilisateur et synchronisation entre appareils** — nécessite un serveur
  backend distinct ; voir la proposition d'architecture partagée séparément.

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
  types/models.ts          Types du domaine (Account, Transaction, ...)
  lib/
    money.ts                Arithmétique et formatage monétaire (entiers uniquement)
    errors.ts                ValidationError, NotFoundError
    id.ts                     Génération d'identifiants
  db/
    schema.ts                 Schéma Dexie (source de vérité des tables/index)
    accountsRepository.ts       CRUD + intégrité référentielle pour les comptes
    transactionsRepository.ts    CRUD + filtres pour les opérations
    *.test.ts                     Tests des dépôts (base isolée par test)
  hooks/
    useAccountsWithBalances.ts    Comptes + solde calculé, réactif
  components/
    AccountsPanel.tsx / .test.tsx
    TransactionsPanel.tsx / .test.tsx
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

Poursuivre le même schéma pour le Budget Prévisionnel (catégories → sous-catégories,
avec `categoryId` déjà prévu sur `Transaction`), puis Dettes & Créances, en gardant
la même discipline (dépôt typé + tests d'abord, composant ensuite).
