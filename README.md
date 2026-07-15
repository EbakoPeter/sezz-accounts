# Livre de Comptes — réécriture normalisée

Réécriture, depuis zéro, de l'application de gestion budgétaire personnelle, avec les
standards d'ingénierie applicative : schéma de données normalisé, typage strict,
tests automatisés, lint/format appliqués, sans Excel ni Capacitor.

## État d'avancement

**Fait (Étapes 1 et 2 du plan) :**
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
- 57 tests automatisés (dépôts + composants), intégralement verts.

**Pas encore fait (suite du plan) :**
- Budget prévisionnel par catégories/sous-catégories.
- Dettes & créances, remboursements.
- Rapport mensuel, recommandations.
- Chiffrement local (le module sera reconstruit isolément et testé, comme annoncé).
- Authentification / profils.
- Portage mobile (sujet séparé, traité après consolidation du web).

## Démarrer

```bash
npm install
npm run dev        # serveur de développement
npm run build       # build de production (tsc -b && vite build)
npm run test         # suite de tests (Vitest)
npm run lint          # ESLint, zéro avertissement toléré
npm run format:check   # vérifie le formatage Prettier
npm run typecheck       # tsc --noEmit, mode strict
```

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
