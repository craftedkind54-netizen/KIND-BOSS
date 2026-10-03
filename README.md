# KIND BOSS

One Discord bot for the new KIND SMP: support tickets, announcements/flash announcements/events/polls, strike management, and a Paper 1.21.11 Minecraft bridge.

## Discord / Railway setup
1. Create one new Discord application/bot named **KIND BOSS**.
2. Enable **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal.
3. Invite it to guild `1555704317552361563` with permissions needed to view/send/manage messages and channels, manage roles used by the bot, and use application commands/interactions.
4. Deploy this repository to Railway with `npm start`.
5. Add `DISCORD_TOKEN` and `BRIDGE_SECRET` as Railway variables. Never commit either secret.
6. Add a Railway persistent volume and mount it so `STRIKES_DB_PATH` points to persistent storage if you want strike history to survive redeploys.

The supplied new SMP IDs are already defaults in the code and `.env.example`.

## Still optional / not supplied yet
The old announcement bot had dedicated **Flash**, **Control**, and notification role IDs. Until new IDs are supplied, Flash/Control fall back to the announcements channel and notification-role fallbacks use General Staff. For a clean production setup, create dedicated channels/roles and set `FLASH_CHANNEL_ID`, `CONTROL_CHANNEL_ID`, `FLASH_ROLE_ID`, `EVENT_ROLE_ID`, and `POLL_ROLE_ID` in Railway.

The strike management panel currently shares the new strike/log channel. Set `STRIKE_MANAGEMENT_CHANNEL_ID` if you create a separate management channel.

## Minecraft bridge
Build `minecraft-plugin/` with Java 21 + Maven. Put the resulting JAR in the Paper 1.21.11 `plugins/` folder. Start once, then edit `plugins/KindBossBridge/config.yml`:
- `bridge-url`: your Railway public URL
- `bridge-secret`: the exact same secret as Railway `BRIDGE_SECRET`

Commands: `/strike add <online-player> <amount> <reason>`, `/strike remove <online-player> <amount> <reason>`, `/strike list`.
