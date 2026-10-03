const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  Events,
} = require('discord.js');

// =====================================================
// KIND SMP SUPPORT BOT
// =====================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// =====================================================
// SERVER SETTINGS
// =====================================================

const GUILD_ID = process.env.GUILD_ID || '1555704317552361563';

const SUPPORT_PANEL_CHANNEL_ID = process.env.TICKET_PANEL_CHANNEL_ID || '1555835101408010281';

const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || '1555723349630652457';

const CLOSED_TICKET_LOG_CHANNEL_ID = process.env.TICKET_LOG_CHANNEL_ID || '1555840357592203274';

// =====================================================
// STAFF ROLES
// =====================================================

const GENERAL_STAFF_ROLE_ID = process.env.GENERAL_STAFF_ROLE_ID || '1555840026607362099';

const SENIOR_STAFF_ROLE_ID = process.env.SENIOR_STAFF_ROLE_ID || '1555839917815238736';

const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID || '1555827222688829441';

const CO_OWNER_ROLE_ID = process.env.CO_OWNER_ROLE_ID || OWNER_ROLE_ID;

const STAFF_ROLE_IDS = [
  GENERAL_STAFF_ROLE_ID,
  SENIOR_STAFF_ROLE_ID,
  OWNER_ROLE_ID,
  CO_OWNER_ROLE_ID,
];

// =====================================================
// CLIENT
// =====================================================

const client = global.__KIND_BOSS_CLIENT;

// =====================================================
// TICKET CREATION LOCKS
// =====================================================

const ticketCreationLocks = new Set();

const ticketClosingLocks = new Set();

// =====================================================
// STAFF CACHE
// =====================================================

let staffCache = [];

let staffCacheTime = 0;

const STAFF_CACHE_LIFETIME =
  60 * 1000;

// =====================================================
// HELPERS
// =====================================================

function isStaff(member) {
  if (!member) return false;

  return STAFF_ROLE_IDS.some(
    (roleId) =>
      member.roles.cache.has(roleId)
  );
}

function cleanChannelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

function getTicketOwner(channel) {
  if (!channel?.topic) {
    return null;
  }

  const match =
    channel.topic.match(
      /owner=(\d+)/
    );

  return match
    ? match[1]
    : null;
}

function getTicketType(channel) {
  if (!channel?.topic) {
    return 'unknown';
  }

  const match =
    channel.topic.match(
      /type=([^|]+)/
    );

  return match
    ? match[1]
    : 'unknown';
}

function ticketPermissions() {
  return [
    PermissionsBitField.Flags
      .ViewChannel,

    PermissionsBitField.Flags
      .SendMessages,

    PermissionsBitField.Flags
      .ReadMessageHistory,

    PermissionsBitField.Flags
      .AttachFiles,

    PermissionsBitField.Flags
      .EmbedLinks,
  ];
}

function getStaffRoleName(member) {
  if (
    member.roles.cache.has(
      OWNER_ROLE_ID
    )
  ) {
    return 'Owner';
  }

  if (
    member.roles.cache.has(
      CO_OWNER_ROLE_ID
    )
  ) {
    return 'Co-Owner';
  }

  if (
    member.roles.cache.has(
      SENIOR_STAFF_ROLE_ID
    )
  ) {
    return 'Senior Staff';
  }

  if (
    member.roles.cache.has(
      GENERAL_STAFF_ROLE_ID
    )
  ) {
    return 'General Staff';
  }

  return 'Staff';
}

// =====================================================
// STAFF CACHE
// =====================================================

async function refreshStaffCache(
  guild
) {
  const now =
    Date.now();

  if (
    staffCache.length > 0 &&
    now - staffCacheTime <
      STAFF_CACHE_LIFETIME
  ) {
    return staffCache;
  }

  staffCache =
    guild.members.cache
      .filter(
        (member) =>
          !member.user.bot &&
          isStaff(member)
      )
      .map(
        (member) => member
      );

  staffCacheTime =
    now;

  return staffCache;
}

// =====================================================
// FIND EXISTING TICKET
// =====================================================

