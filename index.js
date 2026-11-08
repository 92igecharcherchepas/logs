require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });

const fs = require('node:fs');
const path = require('node:path');
const {
  ChannelType,
  Client,
  AuditLogEvent,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionsBitField,
  ContainerBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const LOG_GUILD_ID = process.env.LOG_GUILD_ID;
const COMPONENT_COLOR = 0x808080;
const SETTINGS_PATH = path.join(__dirname, 'config.json');
const settings = fs.existsSync(SETTINGS_PATH)
  ? JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
  : { sourceGuildId: process.env.SOURCE_GUILD_ID || null, enabled: true };
const CATEGORY_NAME = '📁・logs';
const LOG_COMMANDS = [
  new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Configurer le bot de logs')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand.setName('status').setDescription('Voir la configuration des logs'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('setup')
        .setDescription('Choisir le serveur principal à surveiller')
        .addStringOption((option) =>
          option
            .setName('serveur_id')
            .setDescription('Identifiant du serveur principal')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('enable').setDescription('Activer le relais de logs'),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('disable').setDescription('Désactiver le relais de logs'),
    )
    .toJSON(),
];
const LOG_CHANNELS = [
  '📁・message-delete',
  '📁・message-update',
  '📁・embed-delete',
  '📁・membres',
  '📁・salons',
  '📁・roles',
  '📁・voice-join',
  '📁・voice-leave',
  '📁・voice-move',
  '📁・voice-mute',
  '📁・stream-cam',
  '📁・moderation',
  '📁・boosts',
  '📁・invitations',
  '📁・emojis-stickers',
  '📁・automod',
  '📁・integrations',
  '📁・events',
  '📁・reactions',
  '📁・sondages',
  '📁・serveur',
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessagePolls,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

const logChannels = new Map();
const noMentions = { parse: [], users: [], roles: [] };
const timestamp = (date = new Date()) => `<t:${Math.floor(date.getTime() / 1000)}:F>`;
const clipped = (value, max = 1400) => {
  const text = String(value ?? '').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};
const userLabel = (user) => user ? `<@${user.id}> (${user.tag || user.username}) · \`${user.id}\`` : 'Inconnu';
const channelLabel = (channel) => channel ? `<#${channel.id}> (\`${channel.id}\`)` : 'Inconnu';

async function setupLogChannels(guild) {
  await guild.channels.fetch();
  let category = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === CATEGORY_NAME,
  );

  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: client.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.EmbedLinks,
          ],
        },
      ],
    });
  } else {
    await category.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false,
    });
    await category.permissionOverwrites.edit(client.user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      EmbedLinks: true,
    });
  }

  for (const name of LOG_CHANNELS) {
    let channel = guild.channels.cache.find(
      (item) => item.type === ChannelType.GuildText && item.parentId === category.id && item.name === name,
    );
    if (!channel) {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: category.id,
      });
    }

    await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
    await channel.permissionOverwrites.edit(client.user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      EmbedLinks: true,
    });
    logChannels.set(name.replace(/^📁・/, ''), channel);
  }
}

async function sendLog(channelName, title, lines) {
  const channel = logChannels.get(channelName);
  if (!channel) {
    console.error(`[logs] Salon "${channelName}" introuvable; événement non envoyé.`);
    return;
  }

  const body = [`## ${title}`, ...lines].join('\n').slice(0, 3900);
  const container = new ContainerBuilder()
    .setAccentColor(COMPONENT_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

  try {
    await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      allowedMentions: noMentions,
    });
  } catch (error) {
    console.error(`[logs] Échec d'envoi dans #${channelName}:`, error);
  }
}

