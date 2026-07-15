# Architecture proposée : comptes utilisateur et synchronisation entre appareils

## Pourquoi ce document existe

L'application actuelle (voir README.md) est **locale uniquement** : chaque appareil a
sa propre base IndexedDB, indépendante. Avoir un compte utilisateur et une
synchronisation entre appareils exige un composant qui n'existe pas encore : **un
serveur backend**, avec sa propre base de données, qui fait autorité sur les données
d'un compte et que chaque appareil contacte pour se synchroniser.

Ce document décrit l'architecture proposée avant de l'implémenter, pour validation.

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
                  │  Base de      │
                  │  données      │
                  │  faisant      │
                  │  autorité     │
                  └───────────────┘
```

Principe retenu : **hors-ligne d'abord, synchronisé quand c'est possible.** L'app
continue de fonctionner sans connexion (elle lit/écrit toujours dans IndexedDB en
premier) ; une synchronisation en arrière-plan pousse les changements locaux vers le
serveur et récupère ceux des autres appareils dès qu'une connexion est disponible.
C'est le même principe que Google Drive/Dropbox, appliqué à nos propres données.

## Ce qui change dans le modèle de données

Chaque enregistrement synchronisable (`Account`, `Transaction`, plus tard `Debt`,
etc.) gagne deux champs :

| Champ       | Rôle                                                                                                                                                                                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updatedAt` | Déjà présent. Sert à départager qui a raison en cas de modification du même enregistrement sur deux appareils pendant qu'ils étaient hors ligne (le plus récent gagne).                                                                                                                      |
| `deletedAt` | Nouveau. Une suppression ne retire plus la ligne immédiatement : elle est marquée supprimée (« tombstone ») pour que les autres appareils apprennent qu'il faut la supprimer chez eux aussi à la prochaine synchronisation. Purgée définitivement après un délai raisonnable (ex. 90 jours). |

**Résolution de conflit retenue : dernier écrit gagne, par enregistrement.** Simple,
prévisible, suffisant pour un usage personnel/familial à quelques appareils. (Les
alternatives — CRDT, fusion à trois voies — existent mais sont nettement plus
complexes à implémenter et à tester correctement ; à envisager seulement si un besoin
concret l'exigeait.)

## API backend proposée

| Endpoint                           | Rôle                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `POST /auth/register`              | Créer un compte (email + mot de passe)                                   |
| `POST /auth/login`                 | Connexion, retourne un jeton de session                                  |
| `POST /auth/logout`                | Invalide le jeton                                                        |
| `GET /sync/pull?since=<timestamp>` | Renvoie tous les enregistrements créés/modifiés/supprimés depuis `since` |
| `POST /sync/push`                  | Envoie les changements locaux (créations/modifications/suppressions)     |

Chaque appareil retient la date de sa dernière synchronisation réussie et ne demande
que les changements plus récents — pas un renvoi complet de toutes les données à
chaque fois.

## Choix techniques proposés

- **Serveur** : Node.js + Express (ou Fastify) — cohérent avec le reste du projet
  (TypeScript partagé entre client et serveur), aucune nouvelle compétence requise.
- **Base de données** : PostgreSQL. Plus robuste que SQLite pour un serveur multi-
  utilisateurs à terme ; la plupart des hébergeurs ci-dessous en offrent une instance
  gratuite.
- **Mots de passe** : hachés avec Argon2 (recommandation actuelle), jamais stockés
  en clair, jamais consultables même par l'administrateur du serveur.
- **Authentification** : jeton de session (JWT ou jeton opaque en base), transmis en
  HTTPS uniquement.
- **Chiffrement** : à discuter séparément — une fois le serveur en place, on peut soit
  laisser le serveur voir les données en clair (plus simple, le serveur est "de
  confiance"), soit chiffrer côté client avant envoi comme le faisait l'ancienne
  version (le serveur ne stocke alors que du contenu illisible, mais la recherche/le
  filtrage côté serveur devient impossible). Recommandation : commencer sans
  chiffrement serveur pour simplifier la mise en route, l'ajouter ensuite si souhaité.

## Ce qu'il reste à décider avant de coder : l'hébergement

Le code du serveur sera écrit et testé ici, mais **il doit ensuite tourner quelque
part joignable par vos appareils** — cet environnement ne peut pas héberger un
service permanent. Options réalistes, du plus simple au plus autonome :

| Option                                | Coût                                                 | Effort de mise en route                                         | Autonomie             |
| ------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- | --------------------- |
| Railway / Render (offre gratuite)     | Gratuit pour un usage personnel                      | Faible — connecter un dépôt Git, quelques clics                 | Dépend du fournisseur |
| Fly.io (offre gratuite)               | Gratuit pour un usage personnel                      | Modéré — passe par leur CLI                                     | Dépend du fournisseur |
| Serveur personnel (VPS, Raspberry Pi) | Variable (VPS ~3-5 $/mois, ou matériel déjà possédé) | Plus élevé — gestion Linux, HTTPS (Let's Encrypt), mises à jour | Totale                |

Je recommande **Railway ou Render** pour démarrer : gratuit, rapide à mettre en
route, largement suffisant pour un usage personnel/familial, et une migration vers
un serveur personnel reste possible plus tard sans réécrire le code (Node.js standard
partout).

## Prochaine étape

En attente de validation de cette approche (et du choix d'hébergement) avant de
commencer l'implémentation du serveur — pour éviter d'écrire du code autour d'une
hypothèse de déploiement qui ne conviendrait pas.