function findExistingTicket(
  guild,
  userId
) {
  return guild.channels.cache.find(
    (channel) =>
      channel.type ===
        ChannelType.GuildText &&
      channel.parentId ===
        TICKET_CATEGORY_ID &&
      getTicketOwner(channel) ===
        userId
  );
}

// =====================================================
// SUPPORT PANEL
// =====================================================

async function createSupportPanel(
  guild
) {
  const channel =
    await guild.channels.fetch(
      SUPPORT_PANEL_CHANNEL_ID
    );

  if (!channel) {
    throw new Error(
      'Support panel channel not found.'
    );
  }

  const messages =
    await channel.messages.fetch({
      limit: 50,
    });

  const oldPanels =
    messages.filter(
      (message) =>
        message.author.id ===
          client.user.id &&
        message.embeds[0]?.title ===
          '🎫 Crafted SMP Support'
    );

  for (
    const oldPanel
    of oldPanels.values()
  ) {
    try {
      await oldPanel.delete();
    } catch (error) {
      console.error(
        'Old panel delete error:',
        error
      );
    }
  }

  const embed =
    new EmbedBuilder()
      .setTitle(
        '🎫 Crafted SMP Support'
      )
      .setDescription(
        [
          'Need support?',
          '',
          'Choose who you want to handle your ticket.',
          '',
          '👤 **Specific Staff**',
          'Choose one or multiple staff members.',
          '',
          '🛡️ **All Staff**',
          'Allow the entire staff team to see the ticket.',
          '',
          'All tickets are private.',
        ].join('\n')
      )
      .setColor(
        0x3498db
      )
      .setFooter({
        text:
          'Crafted SMP Support System',
      });

  const buttons =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            'ticket_specific_staff'
          )
          .setLabel(
            'Specific Staff'
          )
          .setEmoji('👤')
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            'ticket_all_staff'
          )
          .setLabel(
            'All Staff'
          )
          .setEmoji('🛡️')
          .setStyle(
            ButtonStyle.Success
          )
      );

  await channel.send({
    embeds: [
      embed,
    ],

    components: [
      buttons,
    ],
  });

  console.log(
    '✅ Support panel created.'
  );
}

// =====================================================
// SPECIFIC STAFF MENU
// =====================================================

async function showSpecificStaffMenu(
  interaction
) {
  // Respond immediately.

  await interaction.deferReply({
    ephemeral: true,
  });

  const staffMembers =
    await refreshStaffCache(
      interaction.guild
    );

  if (
    staffMembers.length === 0
  ) {
    return interaction.editReply({
      content:
        '❌ No staff members could be found.',
    });
  }

  const visibleStaff =
    staffMembers.slice(
      0,
      25
    );

  const options =
    visibleStaff.map(
      (member) => ({
        label:
          member.displayName.substring(
            0,
            100
          ),

        description:
          getStaffRoleName(
            member
          ),

        value:
          member.id,
      })
    );

  const menu =
    new StringSelectMenuBuilder()
      .setCustomId(
        'ticket_specific_staff_select'
      )
      .setPlaceholder(
        'Choose one or multiple staff members'
      )
      .setMinValues(1)
      .setMaxValues(
        Math.min(
          10,
          visibleStaff.length
        )
      )
      .addOptions(
        options
      );

  return interaction.editReply({
    content:
      '👤 **Choose one or multiple staff members:**',

    components: [
      new ActionRowBuilder()
        .addComponents(
          menu
        ),
    ],
  });
}

// =====================================================
// CREATE TICKET
// =====================================================

