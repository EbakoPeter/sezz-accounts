# Audit DevSecOps — SEZZ (client)

Revue de la structure CI/CD par rapport aux pratiques DevSecOps standards. Document produit après audit ; voir aussi la version équivalente dans le dépôt serveur (`sezz-accounts-server/DEVSECOPS_AUDIT.md`), les deux projets étant des dépôts séparés avec leurs propres pipelines.

## Constat initial

Avant cet audit, **aucune configuration CI/CD n'existait** sur ce dépôt — ni `.github/workflows`, ni Dependabot. Toute vérification (lint, tests, build, audit de dépendances) se faisait manuellement, sans porte de qualité automatisée avant fusion ou déploiement.

## Trouvaille critique corrigée

**`.gitignore` n'excluait pas `.env`.** Aucun secret n'est actuellement utilisé côté client (aucune variable `VITE_*`/`import.meta.env` dans le code), donc le risque concret était nul à ce jour — mais la protection était absente si cela changeait. Corrigé par précaution.

## Ce qui a été mis en place

### `.github/workflows/ci.yml` — porte de qualité sur chaque push/PR
Lint (ESLint, zéro avertissement toléré) → format (Prettier) → typage strict (`tsc`) → suite de tests complète → build → vérification d'installabilité PWA. Échoue et bloque la fusion si une seule étape échoue.

### `.github/workflows/security.yml` — trois contrôles de sécurité dédiés
- **Audit des dépendances** (`npm audit --omit=dev --audit-level=high`) : échoue sur toute vulnérabilité haute/critique dans les dépendances de **production** uniquement — une faille dans un outil de build (ESLint, etc.) n'atteint jamais le navigateur de l'utilisateur final, donc ne doit pas bloquer le pipeline pour un risque qui ne se matérialise jamais en production.
- **Scan de secrets** (Gitleaks) : détecte toute clé, mot de passe ou jeton qui se serait glissé dans un commit.
- **CodeQL** (analyse statique native GitHub) : détecte les vulnérabilités de code (injection, désérialisation dangereuse, etc.).

Ces trois contrôles tournent aussi **chaque semaine indépendamment de tout push** — une dépendance peut devenir vulnérable du jour au lendemain sans qu'aucun code n'ait changé ici.

### `.github/dependabot.yml`
Mises à jour hebdomadaires automatisées, avec les dépendances de développement groupées en une seule PR (pour éviter dix PR séparées pour des bumps ESLint/Prettier/`@types/*`), et les dépendances de **production** laissées non groupées — un bump d'une dépendance réellement exécutée en production mérite sa propre revue individuelle.

## Vérifié concrètement, pas seulement écrit

- Les 6 fichiers YAML ont été validés syntaxiquement (`python3 -c "import yaml; yaml.safe_load(...)"`).
- `npm audit --omit=dev --audit-level=high` exécuté réellement : 0 vulnérabilité, la même commande que celle du pipeline.
- Recherche manuelle de motifs de secrets courants (clés AWS, clés privées, jetons Slack/GitHub) dans le code source : aucun trouvé.

## Ce qui reste — actions manuelles, hors de portée du code

Ces éléments sont des **paramètres du dépôt GitHub lui-même**, configurables uniquement via l'interface ou l'API GitHub par un administrateur du dépôt — aucun fichier committé ne peut les activer :

1. **Règles de protection de branche sur `main`** : exiger que les vérifications CI ci-dessus passent avant toute fusion, exiger au moins une revue de pull request, interdire le push direct sur `main`.
2. **Activer le scan de secrets natif de GitHub** (« Secret scanning » + « Push protection ») dans Settings → Security — complémentaire à Gitleaks, bloque un push contenant un secret **avant** qu'il n'entre dans l'historique, alors que Gitleaks ne fait que le détecter après coup.
3. **Authentification à deux facteurs obligatoire** pour tout compte ayant accès en écriture au dépôt (paramètre au niveau de l'organisation/du compte GitHub).
4. **Commits signés** (GPG/SSH) — à évaluer selon vos besoins ; non implémenté ici, c'est une configuration Git locale par développeur, pas quelque chose qu'un fichier de ce dépôt peut imposer à lui seul (GitHub peut en revanche l'exiger via une règle de branche, une fois activée).

Ces points sont documentés ici plutôt qu'implémentés silencieusement : je n'ai pas accès aux paramètres d'administration de votre dépôt GitHub réel pour les activer moi-même.
