## v1.22.0 - Rank-based promotion boards

- Restored the Crafted SMP welcome before the first category, with target-rank evaluation points.
- Added distinct questions for all six ranks in all eight core categories, based on the supplied SMP rules.pdf.
- Added a ninth, unscored Bonus / Troll Check with the eight requested creative prompts and rank-specific follow-ups.
- Added matching category briefs and applicant study topics; select three questions in each category.
- Preserved the 24-point core score, alternating interviewers, personal notes and Owner final approval.
- Saved question snapshots for new interviews and preserved original question indices for interviews already started.
- Split final details into readable messages within Discord size limits.

See INTERVIEW-UPDATE.md for deployment and compatibility notes, and INTERVIEW-QUESTION-CATALOG.md for all questions.

## v1.21.1 duplicate Flash reminder fix

- Scheduled announcements now create **one** pre-announcement Flash Updates message instead of posting once at scheduling time and again at the reminder time.
- The scheduler remains responsible for the reminder and continues using `flashReminderSent` to prevent repeat reminders.
- Existing `/app/data` persistence, staff applications, interview availability, scheduled announcements, and intro data are unchanged.

# KIND BOSS v1.18.0

Full replacement.

## Flash reminder update
- Scheduled announcements still post normally at the selected time.
- KIND BOSS posts a real reminder in the Flash Updates channel one hour before the announcement.
- If an announcement is scheduled less than one hour ahead, the reminder is sent on the next scheduler check.
- The reminder uses the selected @everyone / Flash role ping and Discord timestamps, so viewers see the time in their own timezone.
- A saved flag prevents duplicate reminders.
- Missing Flash channels no longer break scheduled announcements.
- Railway variable: `FLASH_CHANNEL_ID=1555845538551963678`.

# KIND BOSS v1.15.0

## v1.15.0 — 14-day calendar + applicant timezone scroll
- The scheduler checks the full next 14 calendar days, but the day dropdown only shows days that actually have interview times available. Days with zero slots are hidden.
- Applicants select their timezone from a 25-region scroll menu before choosing a day.
- Time choices are displayed in AM/PM using the selected timezone.
- Final Discord timestamps automatically render in each viewer’s own Discord-local timezone.
- Days with no current staff overlap clearly say that no interview times are available.

> KIND BOSS v1.11.9: Minecraft activity feed now uses square player-head thumbnails for join, leave, death, and advancement events.

KIND BOSS v1.11.3

Update: Add Second Interviewer now lists only eligible staff whose saved availability covers the confirmed interview time. If nobody is available, KIND BOSS says so.

# KIND BOSS v1.11.0

## Interview Board update
- Restores the Interview Brief before Category 1.
- Shows every question directly on each category panel.
- Current interviewer selects exactly 3 questions from the selector.
- Owner/Senior Staff+ can add a second eligible interviewer from the Interview Brief.
- With two interviewers, category leadership alternates automatically when **Complete Category** is pressed.
- Only the current interviewer can select questions, set the category score, and complete that category.
- Both assigned interviewers can save separate notes for every category.
- Current interviewer must save notes and a 0/3–3/3 score before completing the category.
- Final results retain the selected questions, category scores, and each interviewer’s notes.

All v1.10.0 scheduling, application, approval, strike, venting, ticket, announcement, and Minecraft bridge features are retained.

# KIND BOSS v1.4.2

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


## v1.4.1 — Interview Study Guides
When an interview is confirmed, KIND BOSS automatically DMs the applicant a rank-specific study guide. The guide covers the board's core subjects and target-rank focus areas without revealing the exact interview questions. This works for normal approved applications and Direct Interviews. No new Railway variables are required.

## v1.4.1 hotfix
- Fixed unrelated buttons/modals being captured by the Announcements draft wizard (the cause of `Draft expired` on Staff Applications/Strikes).
- Strike Management and Staff Application Control now discover the existing Discord panel after redeploys and automatically remove accidental duplicate panels.
- No new Railway variables are required.


## v1.4.2 interaction fix
- Staff Applications now defaults to the configured KIND SMP guild ID if `GUILD_ID` is absent.
- Staff Application interactions are logged in Railway so button/select/modal events can be diagnosed.
- Staff Application startup now logs `Staff Applications ready`.
- Existing duplicate-panel cleanup from v1.4.1 is retained.

