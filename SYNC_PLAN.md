# Synchronisation entre appareils — état de l'implémentation

## Statut : implémenté, en attente de déploiement du serveur

Ce document décrivait à l'origine une proposition d'architecture, avant tout code.
Le serveur et le moteur de synchronisation client existent maintenant et sont
testés — voir `sezz-accounts-server/README.md` pour le serveur, et
`src/sync/` (client) pour la partie qui vient d'être intégrée à l'application.
Ce qui suit décrit l'architecture **telle que construite**, avec les quelques
écarts par rapport à la proposition initiale, assumés et expliqués.

## Vue d'ensemble

```
┌─────────────────┐         ┌─────────────────┐
│  Navigateur PC   │         │  Téléphone       │
│  (PWA installée) │         │  (PWA installée) │
│                  │         │                  │
│  IndexedDB (cache│         │  IndexedDB (cache│
│  local, hors     │         │  local, hors     │
│  connexion)      │         │  connexion)      │
└────────┬─────────┘         └────────┬─────────┘
         │        HTTPS               │        HTTPS
         │        (push/pull)         │        (push/pull)
         └──────────────┬──────────────┘
                         │
                  ┌──────▼───────┐
                  │   Serveur     │
                  │   backend     │
                  │  (à héberger) │
                  │               │
                  │  Ne voit que  │
                  │  du chiffré   │
                  └───────────────┘
```

Principe retenu, inchangé par rapport à la proposition : **hors-ligne d'abord,
synchronisé quand c'est possible.** L'app continue de fonctionner sans connexion ;
un bouton « Synchroniser maintenant » (onglet Synchronisation) pousse les
changements locaux vers le serveur et récupère ceux des autres appareils.
La synchronisation automatique en arrière-plan n'est pas encore construite —
voir « Ce qui reste » plus bas.

## Écart n°1 : le chiffrement n'a pas été différé

La proposition initiale suggérait de commencer sans chiffrement côté serveur
pour simplifier, quitte à l'ajouter plus tard. Entre-temps, le chiffrement au
repos a été construit côté client (voir SECURITY.md) — une clé de chiffrement
partagée (DEK), enveloppée individuellement par mot de passe pour chaque
utilisateur local. Une fois cette fondation en place, différer le chiffrement
du serveur aurait été un pas en arrière plutôt qu'une simplification : autant
préserver dès le départ la propriété « le serveur ne peut jamais lire les
données », plutôt que de la retirer puis la réintroduire plus tard.

Concrètement : chaque enregistrement synchronisé garde ses champs structurels
en clair (identifiants, dates, clés étrangères — nécessaires pour filtrer/trier
côté serveur) et son contenu sensible dans le même blob chiffré `_enc` que le
client utilise déjà localement. Le serveur stocke et relaie ce blob sans jamais
le déchiffrer.

## Écart n°2 : suppressions — un journal plutôt qu'un champ sur chaque table

La proposition suggérait d'ajouter un champ `deletedAt` à chaque enregistrement
et de filtrer les lignes supprimées partout où elles sont lues. En pratique,
cela aurait demandé de modifier chaque méthode `list()`/`getById()` de chaque
dépôt (6+ dépôts), plus chaque module de calcul qui lit les tables directement
(`accountFlows`, `budgetSummary`, `debtSummary`, `monthlyReport`,
`recommendations`) — beaucoup de code touché pour une propriété dont seul le
moteur de synchronisation a besoin.

À la place : un journal de suppressions séparé (`deletionLog`, voir
`src/db/schema.ts`). Chaque suppression reste une suppression réelle localement
(comportement inchangé, zéro risque de régression sur le calcul des soldes/
budgets) ; le dépôt inscrit en plus une ligne dans ce journal, que le moteur de
synchronisation transforme en tombstone lors de l'envoi, avant de purger
l'entrée. Même résultat pour la synchronisation, empreinte de code bien plus
petite.

## Écart n°3 : bcrypt plutôt qu'Argon2

Choix pragmatique : bcrypt (via `bcryptjs`, en JavaScript pur) évite toute
dépendance à des binaires natifs compilés, ce qui simplifie le déploiement sur
n'importe quel hébergeur Node standard. Argon2 reste un choix valide et plus
moderne ; à reconsidérer si le déploiement choisi le permet facilement.

## Ce qui correspond exactement à la proposition initiale

- **Résolution de conflit : dernier écrit gagne, par enregistrement**, comparé
  par `updatedAt` — appliqué à la fois côté serveur (`ON CONFLICT ... WHERE`)
  et côté client (un pull n'écrase jamais un enregistrement local plus récent
  pas encore poussé).
- **API** : `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`,
  `GET /sync/pull?since=<timestamp>`, `POST /sync/push` — exactement comme
  prévu.
- **Serveur** : Node.js + TypeScript + Express, PostgreSQL.
- **Chaque appareil retient sa dernière synchronisation réussie** (curseurs
  `lastPushedAt`/`lastPulledAt`, stockés dans `syncConfig`) et ne redemande
  que les changements plus récents.

## Deux couches d'authentification — à ne pas confondre

Voir `sezz-accounts-server/README.md` pour l'explication complète, mais en
résumé : se connecter à un **compte de synchronisation** (e-mail + mot de
passe, propre au serveur) ne déchiffre jamais rien. Cela prouve seulement
qu'un appareil a le droit d'échanger les données chiffrées d'un foyer. Seul un
mot de passe d'**utilisateur local** (déjà existant : admin/standard/lecteur)
déverrouille la clé de chiffrement partagée, entièrement côté client.

## Ce qui reste

- **Synchronisation automatique en arrière-plan.** Actuellement manuelle
  (bouton « Synchroniser maintenant », onglet Synchronisation) — un
  déclenchement automatique (au démarrage, périodiquement, ou sur détection de
  reconnexion réseau) serait la prochaine amélioration naturelle.
- **Hébergement du serveur.** Le code est prêt et testé contre une vraie base
  PostgreSQL, mais ne tourne encore nulle part d'accessible par vos appareils.
  Voir `sezz-accounts-server/README.md` pour les options d'hébergement
  (Render/Railway + une base Postgres gérée comme Neon).
- **Limite de tentatives sur le compte de synchronisation.** Existe déjà pour
  les utilisateurs locaux (`loginRateLimit.ts`) ; pas encore pour
  `/auth/login` côté serveur — noté comme limite connue dans le README du
  serveur.
- **Récupération d'un compte de synchronisation oublié.** Aucun mécanisme
  pour l'instant (contrairement au code de récupération des utilisateurs
  locaux).