async function createTicket({
  guild,
  member,
  type,
  allowedUsers = [],
  allowedRoles = [],
}) {
  const userId =
    member.id;

  // ===================================================
  // PREVENT DOUBLE CREATION
  // ===================================================

  if (
    ticketCreationLocks.has(
      userId
    )
  ) {
    return {
      success:
        false,

      message:
        '⏳ Your ticket is already being created. Please wait.',
    };
  }

  ticketCreationLocks.add(
    userId
  );

  try {

    // =================================================
    // ONE TICKET PER PLAYER
    // =================================================

    const existingTicket =
      findExistingTicket(
        guild,
        userId
      );

    if (existingTicket) {
      return {
        success:
          false,

        message:
          `❌ You already have an open ticket: ${existingTicket}`,
      };
    }

    // =================================================
    // PERMISSIONS
    // =================================================

    const overwrites = [
      {
        id:
          guild.roles.everyone.id,

        deny: [
          PermissionsBitField.Flags
            .ViewChannel,
        ],
      },

      {
        id:
          member.id,

        allow:
          ticketPermissions(),
      },

      {
        id:
          client.user.id,

        allow: [
          ...ticketPermissions(),

          PermissionsBitField.Flags
            .ManageChannels,

          PermissionsBitField.Flags
            .ManageMessages,
        ],
      },
    ];

    // =================================================
    // STAFF ROLE PERMISSIONS
    // =================================================

    for (
      const roleId
      of STAFF_ROLE_IDS
    ) {
      if (
        allowedRoles.includes(
          roleId
        )
      ) {
        overwrites.push({
          id:
            roleId,

          allow:
            ticketPermissions(),
        });

      } else {

        overwrites.push({
          id:
            roleId,

          deny: [
            PermissionsBitField.Flags
              .ViewChannel,
          ],
        });
      }
    }

    // =================================================
    // SELECTED STAFF
    // =================================================

    for (
      const selectedUserId
      of allowedUsers
    ) {
      overwrites.push({
        id:
          selectedUserId,

        allow:
          ticketPermissions(),
      });
    }

    // =================================================
    // CREATE CHANNEL
    // =================================================

    const username =
      cleanChannelName(
        member.user.username
      ) || 'player';

    const ticketChannel =
      await guild.channels.create({
        name:
          `ticket-${username}-${member.id.slice(-4)}`,

        type:
          ChannelType.GuildText,

        parent:
          TICKET_CATEGORY_ID,

        topic:
          `KIND_SUPPORT|owner=${member.id}|type=${type}`,

        permissionOverwrites:
          overwrites,

        reason:
          `Support ticket opened by ${member.user.tag}`,
      });

    // =================================================
    // PRIVACY TEXT
    // =================================================

    let privacyText =
      'This is a private support ticket.';

    if (
      type ===
      'specific_staff'
    ) {
      if (
        allowedUsers.length === 1
      ) {
        privacyText =
          'Only you and the staff member you selected can access this ticket.';
      } else {
        privacyText =
          'Only you and the staff members you selected can access this ticket.';
      }
    }

    if (
      type ===
      'all_staff'
    ) {
      privacyText =
        'You and all Crafted SMP staff can access this ticket.';
    }

    // =================================================
    // TICKET EMBED
    // =================================================

    const embed =
      new EmbedBuilder()
        .setTitle(
          '🎫 Support Ticket'
        )
        .setDescription(
          [
            `Welcome ${member}!`,
            '',
            privacyText,
            '',
            'Explain what you need help with below.',
            '',
            'A staff member can close this ticket when it is resolved.',
          ].join('\n')
        )
        .setColor(
          0x2ecc71
        )
        .setFooter({
          text:
            `Ticket opened by ${member.user.username}`,
        });

    const closeButton =
      new ActionRowBuilder()
        .addComponents(

          new ButtonBuilder()
            .setCustomId(
              'ticket_close'
            )
            .setLabel(
              'Close Ticket'
            )
            .setEmoji('🔒')
            .setStyle(
              ButtonStyle.Danger
            )
        );

    await ticketChannel.send({
      content:
        `${member}`,

      embeds: [
        embed,
      ],

      components: [
        closeButton,
      ],

      allowedMentions: {
        users: [
          member.id,
        ],
      },
    });

    return {
      success:
        true,

      channel:
        ticketChannel,
    };

  } catch (error) {

    console.error(
      'Ticket creation error:',
      error
    );

    return {
      success:
        false,

      message:
        '❌ The ticket could not be created. Please try again.',
    };

  } finally {

    ticketCreationLocks.delete(
      userId
    );
  }
}