function isSourceGuild(guild) {
  return Boolean(settings.enabled && settings.sourceGuildId && guild && guild.id === settings.sourceGuildId);
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

async function replyToCommand(interaction, text) {
  const container = new ContainerBuilder()
    .setAccentColor(COMPONENT_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  const payload = {
    components: [container],
    allowedMentions: noMentions,
  };
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply({
    ...payload,
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'logs') return;

  if (interaction.guildId !== LOG_GUILD_ID) {
    await replyToCommand(interaction, ' Utilise cette commande sur le serveur de logs.', 0xed4245);
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await replyToCommand(interaction, ' Cette commande est réservée aux administrateurs.', 0xed4245);
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'status') {
    const source = settings.sourceGuildId
      ? `Serveur surveillé : \`${settings.sourceGuildId}\``
      : 'Aucun serveur principal configuré. Lance `/logs setup`.';
    await replyToCommand(
      interaction,
      `## 📋 Configuration des logs\n${source}\nÉtat : **${settings.enabled ? 'activés' : 'désactivés'}**`,
    );
    return;
  }

  if (subcommand === 'setup') {
    await interaction.deferReply({
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    const sourceGuildId = interaction.options.getString('serveur_id', true).trim();
    if (!/^\d{17,20}$/.test(sourceGuildId)) {
      await replyToCommand(interaction, ' Identifiant de serveur invalide.', 0xed4245);
      return;
    }
    if (sourceGuildId === LOG_GUILD_ID) {
      await replyToCommand(interaction, ' Le serveur principal doit être différent du serveur de logs.', 0xed4245);
      return;
    }

    let sourceGuild;
    try {
      sourceGuild = await client.guilds.fetch(sourceGuildId);
    } catch (error) {
      console.error('[logs] Impossible de vérifier le serveur source demandé:', error);
      await replyToCommand(
        interaction,
        " Serveur introuvable. Vérifie l'identifiant et que le bot a été invité sur ce serveur.",
        0xed4245,
      );
      return;
    }

    const previousSettings = {
      sourceGuildId: settings.sourceGuildId,
      enabled: settings.enabled,
    };
    settings.sourceGuildId = sourceGuild.id;
    settings.enabled = true;
    try {
      saveSettings();
    } catch (error) {
      Object.assign(settings, previousSettings);
      console.error('[logs] Impossible de sauvegarder la configuration:', error);
      await replyToCommand(interaction, '❌ Impossible de sauvegarder la configuration sur le disque.', 0xed4245);
      return;
    }
    await replyToCommand(interaction, `✅ Logs activés pour le serveur **${sourceGuild.name}** (\`${sourceGuild.id}\`).`, 0x57f287);
    return;
  }

  if (subcommand === 'enable') {
    if (!settings.sourceGuildId) {
      await replyToCommand(interaction, '❌ Configure d’abord un serveur principal avec `/logs setup`.', 0xed4245);
      return;
    }
    const previousEnabled = settings.enabled;
    settings.enabled = true;
    try {
      saveSettings();
    } catch (error) {
      settings.enabled = previousEnabled;
      console.error('[logs] Impossible de sauvegarder la configuration:', error);
      await replyToCommand(interaction, '❌ Impossible de sauvegarder la configuration sur le disque.', 0xed4245);
      return;
    }
    await replyToCommand(interaction, '✅ Relais de logs activé.', 0x57f287);
    return;
  }

  if (subcommand === 'disable') {
    const previousEnabled = settings.enabled;
    settings.enabled = false;
    try {
      saveSettings();
    } catch (error) {
      settings.enabled = previousEnabled;
      console.error('[logs] Impossible de sauvegarder la configuration:', error);
      await replyToCommand(interaction, '❌ Impossible de sauvegarder la configuration sur le disque.', 0xed4245);
      return;
    }
    await replyToCommand(interaction, '⏸️ Relais de logs désactivé.', 0xfee75c);
  }
});

function contentLines(message) {
  const content = clipped(message.content || '[Contenu indisponible ou vide]');
  const attachments = [...message.attachments.values()]
    .map((attachment) => `- [${clipped(attachment.name || 'fichier', 150)}](${attachment.url})`)
    .join('\n');
  return [
    `> ${content.replace(/\n/g, '\n> ')}`,
    ...(attachments ? [`**Fichiers :**\n${attachments}`] : []),
  ];
}

function embedSummary(embeds = []) {
  return embeds.map((embed, index) => {
    const data = embed.toJSON();
    return `${index + 1}. ${clipped(data.title || data.author?.name || data.url || 'Embed', 180)}`
      + (data.description ? ` — ${clipped(data.description, 250)}` : '');
  }).join('\n') || 'Aucun détail disponible.';
}

client.on(Events.MessageDelete, async (message) => {
  if (!isSourceGuild(message.guild)) return;
  await sendLog('message-delete', '💬 Message supprimé', [
    `👤 **Auteur :** ${userLabel(message.author)}`,
    `#️⃣ **Salon :** ${channelLabel(message.channel)}`,
    `🆔 **Identifiant :** \`${message.id}\``,
    `🕒 **Supprimé :** ${timestamp()}`,
    `💬 **Contenu :**`,
    ...contentLines(message),
  ], 0xed4245);
});

client.on(Events.MessageBulkDelete, async (messages, channel) => {
  if (!isSourceGuild(channel.guild)) return;
  await sendLog('message-delete', '🗑️ Messages supprimés en masse', [
    `#️⃣ **Salon :** ${channelLabel(channel)}`,
    `📦 **Nombre :** ${messages.size}`,
    `🆔 **Identifiants :** ${[...messages.keys()].slice(0, 25).map((id) => `\`${id}\``).join(', ') || 'Indisponibles'}`,
  ], 0xed4245);
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!isSourceGuild(newMessage.guild)) return;
  const oldEmbeds = oldMessage.embeds || [];
  const newEmbeds = newMessage.embeds || [];
  const embedsRemoved = oldEmbeds.length > newEmbeds.length;
  const channelName = embedsRemoved ? 'embed-delete' : 'message-update';
  const title = embedsRemoved ? '🧩 Embed supprimé ou modifié' : '✏️ Message modifié';

  await sendLog(channelName, title, [
    `👤 **Auteur :** ${userLabel(newMessage.author)}`,
    `#️⃣ **Salon :** ${channelLabel(newMessage.channel)}`,
    `🆔 **Identifiant :** \`${newMessage.id}\``,
    `🕒 **Modifié :** ${timestamp()}`,
    `**Avant :**`,
    ...contentLines(oldMessage),
    `**Après :**`,
    ...contentLines(newMessage),
    ...(embedsRemoved ? [`**Embeds avant :**\n${embedSummary(oldEmbeds)}`] : []),
  ], 0xfee75c);
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (!isSourceGuild(member.guild)) return;
  await sendLog('membres', '👋 Nouveau membre', [
    `👤 **Membre :** ${userLabel(member.user)}`,
    `📅 **Compte créé :** ${timestamp(member.user.createdAt)}`,
    `🕒 **A rejoint :** ${timestamp(member.joinedAt || new Date())}`,
  ], 0x57f287);
});

client.on(Events.GuildMemberRemove, async (member) => {
  if (!isSourceGuild(member.guild)) return;
  await sendLog('membres', '🚪 Membre parti', [
    `👤 **Membre :** ${userLabel(member.user)}`,
    `🕒 **Parti :** ${timestamp()}`,
  ], 0xed4245);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (!isSourceGuild(newMember.guild)) return;
  const changes = [];
  if (oldMember.nickname !== newMember.nickname) {
    changes.push(`**Pseudo :** ${oldMember.nickname || oldMember.user.username} → ${newMember.nickname || newMember.user.username}`);
  }

  const addedRoles = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
  const removedRoles = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));
  if (addedRoles.size) changes.push(`**Rôles ajoutés :** ${addedRoles.map((role) => role.name).join(', ')}`);
  if (removedRoles.size) changes.push(`**Rôles retirés :** ${removedRoles.map((role) => role.name).join(', ')}`);
  if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
    changes.push(`**Timeout :** ${newMember.communicationDisabledUntil ? timestamp(newMember.communicationDisabledUntil) : 'retiré'}`);
  }
  if (oldMember.avatar !== newMember.avatar) changes.push('**Avatar du serveur modifié**');
  if (oldMember.pending !== newMember.pending) {
    changes.push(`**Vérification en attente :** ${newMember.pending ? 'oui' : 'non'}`);
  }

  if (oldMember.premiumSinceTimestamp !== newMember.premiumSinceTimestamp) {
    await sendLog('boosts', newMember.premiumSince ? '🚀 Boost ajouté' : '🚀 Boost retiré', [
      `👤 **Membre :** ${userLabel(newMember.user)}`,
      `🕒 **Date :** ${timestamp()}`,
    ], 0xf47fff);
  }
  if (changes.length) {
    await sendLog('membres', '📝 Profil membre modifié', [
      `👤 **Membre :** ${userLabel(newMember.user)}`,
      ...changes,
      `🕒 **Date :** ${timestamp()}`,
    ]);
  }
});