## v1.6.0 Staff Interview Workflow
- Senior Staff+ can set weekly interview availability from Application Control.
- Availability Help explains timezone and weekly-window formatting.
- Direct Interview creates a private application channel; the selected member still completes the application form.
- KIND BOSS offers interview slots where at least two eligible interviewers overlap. Discord timestamps display confirmed times in each viewer's local timezone.
- Review staff can Confirm Interview, Reschedule, or Deny.
- Confirmed applicants receive the rank-specific study guide.
- Interview Room uses Start Interview, then 8 categories. The interviewer selects exactly 3 questions per category and grades the category 0/3, 1/3, 2/3, or 3/3.
- Final result is /24 and is sent to Final Approval. Finishing the interview never auto-promotes the applicant.
- Final approval remains Owner/Co-Owner OR two Senior Staff approvals.


## v1.6.0 — Temporary interview rooms

The permanent `🎙️・interview-room` channel is no longer used. When an interview is confirmed, KIND BOSS creates a private temporary text interview room plus a private voice channel under the Staff Applications category. The live board, question selection, category-by-category 0/3–3/3 grading, and notes are handled in the temporary text room. After **Finish Interview** successfully posts the locked results to `🏆・final-approval`, both temporary interview channels are deleted automatically.

Remove `INTERVIEW_ROOM_CHANNEL_ID` from Railway; it is no longer required.


## v1.9.0 availability update
Senior Staff availability now uses Discord dropdowns for days, start time, end time, and timezone. Times are shown in 12-hour AM/PM format; staff no longer type military-time windows manually.


## v1.9.0 interview scheduling update
- Applicants now see real staff-overlap interview options as Discord timestamps, which render in each viewer's local timezone.
- Interview scheduling requires Owner or Co-Owner approval, or two distinct Senior Staff approvals.
- One Senior Staff approval leaves the request pending at 1/2.
- Rescheduling resets interview-time approvals and sends fresh overlapping options.


## v1.9.0 availability groups
Senior Staff can save multiple weekly availability groups with different hours, for example Monday/Wednesday/Friday 4:00 PM-8:00 PM and Saturday/Sunday 12:00 PM-5:00 PM. Use **Add This Time Group** for each schedule, then **Save All**. Applicant interview choices continue to use the combined overlap of all saved groups.


## v1.9.2 scheduling order
Applicants and Direct Interview test users now choose an available interview time first. After selecting a time, KIND BOSS unlocks the application form. The selected time and completed form are then submitted together to application review. Self-interview testing is supported.


## v1.10.0 scheduling UX
Applicants now choose an available day first, then a time, then confirm the slot before the application form unlocks. Confirmed selections are temporarily reserved for 15 minutes while the applicant completes the form. The final confirmation uses Discord timestamps so each applicant sees the selected interview time in their own Discord timezone.


## v1.11.3 self-interview testing fix
- Owner/Co-Owner can run applicant-side controls on Direct Interview applications for testing, including choosing day/time, confirming the slot, opening/submitting the form, and completing the interview flow.
- Normal/public applications still enforce applicant ownership.
- Direct Interview modal submissions retain the leadership authorization check.


## v1.11.3 applicant interview category + study guide
- Applicant application channels and temporary interview text/voice channels are created under category `1556044316991029288` by default.
- Override with `APPLICANT_INTERVIEW_CATEGORY_ID` if needed.
- Interview confirmations include the full staff study guide link.
- Override the guide with `STAFF_STUDY_GUIDE_URL` if the document changes.

## v1.11.5 — Owner final decision + applicant category
- Temporary interview **text and voice** channels both use `APPLICANT_INTERVIEW_CATEGORY_ID` (default `1556044316991029288`).
- Category notes are optional. Exactly 3 questions and a 0/3–3/3 score are required to complete a category.
- Finish Interview no longer asks interviewers for an announcement date/time.
- Finished results go to Final Approval and the applicant is told the decision is pending.
- Only the **Owner role** can make the final Pass / Do Not Pass decision.
- If the Owner passes the applicant, KIND BOSS then asks the Owner for the announcement date/time (AM/PM accepted) and schedules the announcement.