// =====================================================
// TRANSCRIPT
// =====================================================

async function createTranscript(
  channel
) {
  const allMessages = [];

  let before;

  while (true) {
    const options = {
      limit:
        100,
    };

    if (before) {
      options.before =
        before;
    }

    const messages =
      await channel.messages.fetch(
        options
      );

    if (
      messages.size === 0
    ) {
      break;
    }

    allMessages.push(
      ...messages.values()
    );

    before =
      messages.last().id;

    if (
      messages.size < 100
    ) {
      break;
    }
  }

  allMessages.sort(
    (a, b) =>
      a.createdTimestamp -
      b.createdTimestamp
  );

  const lines = [];

  lines.push(
    '=================================================='
  );

  lines.push(
    'KIND SMP SUPPORT TICKET'
  );

  lines.push(
    'FULL CONVERSATION HISTORY'
  );

  lines.push(
    '=================================================='
  );

  lines.push('');

  lines.push(
    `Ticket: #${channel.name}`
  );

  lines.push(
    `Channel ID: ${channel.id}`
  );

  lines.push(
    `Created: ${new Date(
      channel.createdTimestamp
    ).toLocaleString()}`
  );

  lines.push('');

  lines.push(
    '=================================================='
  );

  lines.push('');

  for (
    const message
    of allMessages
  ) {
    const date =
      new Date(
        message.createdTimestamp
      ).toLocaleString();

    lines.push(
      `[${date}]`
    );

    lines.push(
      `${message.author.tag} (${message.author.id})`
    );

    lines.push('');

    lines.push(
      message.content ||
        '[No text content]'
    );

    // =================================================
    // ATTACHMENTS
    // =================================================

    if (
      message.attachments.size >
      0
    ) {
      lines.push('');

      lines.push(
        'ATTACHMENTS:'
      );

      for (
        const attachment
        of message.attachments.values()
      ) {
        lines.push(
          `Name: ${attachment.name || 'Attachment'}`
        );

        lines.push(
          `URL: ${attachment.url}`
        );
      }
    }

    // =================================================
    // EMBEDS
    // =================================================

    if (
      message.embeds.length >
      0
    ) {
      lines.push('');

      lines.push(
        `Discord embeds: ${message.embeds.length}`
      );
    }

    lines.push('');

    lines.push(
      '--------------------------------------------------'
    );

    lines.push('');
  }

  const buffer =
    Buffer.from(
      lines.join('\n'),
      'utf8'
    );

  return new AttachmentBuilder(
    buffer,
    {
      name:
        `${channel.name}-conversation-history.txt`,
    }
  );
}

// =====================================================
// CLOSE TICKET
// =====================================================

