# Bot de logs Discord

Ce bot écoute les événements du serveur principal et les envoie dans une catégorie privée du serveur de logs externe. Les messages et réponses des commandes sont envoyés en Components V2 avec un accent gris uniforme.

## Configuration

1. Crée un bot dans le [portail développeur Discord](https://discord.com/developers/applications).
2. Active les intents privilégiés **Server Members Intent** et **Message Content Intent** dans la section *Bot*.
3. Invite ce bot sur les deux serveurs : le serveur principal et le serveur externe.
4. Copie `.env.example` vers `.env`, puis renseigne le token et l'identifiant du serveur externe (`LOG_GUILD_ID`). L'identifiant source (`SOURCE_GUILD_ID`) est facultatif : tu peux le définir avec `/logs setup`.
5. Dans le serveur externe, le bot doit avoir les permissions **Gérer les salons** et **Gérer les rôles** pour créer les salons privés, ainsi que **Voir les salons**, **Envoyer des messages** et **Intégrer des liens**. Il crée la catégorie `📁・logs` et ses salons au démarrage.
6. Dans le serveur principal, donne-lui accès aux salons à surveiller et la permission **Voir les logs d'audit** pour enregistrer l'auteur et le motif de certaines actions de modération. Les journaux du serveur externe sont privés par défaut : ajoute manuellement les rôles qui doivent pouvoir les consulter.

```powershell
cd logs
npm install
npm start
```

Sur le serveur externe, un administrateur peut gérer le bot avec :

- `/logs setup serveur_id:<ID>` : choisir le serveur principal (le bot doit y être invité).
- `/logs status` : voir le serveur source et l'état du relais.
- `/logs disable` et `/logs enable` : arrêter ou reprendre l'envoi des logs.

Les commandes sont enregistrées automatiquement au démarrage du bot. La configuration choisie est conservée dans `config.json`.

Le bot crée ou réutilise les salons `📁・message-delete`, `📁・message-update`, `📁・embed-delete`, `📁・membres`, `📁・salons`, `📁・roles`, `📁・voice-join`, `📁・voice-leave`, `📁・voice-move`, `📁・voice-mute`, `📁・stream-cam`, `📁・moderation`, `📁・boosts`, `📁・invitations`, `📁・emojis-stickers`, `📁・automod`, `📁・integrations`, `📁・events`, `📁・reactions`, `📁・sondages` et `📁・serveur`.

Les logs incluent aussi les votes de sondages, les inscriptions aux événements, les sons Soundboard, les changements de permissions de salons, les intégrations/webhooks, les actions de modération, les demandes de parole en vocal, les paramètres avancés des rôles/salons et davantage de changements du serveur. Les événements d'audit nécessitent **Voir les logs d'audit** sur le serveur principal. Les intents AutoMod peuvent également nécessiter une activation dans le portail développeur Discord.