## v1.11.5 — AM/PM dropdown scheduling
- Removed typed announcement date/time from Staff Final Approval.
- Owner now selects announcement date, hour, minutes, and AM/PM from Discord dropdowns.
- No user-facing military/24-hour time is used in the staff interview/application scheduling flow.
- Existing interview availability and applicant scheduling continue to use select menus and AM/PM display.

## v1.11.6 interview channel placement
- Set `SENIOR_STAFF_CATEGORY_ID` to the Discord category ID for **SENIOR STAFF**.
- The private `interview-username` grading/control text channel is created there and is visible only to Senior Staff+.
- The applicant's interview voice channel stays in `APPLICANT_INTERVIEW_CATEGORY_ID=1556044316991029288`.
- After the Owner approves/passses the applicant and schedules the announcement, the applicant's private application channel receives the final result and is automatically deleted.


## v1.11.7 hotfix
- Fixed Announcement Maker buttons (including Post Now, Schedule, Cancel, calendar/time selectors, and poll controls) timing out because the announcement interaction router did not recognize their current component IDs.
- Preserves the v1.11.6 staff application/interview workflow and Railway variables.

## v1.11.8 interaction routing fix
Strike Management now ignores all non-`strike:` interactions, so applicant `sa:` controls are handled only by Staff Applications.

## v1.16.0 flash-warning scheduling fix

- Default Flash Warnings channel is now `1555845538551963678`.
- Recommended Railway variable: `FLASH_CHANNEL_ID=1555845538551963678`.
- A missing/deleted Flash Warnings channel no longer causes Confirm Schedule to fail; the announcement remains scheduled and the bot logs a warning instead.
- Released-content flash notices use the same safe channel lookup.

## v1.18.0 — Private Flash teaser
Scheduled Flash reminders now announce only that a major KIND SMP announcement is upcoming and show the Discord-localized announcement time. The reminder does not reveal the title, description, event, poll, or announcement details.

## v1.19.0 Staff Applications reliability fix
- Fixed `DiscordjsTypeError [InvalidType]: Supplied parameter is not a cached User or Role` when opening Staff Applications.
- Permission overwrites now validate Railway role IDs and Discord roles/users before creating application/interview channels.
- Missing optional role variables are skipped and logged instead of crashing the application system.
- Flash announcement behavior from v1.18.0 is unchanged.


## v1.20.0 — Persistent data across updates

KIND BOSS now keeps live bot state outside the GitHub code folder. This prevents a normal GitHub/Railway redeploy from intentionally resetting saved schedules or interview availability.

### One-time Railway setup (required)
1. In the KIND-BOSS Railway service, add a **Volume** and mount it at `/data`.
2. Add `PERSISTENT_DATA_DIR=/data`.
3. Set `STAFF_APPLICATIONS_DB_PATH=/data/staff-applications.db` (optional but recommended).
4. Keep that same Railway Volume attached for every future deployment. **Do not delete/recreate the Volume during code updates.**

Persistent data stored there includes:
- scheduled announcements and flash-warning schedules (`/data/scheduled-content.json`)
- staff interview availability (`staff_availability` in `/data/staff-applications.db`)
- staff application/interview state and settings in the same database

Future replacement ZIPs must reuse these paths and must never ship live database/data files that overwrite `/data`.

**Important migration note:** if your current deployment already has schedules/availability under an old ephemeral `./data` path, Railway cannot preserve those old files through a redeploy unless they are copied to the mounted Volume before the old deployment disappears. Once `/data` is in use, later code replacements will reuse the same history automatically.

## v1.21.0 — Persistent Intros + Interview Category Briefs
- Player intro creator panel: `1556383760209944586`
- Published intros: `1555985898615734414`
- Minecraft username is required and is used for the Minecraft head thumbnail + NameMC profile link.
- Players edit their existing intro instead of creating duplicates.
- Intro data is stored in the persistent Railway data directory.
- Staff interviews now show a brief before every category. Flow: Next category → category brief → Start Category → questions/grading.
- Existing staff application/availability database is never recreated or cleared by this update. Existing applications and saved availability remain in the same persistent SQLite database.
- Keep the same Railway volume attached at `/app/data` and do not delete it during GitHub updates.