async function closeTicket(
  interaction
) {
  // ===================================================
  // ACKNOWLEDGE BUTTON IMMEDIATELY
  // ===================================================

  try {
    await interaction.deferReply({
      ephemeral:
        true,
    });

  } catch (error) {

    console.error(
      'Could not acknowledge Close Ticket:',
      error
    );

    return;
  }

  const channel =
    interaction.channel;

  // ===================================================
  // STOP DOUBLE CLOSE
  // ===================================================

  if (
    ticketClosingLocks.has(
      channel.id
    )
  ) {
    return interaction.editReply({
      content:
        '⏳ This ticket is already being closed.',
    });
  }

  ticketClosingLocks.add(
    channel.id
  );

  try {

    // =================================================
    // VERIFY TICKET
    // =================================================

    const ticketOwnerId =
      getTicketOwner(
        channel
      );

    if (!ticketOwnerId) {
      return interaction.editReply({
        content:
          '❌ This is not a support ticket.',
      });
    }

    // =================================================
    // STAFF ONLY
    // =================================================

    if (
      !isStaff(
        interaction.member
      )
    ) {
      return interaction.editReply({
        content:
          '❌ Only staff members can close tickets.',
      });
    }

    // =================================================
    // SHOW PROGRESS
    // =================================================

    await interaction.editReply({
      content:
        '🔒 Closing ticket and saving conversation...',
    });

    // =================================================
    // CREATE TRANSCRIPT
    // =================================================

    const transcript =
      await createTranscript(
        channel
      );

    // =================================================
    // GET ARCHIVE CHANNEL
    // =================================================

    const archiveChannel =
      await interaction.guild.channels.fetch(
        CLOSED_TICKET_LOG_CHANNEL_ID
      );

    if (!archiveChannel) {
      throw new Error(
        'Closed ticket archive channel not found.'
      );
    }

    // =================================================
    // GET TICKET OWNER
    // =================================================

    const ticketOwner =
      await interaction.guild.members
        .fetch(
          ticketOwnerId
        )
        .catch(
          () => null
        );

    const ticketType =
      getTicketType(
        channel
      );

    // =================================================
    // ARCHIVE EMBED
    // =================================================

    const archiveEmbed =
      new EmbedBuilder()
        .setTitle(
          '🔒 Closed Support Ticket'
        )
        .setDescription(
          [
            'This ticket has been closed.',
            '',
            '📎 The full conversation history is attached.',
          ].join('\n')
        )
        .addFields(

          {
            name:
              '🎫 Ticket',

            value:
              `#${channel.name}`,

            inline:
              true,
          },

          {
            name:
              '👤 Created By',

            value:
              ticketOwner
                ? `${ticketOwner.user.tag}\n<@${ticketOwner.id}>`
                : `<@${ticketOwnerId}>`,

            inline:
              true,
          },

          {
            name:
              '🔒 Closed By',

            value:
              `${interaction.user.tag}\n<@${interaction.user.id}>`,

            inline:
              true,
          },

          {
            name:
              '📂 Ticket Type',

            value:
              ticketType,

            inline:
              true,
          },

          {
            name:
              '🆔 Channel ID',

            value:
              channel.id,

            inline:
              true,
          }
        )
        .setColor(
          0xe74c3c
        )
        .setTimestamp();

    // =================================================
    // SAVE CLOSED TICKET
    // =================================================

    await archiveChannel.send({
      embeds: [
        archiveEmbed,
      ],

      files: [
        transcript,
      ],
    });

    // =================================================
    // SUCCESS
    // =================================================

    await interaction.editReply({
      content:
        '✅ Ticket saved. Closing in 5 seconds...',
    });

    await channel.send({
      content:
        [
          '✅ **Ticket saved successfully.**',
          '',
          'The full conversation has been archived.',
          '',
          '🔒 This ticket will be deleted in 5 seconds.',
        ].join('\n'),
    });

    // =================================================
    // DELETE TICKET
    // =================================================

    setTimeout(
      async () => {
        try {

          await channel.delete(
            `Closed by ${interaction.user.tag}`
          );

        } catch (error) {

          console.error(
            'Ticket delete error:',
            error
          );

        } finally {

          ticketClosingLocks.delete(
            channel.id
          );
        }
      },

      5000
    );

  } catch (error) {

    ticketClosingLocks.delete(
      channel.id
    );

    console.error(
      'Close ticket error:',
      error
    );

    try {

      await interaction.editReply({
        content:
          '❌ The ticket could not be archived. It will NOT be deleted.',
      });

    } catch (replyError) {

      console.error(
        'Close ticket reply error:',
        replyError
      );
    }
  }
}

// =====================================================
// INTERACTIONS
// =====================================================