client.on(Events.ChannelCreate, async (channel) => {
  if (!isSourceGuild(channel.guild)) return;
  await sendLog('salons', '➕ Salon créé', [
    `#️⃣ **Salon :** ${channelLabel(channel)}`,
    `📂 **Type :** ${ChannelType[channel.type] || channel.type}`,
    `🕒 **Date :** ${timestamp()}`,
  ], 0x57f287);
});

client.on(Events.ChannelDelete, async (channel) => {
  if (!isSourceGuild(channel.guild)) return;
  await sendLog('salons', '➖ Salon supprimé', [
    `#️⃣ **Nom :** ${channel.name || 'Inconnu'}`,
    `🆔 **Identifiant :** \`${channel.id}\``,
    `🕒 **Date :** ${timestamp()}`,
  ], 0xed4245);
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!isSourceGuild(newChannel.guild)) return;
  const changes = [];
  if (oldChannel.name !== newChannel.name) changes.push(`**Nom :** ${oldChannel.name} → ${newChannel.name}`);
  if (oldChannel.topic !== newChannel.topic) changes.push(`**Sujet :** ${oldChannel.topic || 'aucun'} → ${newChannel.topic || 'aucun'}`);
  if (oldChannel.parentId !== newChannel.parentId) {
    changes.push(`**Catégorie :** ${oldChannel.parent?.name || 'aucune'} → ${newChannel.parent?.name || 'aucune'}`);
  }
  if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
    changes.push(`**Mode lent :** ${oldChannel.rateLimitPerUser || 0}s → ${newChannel.rateLimitPerUser || 0}s`);
  }
  if (oldChannel.nsfw !== newChannel.nsfw) {
    changes.push(`**Contenu sensible :** ${newChannel.nsfw ? 'activé' : 'désactivé'}`);
  }
  if (oldChannel.bitrate !== newChannel.bitrate) {
    changes.push(`**Débit vocal :** ${oldChannel.bitrate || 'inconnu'} → ${newChannel.bitrate || 'inconnu'}`);
  }
  if (oldChannel.userLimit !== newChannel.userLimit) {
    changes.push(`**Limite de membres :** ${oldChannel.userLimit || 'illimitée'} → ${newChannel.userLimit || 'illimitée'}`);
  }
  if (oldChannel.rtcRegion !== newChannel.rtcRegion) {
    changes.push(`**Région vocale :** ${oldChannel.rtcRegion || 'automatique'} → ${newChannel.rtcRegion || 'automatique'}`);
  }
  if (!changes.length) return;
  await sendLog('salons', '⚙️ Salon modifié', [
    `#️⃣ **Salon :** ${channelLabel(newChannel)}`,
    ...changes,
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

client.on(Events.ThreadCreate, async (thread) => {
  if (!isSourceGuild(thread.guild)) return;
  await sendLog('salons', '🧵 Fil créé', [
    `**Fil :** ${thread.name} (\`${thread.id}\`)`,
    `**Salon parent :** ${channelLabel(thread.parent)}`,
    `🕒 **Date :** ${timestamp()}`,
  ], 0x57f287);
});

client.on(Events.ThreadDelete, async (thread) => {
  if (!isSourceGuild(thread.guild)) return;
  await sendLog('salons', '🧵 Fil supprimé', [
    `**Fil :** ${thread.name} (\`${thread.id}\`)`,
    `🕒 **Date :** ${timestamp()}`,
  ], 0xed4245);
});

client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
  if (!isSourceGuild(newThread.guild)) return;
  const changes = [];
  if (oldThread.name !== newThread.name) changes.push(`**Nom :** ${oldThread.name} → ${newThread.name}`);
  if (oldThread.archived !== newThread.archived) changes.push(`**Archivé :** ${newThread.archived ? 'oui' : 'non'}`);
  if (oldThread.locked !== newThread.locked) changes.push(`**Verrouillé :** ${newThread.locked ? 'oui' : 'non'}`);
  if (oldThread.rateLimitPerUser !== newThread.rateLimitPerUser) {
    changes.push(`**Mode lent :** ${oldThread.rateLimitPerUser || 0}s → ${newThread.rateLimitPerUser || 0}s`);
  }
  if (!changes.length) return;
  await sendLog('salons', '🧵 Fil modifié', [
    `**Fil :** ${newThread.name} (\`${newThread.id}\`)`,
    ...changes,
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

client.on(Events.ThreadMembersUpdate, async (addedMembers, removedMembers, thread) => {
  if (!isSourceGuild(thread.guild)) return;
  const changes = [];
  if (addedMembers.size) {
    changes.push(`**Ajoutés :** ${[...addedMembers.values()].map((member) => userLabel(member.user)).join(', ')}`);
  }
  if (removedMembers.size) {
    changes.push(`**Retirés :** ${[...removedMembers.values()].map((member) => userLabel(member.user)).join(', ')}`);
  }
  if (!changes.length) return;
  await sendLog('salons', '🧵 Membres du fil modifiés', [
    `**Fil :** ${thread.name} (\`${thread.id}\`)`,
    ...changes,
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

client.on(Events.GuildRoleCreate, async (role) => {
  if (!isSourceGuild(role.guild)) return;
  await sendLog('roles', '➕ Rôle créé', [
    `**Rôle :** ${role} (\`${role.id}\`)`,
    `🕒 **Date :** ${timestamp()}`,
  ], 0x57f287);
});

client.on(Events.GuildRoleDelete, async (role) => {
  if (!isSourceGuild(role.guild)) return;
  await sendLog('roles', '➖ Rôle supprimé', [
    `**Nom :** ${role.name} (\`${role.id}\`)`,
    `🕒 **Date :** ${timestamp()}`,
  ], 0xed4245);
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  if (!isSourceGuild(newRole.guild)) return;
  const changes = [];
  if (oldRole.name !== newRole.name) changes.push(`**Nom :** ${oldRole.name} → ${newRole.name}`);
  if (oldRole.hexColor !== newRole.hexColor) changes.push(`**Couleur :** ${oldRole.hexColor} → ${newRole.hexColor}`);
  if (oldRole.hoist !== newRole.hoist) changes.push(`**Affiché séparément :** ${newRole.hoist ? 'oui' : 'non'}`);
  if (oldRole.mentionable !== newRole.mentionable) changes.push(`**Mentionnable :** ${newRole.mentionable ? 'oui' : 'non'}`);
  const oldPermissions = new PermissionsBitField(oldRole.permissions.bitfield);
  const newPermissions = new PermissionsBitField(newRole.permissions.bitfield);
  const addedPermissions = newPermissions.toArray().filter((permission) => !oldPermissions.has(permission));
  const removedPermissions = oldPermissions.toArray().filter((permission) => !newPermissions.has(permission));
  if (addedPermissions.length) changes.push(`**Permissions ajoutées :** ${addedPermissions.join(', ')}`);
  if (removedPermissions.length) changes.push(`**Permissions retirées :** ${removedPermissions.join(', ')}`);
  if (!changes.length) return;
  await sendLog('roles', '⚙️ Rôle modifié', [
    `**Rôle :** ${newRole} (\`${newRole.id}\`)`,
    ...changes,
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild;
  if (!isSourceGuild(guild)) return;
  const member = newState.member || oldState.member;
  const who = userLabel(member?.user);

  if (!oldState.channelId && newState.channelId) {
    await sendLog('voice-join', '🔊 Connexion vocale', [
      `👤 **Membre :** ${who}`,
      `🎙️ **Salon :** ${channelLabel(newState.channel)}`,
      `🕒 **Date :** ${timestamp()}`,
    ], 0x57f287);
  } else if (oldState.channelId && !newState.channelId) {
    await sendLog('voice-leave', '🔇 Déconnexion vocale', [
      `👤 **Membre :** ${who}`,
      `🎙️ **Salon :** ${channelLabel(oldState.channel)}`,
      `🕒 **Date :** ${timestamp()}`,
    ], 0xed4245);
  } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    await sendLog('voice-move', '🔀 Déplacement vocal', [
      `👤 **Membre :** ${who}`,
      `**De :** ${channelLabel(oldState.channel)}`,
      `**Vers :** ${channelLabel(newState.channel)}`,
      `🕒 **Date :** ${timestamp()}`,
    ]);
  }

  const muteChanges = [];
  for (const [property, label] of [
    ['serverMute', 'Mute serveur'],
    ['selfMute', 'Mute personnel'],
    ['serverDeaf', 'Sourdine serveur'],
    ['selfDeaf', 'Sourdine personnelle'],
  ]) {
    if (oldState[property] !== newState[property]) {
      muteChanges.push(`**${label} :** ${newState[property] ? 'activée' : 'désactivée'}`);
    }
  }
  if (muteChanges.length) {
    await sendLog('voice-mute', '🎙️ État micro / casque modifié', [
      `👤 **Membre :** ${who}`,
      ...muteChanges,
      `🕒 **Date :** ${timestamp()}`,
    ]);
  }

  const mediaChanges = [];
  if (oldState.selfVideo !== newState.selfVideo) mediaChanges.push(`**Caméra :** ${newState.selfVideo ? 'activée' : 'désactivée'}`);
  if (oldState.streaming !== newState.streaming) mediaChanges.push(`**Stream :** ${newState.streaming ? 'démarré' : 'arrêté'}`);
  if (mediaChanges.length) {
    await sendLog('stream-cam', '📹 Caméra / stream modifié', [
      `👤 **Membre :** ${who}`,
      `🎙️ **Salon :** ${channelLabel(newState.channel || oldState.channel)}`,
      ...mediaChanges,
      `🕒 **Date :** ${timestamp()}`,
    ]);
  }

  if (oldState.suppress !== newState.suppress) {
    await sendLog('voice-mute', newState.suppress ? '🎤 Membre passé en auditeur' : '🎤 Membre autorisé à parler', [
      `👤 **Membre :** ${who}`,
      `🎙️ **Salon :** ${channelLabel(newState.channel || oldState.channel)}`,
      `🕒 **Date :** ${timestamp()}`,
    ]);
  }
  if (oldState.requestToSpeakTimestamp !== newState.requestToSpeakTimestamp) {
    await sendLog('voice-mute', newState.requestToSpeakTimestamp ? '✋ Demande de parole' : '✋ Demande de parole retirée', [
      `👤 **Membre :** ${who}`,
      `🎙️ **Salon :** ${channelLabel(newState.channel || oldState.channel)}`,
      ...(newState.requestToSpeakTimestamp
        ? [`🕒 **Demande :** ${timestamp(new Date(newState.requestToSpeakTimestamp))}`]
        : []),
    ]);
  }
});

client.on(Events.GuildBanAdd, async (ban) => {
  if (!isSourceGuild(ban.guild)) return;
  await sendLog('moderation', '🔨 Membre banni', [
    `👤 **Membre :** ${userLabel(ban.user)}`,
    `📝 **Raison :** ${clipped(ban.reason || 'Aucune raison fournie')}`,
    `🕒 **Date :** ${timestamp()}`,
  ], 0xed4245);
});

client.on(Events.GuildBanRemove, async (ban) => {
  if (!isSourceGuild(ban.guild)) return;
  await sendLog('moderation', '♻️ Bannissement retiré', [
    `👤 **Membre :** ${userLabel(ban.user)}`,
    `🕒 **Date :** ${timestamp()}`,
  ], 0x57f287);
});

const auditActions = new Map([
  [AuditLogEvent.MemberKick, ['moderation', '👢 Expulsion']],
  [AuditLogEvent.MemberPrune, ['moderation', '🧹 Exclusion de membres inactifs']],
  [AuditLogEvent.MemberUpdate, ['moderation', '🛡️ Membre modéré']],
  [AuditLogEvent.MemberRoleUpdate, ['moderation', '🛡️ Rôles d’un membre modifiés']],
  [AuditLogEvent.MemberMove, ['voice-move', '🔀 Membre déplacé par un modérateur']],
  [AuditLogEvent.MemberDisconnect, ['voice-leave', '🔇 Membre déconnecté par un modérateur']],
  [AuditLogEvent.BotAdd, ['membres', '🤖 Bot ajouté au serveur']],
  [AuditLogEvent.MessageDelete, ['message-delete', '🛡️ Message supprimé par un modérateur']],
  [AuditLogEvent.MessageBulkDelete, ['message-delete', '🛡️ Suppression groupée par un modérateur']],
  [AuditLogEvent.InviteUpdate, ['invitations', '🔗 Invitation modifiée']],
  [AuditLogEvent.ChannelOverwriteCreate, ['salons', '🔐 Permission de salon ajoutée']],
  [AuditLogEvent.ChannelOverwriteUpdate, ['salons', '🔐 Permission de salon modifiée']],
  [AuditLogEvent.ChannelOverwriteDelete, ['salons', '🔐 Permission de salon retirée']],
  [AuditLogEvent.WebhookCreate, ['integrations', '🪝 Webhook créé']],
  [AuditLogEvent.WebhookUpdate, ['integrations', '🪝 Webhook modifié']],
  [AuditLogEvent.WebhookDelete, ['integrations', '🪝 Webhook supprimé']],
  [AuditLogEvent.IntegrationCreate, ['integrations', '🔌 Intégration ajoutée']],
  [AuditLogEvent.IntegrationUpdate, ['integrations', '🔌 Intégration modifiée']],
  [AuditLogEvent.IntegrationDelete, ['integrations', '🔌 Intégration supprimée']],
  [AuditLogEvent.MessagePin, ['message-update', '📌 Message épinglé']],
  [AuditLogEvent.MessageUnpin, ['message-update', '📌 Message désépinglé']],
  [AuditLogEvent.OnboardingCreate, ['serveur', '🧭 Accueil du serveur configuré']],
  [AuditLogEvent.OnboardingUpdate, ['serveur', '🧭 Accueil du serveur modifié']],
  [AuditLogEvent.OnboardingPromptCreate, ['serveur', '🧭 Question d’accueil créée']],
  [AuditLogEvent.OnboardingPromptUpdate, ['serveur', '🧭 Question d’accueil modifiée']],
  [AuditLogEvent.OnboardingPromptDelete, ['serveur', '🧭 Question d’accueil supprimée']],
  [AuditLogEvent.VoiceChannelStatusCreate, ['salons', '🎙️ Statut vocal défini']],
  [AuditLogEvent.VoiceChannelStatusDelete, ['salons', '🎙️ Statut vocal supprimé']],
]);

client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
  if (!isSourceGuild(guild)) return;
  const action = auditActions.get(entry.action);
  if (!action) return;

  const targetId = entry.targetId || entry.target?.id;
  const targetName = entry.target?.username || entry.target?.name;
  const target = targetId
    ? `${targetName ? `${targetName} · ` : ''}\`${targetId}\``
    : 'Non précisé';
  const details = (entry.changes || []).slice(0, 6).map((change) => {
    const value = change.new ?? change.old;
    const rendered = typeof value === 'string' ? value : JSON.stringify(value);
    return `**${change.key} :** ${clipped(rendered || 'modifié', 250)}`;
  });

  await sendLog(action[0], action[1], [
    `👤 **Exécuté par :** ${userLabel(entry.executor)}`,
    `🎯 **Cible :** ${target}`,
    ...(entry.extra?.channel ? [`#️⃣ **Salon :** ${channelLabel(entry.extra.channel)}`] : []),
    `📝 **Raison :** ${clipped(entry.reason || 'Aucune raison fournie', 500)}`,
    ...details,
    `🕒 **Date :** ${timestamp(entry.createdAt)}`,
  ], 0xed4245);
});

client.on(Events.InviteCreate, async (invite) => {
  if (!isSourceGuild(invite.guild)) return;
  await sendLog('invitations', '🔗 Invitation créée', [
    `**Code :** \`${invite.code}\``,
    `👤 **Créateur :** ${userLabel(invite.inviter)}`,
    `#️⃣ **Salon :** ${channelLabel(invite.channel)}`,
    `**Utilisations max. :** ${invite.maxUses || 'Illimitées'}`,
    `🕒 **Expire :** ${invite.expiresAt ? timestamp(invite.expiresAt) : 'Jamais'}`,
  ], 0x57f287);
});

client.on(Events.InviteDelete, async (invite) => {
  if (!isSourceGuild(invite.guild)) return;
  await sendLog('invitations', '🔗 Invitation supprimée ou expirée', [
    `**Code :** \`${invite.code}\``,
    `#️⃣ **Salon :** ${channelLabel(invite.channel)}`,
    `🕒 **Date :** ${timestamp()}`,
  ], 0xed4245);
});

for (const [event, title, action] of [
  [Events.GuildEmojiCreate, '😀 Emoji créé', 'créé'],
  [Events.GuildEmojiDelete, '😀 Emoji supprimé', 'supprimé'],
  [Events.GuildStickerCreate, '🏷️ Sticker créé', 'créé'],
  [Events.GuildStickerDelete, '🏷️ Sticker supprimé', 'supprimé'],
]) {
  client.on(event, async (item) => {
    if (!isSourceGuild(item.guild)) return;
    await sendLog('emojis-stickers', title, [
      `**Nom :** ${item.name || 'Inconnu'}`,
      `🆔 **Identifiant :** \`${item.id}\``,
      `🕒 **Date :** ${timestamp()}`,
    ], action === 'créé' ? 0x57f287 : 0xed4245);
  });
}

client.on(Events.GuildEmojiUpdate, async (oldEmoji, newEmoji) => {
  if (!isSourceGuild(newEmoji.guild)) return;
  await sendLog('emojis-stickers', '😀 Emoji modifié', [
    `**Avant :** ${oldEmoji.name}`,
    `**Après :** ${newEmoji.name}`,
    `🆔 **Identifiant :** \`${newEmoji.id}\``,
  ]);
});

client.on(Events.GuildStickerUpdate, async (oldSticker, newSticker) => {
  if (!isSourceGuild(newSticker.guild)) return;
  await sendLog('emojis-stickers', '🏷️ Sticker modifié', [
    `**Avant :** ${oldSticker.name}`,
    `**Après :** ${newSticker.name}`,
    `🆔 **Identifiant :** \`${newSticker.id}\``,
  ]);
});

for (const [event, title, color] of [
  [Events.GuildSoundboardSoundCreate, '🔊 Son Soundboard créé', 0x57f287],
  [Events.GuildSoundboardSoundDelete, '🔊 Son Soundboard supprimé', 0xed4245],
]) {
  client.on(event, async (sound) => {
    if (!isSourceGuild(sound.guild)) return;
    await sendLog('events', title, [
      `**Nom :** ${sound.name}`,
      `🆔 **Identifiant :** \`${sound.soundId}\``,
      `👤 **Ajouté par :** ${userLabel(sound.user)}`,
      `🕒 **Date :** ${timestamp()}`,
    ], color);
  });
}

client.on(Events.GuildSoundboardSoundUpdate, async (oldSound, newSound) => {
  if (!isSourceGuild(newSound.guild)) return;
  await sendLog('events', '🔊 Son Soundboard modifié', [
    `**Avant :** ${oldSound?.name || 'inconnu'}`,
    `**Après :** ${newSound.name}`,
    `🆔 **Identifiant :** \`${newSound.soundId}\``,
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

client.on(Events.VoiceChannelEffectSend, async (effect) => {
  if (!isSourceGuild(effect.guild)) return;
  await sendLog('events', '✨ Effet envoyé dans un salon vocal', [
    `👤 **Membre :** <@${effect.userId}> (\`${effect.userId}\`)`,
    `🎙️ **Salon :** ${channelLabel(effect.channel)}`,
    `**Son :** ${effect.soundboardSound?.name || effect.emoji || 'Effet Discord'}`,
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

client.on(Events.AutoModerationRuleCreate, async (rule) => {
  if (!isSourceGuild(rule.guild)) return;
  await sendLog('automod', '🛡️ Règle AutoMod créée', [
    `**Nom :** ${rule.name}`,
    `🆔 **Identifiant :** \`${rule.id}\``,
    `🕒 **Date :** ${timestamp()}`,
  ], 0x57f287);
});

client.on(Events.AutoModerationRuleDelete, async (rule) => {
  if (!isSourceGuild(rule.guild)) return;
  await sendLog('automod', '🛡️ Règle AutoMod supprimée', [
    `**Nom :** ${rule.name}`,
    `🆔 **Identifiant :** \`${rule.id}\``,
    `🕒 **Date :** ${timestamp()}`,
  ], 0xed4245);
});

client.on(Events.AutoModerationRuleUpdate, async (oldRule, newRule) => {
  if (!isSourceGuild(newRule.guild)) return;
  await sendLog('automod', '🛡️ Règle AutoMod modifiée', [
    `**Avant :** ${oldRule.name}`,
    `**Après :** ${newRule.name}`,
    `🆔 **Identifiant :** \`${newRule.id}\``,
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

client.on(Events.AutoModerationActionExecution, async (execution) => {
  if (!isSourceGuild(execution.guild)) return;
  await sendLog('automod', '⚠️ Action AutoMod exécutée', [
    `👤 **Membre :** <@${execution.userId}> (\`${execution.userId}\`)`,
    `#️⃣ **Salon :** ${execution.channelId ? `<#${execution.channelId}>` : 'Aucun'}`,
    `🛡️ **Règle :** ${execution.ruleName || execution.ruleId}`,
    `**Action :** ${execution.action.type}`,
    `**Contenu :** ${clipped(execution.content || 'Non disponible')}`,
    `🕒 **Date :** ${timestamp()}`,
  ], 0xed4245);
});

client.on(Events.GuildIntegrationsUpdate, async (guild) => {
  if (!isSourceGuild(guild)) return;
  await sendLog('integrations', '🔌 Intégrations modifiées', [
    `🕒 **Date :** ${timestamp()}`,
    'Discord ne fournit pas le détail des modifications pour cet événement.',
  ]);
});

client.on(Events.WebhooksUpdate, async (channel) => {
  if (!isSourceGuild(channel.guild)) return;
  await sendLog('integrations', '🪝 Webhooks modifiés', [
    `#️⃣ **Salon :** ${channelLabel(channel)}`,
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

for (const [event, action] of [
  [Events.GuildScheduledEventCreate, 'créé'],
  [Events.GuildScheduledEventDelete, 'supprimé'],
]) {
  client.on(event, async (scheduledEvent) => {
    if (!isSourceGuild(scheduledEvent.guild)) return;
    await sendLog('events', `📅 Événement ${action}`, [
      `**Nom :** ${scheduledEvent.name}`,
      `🆔 **Identifiant :** \`${scheduledEvent.id}\``,
      `**Début :** ${scheduledEvent.scheduledStartAt ? timestamp(scheduledEvent.scheduledStartAt) : 'Inconnu'}`,
      `🕒 **Date du log :** ${timestamp()}`,
    ]);
  });
}

client.on(Events.GuildScheduledEventUpdate, async (oldEvent, newEvent) => {
  if (!isSourceGuild(newEvent.guild)) return;
  const changes = [];
  if (oldEvent.name !== newEvent.name) changes.push(`**Nom :** ${oldEvent.name} → ${newEvent.name}`);
  if (oldEvent.scheduledStartAt?.getTime() !== newEvent.scheduledStartAt?.getTime()) {
    changes.push(`**Début :** ${oldEvent.scheduledStartAt ? timestamp(oldEvent.scheduledStartAt) : 'Inconnu'} → ${newEvent.scheduledStartAt ? timestamp(newEvent.scheduledStartAt) : 'Inconnu'}`);
  }
  if (!changes.length) changes.push(`**Événement :** ${newEvent.name}`);
  await sendLog('events', '📅 Événement modifié', [
    `🆔 **Identifiant :** \`${newEvent.id}\``,
    ...changes,
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

for (const [event, title, action] of [
  [Events.GuildScheduledEventUserAdd, '📅 Participant inscrit à un événement', 'inscrit'],
  [Events.GuildScheduledEventUserRemove, '📅 Participant désinscrit d’un événement', 'désinscrit'],
]) {
  client.on(event, async (scheduledEvent, user) => {
    if (!isSourceGuild(scheduledEvent.guild)) return;
    await sendLog('events', title, [
      `👤 **Membre :** ${userLabel(user)}`,
      `📅 **Événement :** ${scheduledEvent.name} (\`${scheduledEvent.id}\`)`,
      `**Action :** ${action}`,
      `🕒 **Date :** ${timestamp()}`,
    ]);
  });
}

client.on(Events.StageInstanceCreate, async (stage) => {
  if (!isSourceGuild(stage.guild)) return;
  await sendLog('events', '🎤 Stage créé', [
    `**Sujet :** ${stage.topic}`,
    `🎙️ **Salon :** ${channelLabel(stage.channel)}`,
    `🕒 **Date :** ${timestamp()}`,
  ], 0x57f287);
});

client.on(Events.StageInstanceDelete, async (stage) => {
  if (!isSourceGuild(stage.guild)) return;
  await sendLog('events', '🎤 Stage terminé', [
    `**Sujet :** ${stage.topic}`,
    `🎙️ **Salon :** ${channelLabel(stage.channel)}`,
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

client.on(Events.StageInstanceUpdate, async (oldStage, newStage) => {
  if (!isSourceGuild(newStage.guild)) return;
  const changes = [];
  if (oldStage?.topic !== newStage.topic) {
    changes.push(`**Sujet :** ${oldStage?.topic || 'aucun'} → ${newStage.topic}`);
  }
  if (oldStage?.privacyLevel !== newStage.privacyLevel) {
    changes.push(`**Confidentialité :** ${oldStage?.privacyLevel ?? 'inconnue'} → ${newStage.privacyLevel}`);
  }
  await sendLog('events', '🎤 Stage modifié', [
    `🎙️ **Salon :** ${channelLabel(newStage.channel)}`,
    ...(changes.length ? changes : ['**Détails :** paramètres du stage modifiés']),
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (!isSourceGuild(reaction.message.guild)) return;
  await sendLog('reactions', '➕ Réaction ajoutée', [
    `👤 **Membre :** ${userLabel(user)}`,
    `**Réaction :** ${reaction.emoji}`,
    `#️⃣ **Salon :** ${channelLabel(reaction.message.channel)}`,
    `🆔 **Message :** \`${reaction.message.id}\``,
  ], 0x57f287);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (!isSourceGuild(reaction.message.guild)) return;
  await sendLog('reactions', '➖ Réaction retirée', [
    `👤 **Membre :** ${userLabel(user)}`,
    `**Réaction :** ${reaction.emoji}`,
    `#️⃣ **Salon :** ${channelLabel(reaction.message.channel)}`,
    `🆔 **Message :** \`${reaction.message.id}\``,
  ], 0xed4245);
});

client.on(Events.MessageReactionRemoveAll, async (message) => {
  if (!isSourceGuild(message.guild)) return;
  await sendLog('reactions', '🧹 Toutes les réactions retirées', [
    `#️⃣ **Salon :** ${channelLabel(message.channel)}`,
    `🆔 **Message :** \`${message.id}\``,
    `🕒 **Date :** ${timestamp()}`,
  ], 0xed4245);
});

client.on(Events.MessageReactionRemoveEmoji, async (reaction) => {
  if (!isSourceGuild(reaction.message.guild)) return;
  await sendLog('reactions', '➖ Réaction retirée de toutes les réponses', [
    `**Réaction :** ${reaction.emoji}`,
    `#️⃣ **Salon :** ${channelLabel(reaction.message.channel)}`,
    `🆔 **Message :** \`${reaction.message.id}\``,
    `🕒 **Date :** ${timestamp()}`,
  ], 0xed4245);
});

for (const [event, action, color] of [
  [Events.MessagePollVoteAdd, 'ajouté', 0x57f287],
  [Events.MessagePollVoteRemove, 'retiré', 0xed4245],
]) {
  client.on(event, async (answer, userId) => {
    const message = answer.poll?.message;
    if (!isSourceGuild(message?.guild)) return;
    await sendLog('sondages', `📊 Vote ${action}`, [
      `👤 **Membre :** <@${userId}> (\`${userId}\`)`,
      `🗳️ **Question :** ${clipped(answer.poll.question?.text || 'Sondage', 250)}`,
      `**Réponse :** ${answer.emoji || answer.text || answer.id}`,
      `#️⃣ **Salon :** ${channelLabel(message.channel)}`,
      `🆔 **Message :** \`${message.id}\``,
      `🕒 **Date :** ${timestamp()}`,
    ], color);
  });
}

client.on(Events.ChannelPinsUpdate, async (channel, date) => {
  if (!isSourceGuild(channel.guild)) return;
  await sendLog('salons', '📌 Épingles modifiées', [
    `#️⃣ **Salon :** ${channelLabel(channel)}`,
    `🕒 **Date :** ${timestamp(date || new Date())}`,
  ]);
});

client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  if (!isSourceGuild(newGuild)) return;
  const changes = [];
  if (oldGuild.name !== newGuild.name) changes.push(`**Nom :** ${oldGuild.name} → ${newGuild.name}`);
  if (oldGuild.description !== newGuild.description) changes.push(`**Description :** ${oldGuild.description || 'aucune'} → ${newGuild.description || 'aucune'}`);
  if (oldGuild.icon !== newGuild.icon) changes.push('**Icône du serveur modifiée**');
  if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) {
    changes.push(`**Lien personnalisé :** ${oldGuild.vanityURLCode || 'aucun'} → ${newGuild.vanityURLCode || 'aucun'}`);
  }
  if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
    changes.push(`**Vérification :** ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
  }
  if (oldGuild.premiumTier !== newGuild.premiumTier) {
    changes.push(`**Niveau de boost :** ${oldGuild.premiumTier} → ${newGuild.premiumTier}`);
  }
  if (oldGuild.premiumSubscriptionCount !== newGuild.premiumSubscriptionCount) {
    changes.push(`**Nombre de boosts :** ${oldGuild.premiumSubscriptionCount || 0} → ${newGuild.premiumSubscriptionCount || 0}`);
  }
  if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
    changes.push(`**Délai AFK :** ${oldGuild.afkTimeout}s → ${newGuild.afkTimeout}s`);
  }
  if (!changes.length) return;
  await sendLog('serveur', '⚙️ Serveur modifié', [
    ...changes,
    `🕒 **Date :** ${timestamp()}`,
  ]);
});

client.once(Events.ClientReady, async (readyClient) => {
  try {
    readyClient.user.setStatus('dnd');
    if (!LOG_GUILD_ID) {
      throw new Error('LOG_GUILD_ID doit être renseigné dans logs/.env.');
    }
    if (settings.sourceGuildId && settings.sourceGuildId === LOG_GUILD_ID) {
      throw new Error('Le serveur source et le serveur de logs doivent être différents.');
    }

    const logGuild = await readyClient.guilds.fetch(LOG_GUILD_ID);
    await setupLogChannels(logGuild);
    await readyClient.application.commands.set(LOG_COMMANDS, LOG_GUILD_ID);
    let sourceGuild = null;
    if (settings.sourceGuildId) {
      try {
        sourceGuild = await readyClient.guilds.fetch(settings.sourceGuildId);
      } catch (error) {
        console.error('[logs] Serveur source configuré inaccessible:', error);
        settings.enabled = false;
        saveSettings();
        console.warn('[logs] Relais désactivé jusqu’à la reconfiguration avec /logs setup.');
      }
    }
    console.log(
      `[logs] Connecté comme ${readyClient.user.tag}. Source: ${sourceGuild?.name || 'à configurer'}; logs: ${logGuild.name}.`,
    );
  } catch (error) {
    console.error('[logs] Impossible de démarrer le relais de logs:', error);
    readyClient.destroy();
    process.exitCode = 1;
  }
});

client.on(Events.Error, (error) => console.error('[logs] Erreur Discord:', error));
client.on(Events.Warn, (warning) => console.warn('[logs] Avertissement Discord:', warning));

if (!process.env.DISCORD_TOKEN) {
  throw new Error('DISCORD_TOKEN doit être renseigné dans logs/.env.');
}
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('[logs] Connexion Discord impossible:', error);
  process.exitCode = 1;
});
