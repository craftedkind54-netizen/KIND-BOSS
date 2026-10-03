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

## Minecraft activity feed (v1.1.0)
Set `MINECRAFT_FEED_CHANNEL_ID=1555986926052315208` in Railway.

The Paper bridge sends only server activity — not player chat:
- server online / offline
- player join / leave
- announced advancements
- player deaths

Player events use the Minecraft head as the Discord embed author icon, directly beside the event text.

Build the Paper 1.21.11 plugin:
```bash
cd minecraft-plugin
mvn clean package
```
The JAR is created in `minecraft-plugin/target/`.


## Anonymous Venting (v1.2.0)
- Create-a-vent panel: `1555994016766628001`
- Public anonymous vent feed: `1555993876181815296`
- Blocks mentions, Discord IDs, and exact server member usernames/display names.
- Members should use the private support system if they need to identify another person.


## v1.4.0 — Interview Study Guides
When an interview is confirmed, KIND BOSS automatically DMs the applicant a rank-specific study guide. The guide covers the board's core subjects and target-rank focus areas without revealing the exact interview questions. This works for normal approved applications and Direct Interviews. No new Railway variables are required.