client.on(
  Events.InteractionCreate,

  async (interaction) => {
    try {

      // =================================================
      // BUTTONS
      // =================================================

      if (
        interaction.isButton()
      ) {

        // =================================================
        // SPECIFIC STAFF
        // =================================================

        if (
          interaction.customId ===
          'ticket_specific_staff'
        ) {
          return await showSpecificStaffMenu(
            interaction
          );
        }

        // =================================================
        // ALL STAFF
        // =================================================

        if (
          interaction.customId ===
          'ticket_all_staff'
        ) {
          // ACKNOWLEDGE IMMEDIATELY

          await interaction.deferReply({
            ephemeral:
              true,
          });

          const result =
            await createTicket({
              guild:
                interaction.guild,

              member:
                interaction.member,

              type:
                'all_staff',

              allowedRoles:
                STAFF_ROLE_IDS,
            });

          return interaction.editReply({
            content:
              result.success
                ? `✅ Ticket created: ${result.channel}`
                : result.message,
          });
        }

        // =================================================
        // CLOSE TICKET
        // =================================================

        if (
          interaction.customId ===
          'ticket_close'
        ) {
          return await closeTicket(
            interaction
          );
        }
      }

      // =================================================
      // SPECIFIC STAFF SELECT
      // =================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'ticket_specific_staff_select'
      ) {
        // ACKNOWLEDGE IMMEDIATELY

        await interaction.deferUpdate();

        const selectedStaffIds =
          interaction.values;

        const validStaffIds =
          selectedStaffIds.filter(
            (staffId) => {

              const staffMember =
                interaction.guild.members.cache.get(
                  staffId
                );

              return (
                staffMember &&
                !staffMember.user.bot &&
                isStaff(
                  staffMember
                )
              );
            }
          );

        if (
          validStaffIds.length === 0
        ) {
          return interaction.editReply({
            content:
              '❌ No valid staff members were selected.',

            components:
              [],
          });
        }

        const result =
          await createTicket({
            guild:
              interaction.guild,

            member:
              interaction.member,

            type:
              'specific_staff',

            allowedUsers:
              validStaffIds,
          });

        return interaction.editReply({
          content:
            result.success
              ? `✅ Private ticket created with ${validStaffIds.length} selected staff member(s): ${result.channel}`
              : result.message,

          components:
            [],
        });
      }

    } catch (error) {

      console.error(
        'Interaction error:',
        error
      );

      const errorMessage =
        '❌ Something went wrong. Please try again.';

      try {

        if (
          interaction.deferred ||
          interaction.replied
        ) {

          await interaction.editReply({
            content:
              errorMessage,
          });

        } else {

          await interaction.reply({
            content:
              errorMessage,

            ephemeral:
              true,
          });
        }

      } catch (replyError) {

        console.error(
          'Interaction reply error:',
          replyError
        );
      }
    }
  }
);

// =====================================================
// KEEP STAFF CACHE UPDATED
// =====================================================

client.on(
  Events.GuildMemberUpdate,

  () => {
    staffCacheTime =
      0;
  }
);

client.on(
  Events.GuildMemberAdd,

  () => {
    staffCacheTime =
      0;
  }
);

client.on(
  Events.GuildMemberRemove,

  () => {
    staffCacheTime =
      0;
  }
);

// =====================================================
// READY
// =====================================================

client.once(
  Events.ClientReady,

  async (readyClient) => {

    console.log(
      `✅ Logged in as ${readyClient.user.tag}`
    );

    try {

      const guild =
        await client.guilds.fetch(
          GUILD_ID
        );

      // Fetch members ONCE at startup.

      await guild.members.fetch();

      console.log(
        `✅ Connected to ${guild.name}`
      );

      await refreshStaffCache(
        guild
      );

      console.log(
        `✅ Found ${staffCache.length} staff members`
      );

      await createSupportPanel(
        guild
      );

      const archiveChannel =
        await guild.channels.fetch(
          CLOSED_TICKET_LOG_CHANNEL_ID
        );

      if (!archiveChannel) {
        throw new Error(
          'Closed ticket archive channel not found.'
        );
      }

      console.log(
        `✅ Closed ticket archive: #${archiveChannel.name}`
      );

      console.log(
        '✅ Crafted SMP Support system ready.'
      );

    } catch (error) {

      console.error(
        '❌ Startup error:',
        error
      );
    }
  }
);

// =====================================================
// ERRORS
// =====================================================

process.on(
  'unhandledRejection',

  (error) => {
    console.error(
      'Unhandled rejection:',
      error
    );
  }
);

process.on(
  'uncaughtException',

  (error) => {
    console.error(
      'Uncaught exception:',
      error
    );
  }
);

// =====================================================
// LOGIN
// =====================================================

if (!DISCORD_TOKEN) {

  console.error(
    '❌ DISCORD_TOKEN is missing.'
  );

  process.exit(1);
}

