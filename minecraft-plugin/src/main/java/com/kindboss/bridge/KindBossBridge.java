package com.kindboss.bridge;

import io.papermc.paper.advancement.AdvancementDisplay;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.command.*;
import org.bukkit.plugin.Plugin;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.net.http.*;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class KindBossBridge extends JavaPlugin implements Listener, CommandExecutor {
    private HttpClient http;
    private String baseUrl, secret;
    private boolean strikePollBusy;
    private boolean staffRankPollBusy;
    private boolean appealReversalPollBusy;
    private boolean teamSyncBusy;
    private boolean bountyPollBusy;
    private final PlainTextComponentSerializer plain = PlainTextComponentSerializer.plainText();

    @Override public void onEnable() {
        saveDefaultConfig();
        baseUrl = getConfig().getString("bridge-url", "").replaceAll("/+$", "");
        secret = getConfig().getString("bridge-secret", "");
        http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        Bukkit.getPluginManager().registerEvents(this, this);
        if (getCommand("strike") != null) getCommand("strike").setExecutor(this);
        for (Player p : Bukkit.getOnlinePlayers()) syncPlayer(p);
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::pollApprovedStrikeActions, 60L, 100L);
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::pollApprovedStaffRankActions, 80L, 100L);
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::pollApprovedAppealReversals, 100L, 100L);
        // Sample from the main thread so Bukkit's online-player collection is never read asynchronously.
        Bukkit.getScheduler().runTaskTimer(this, () -> {
            postActivePlayerSample();
        }, 40L, 400L);
        // Reconcile team Discord rooms at startup and periodically so newly
        // approved application links receive access even if no team command ran.
        Bukkit.getScheduler().runTaskTimer(this, this::postTeamSnapshot, 100L, 12000L);
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::pollBountyActions, 120L, 100L);
        postEvent("server_online", null, null);
        getLogger().info("KIND BOSS bridge + activity feed enabled for Paper 1.21.11.");
    }

    @Override public void onDisable() {
        // Best effort synchronous send so Railway can receive the offline event before shutdown completes.
        if (baseUrl == null || secret == null || baseUrl.isBlank() || secret.isBlank() || secret.equals("CHANGE_ME")) return;
        String body = "{\"type\":\"server_offline\"}";
        HttpRequest req = request("/api/v1/minecraft/event", body);
        try { http.send(req, HttpResponse.BodyHandlers.discarding()); } catch (Exception ignored) {}
    }

    @EventHandler public void onJoin(PlayerJoinEvent e) {
        syncPlayer(e.getPlayer());
        postEvent("join", e.getPlayer(), null);
        // Refresh the goal card as soon as the tab list changes instead of
        // waiting for the regular 20-second sample.
        postActivePlayerSample();
    }

    @EventHandler public void onQuit(PlayerQuitEvent e) {
        postEvent("leave", e.getPlayer(), null);
        // Bukkit removes the quitter after this event, so sample next tick.
        Bukkit.getScheduler().runTask(this, this::postActivePlayerSample);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTeamCommand(PlayerCommandPreprocessEvent event) {
        String[] parts = event.getMessage().trim().replaceFirst("^/", "").split("\\s+");
        if (parts.length < 2 || !parts[0].equalsIgnoreCase("team")) return;
        String action = parts[1].toLowerCase(Locale.ROOT);
        if (!List.of("create", "join", "leave", "kick", "disband", "invite").contains(action)) return;
        // Let CraftedCore finish changing its saved membership before reading it.
        Bukkit.getScheduler().runTaskLater(this, this::postTeamSnapshot, 1L);
    }

    @EventHandler public void onAdvancement(PlayerAdvancementDoneEvent e) {
        AdvancementDisplay display = e.getAdvancement().getDisplay();
        if (display == null || !display.doesAnnounceToChat()) return;
        postEvent("advancement", e.getPlayer(), plain.serialize(display.title()));
    }

    @EventHandler public void onDeath(PlayerDeathEvent e) {
        String death = e.deathMessage() == null ? e.getPlayer().getName() + " died" : plain.serialize(e.deathMessage());
        postEvent("death", e.getPlayer(), death);
    }

    private void postEvent(String type, Player p, String message) {
        StringBuilder body = new StringBuilder("{\"type\":\"").append(esc(type)).append("\"");
        if (p != null) body.append(",\"uuid\":\"").append(esc(p.getUniqueId().toString())).append("\",\"username\":\"").append(esc(p.getName())).append("\"");
        if (message != null) body.append(",\"message\":\"").append(esc(message)).append("\"");
        body.append("}");
        post("/api/v1/minecraft/event", body.toString());
    }

    private void postActivePlayerSample() {
        post("/api/v1/minecraft/event", "{\"type\":\"active_sample\",\"onlinePlayers\":" + Bukkit.getOnlinePlayers().size() + "}");
    }

    private void postTeamSnapshot() {
        if (teamSyncBusy || !configured(null)) return;
        try {
            Plugin core = kindCorePlugin();
            if (core == null || !core.isEnabled()) return;
            // CraftedCore keeps its shared store in a superclass. Search the
            // whole hierarchy instead of only CraftedCore145 itself.
            Field storeField = findField(core.getClass(), "store");
            storeField.setAccessible(true);
            Object store = storeField.get(core);
            Field dataField = store.getClass().getDeclaredField("data");
            dataField.setAccessible(true);
            Object data = dataField.get(store);
            Method sectionMethod = data.getClass().getMethod("getConfigurationSection", String.class);
            Object teamsSection = sectionMethod.invoke(data, "teams");
            List<String> teamKeys = teamsSection == null ? List.of() : new ArrayList<>((Collection<String>) teamsSection.getClass().getMethod("getKeys", boolean.class).invoke(teamsSection, false));
            StringBuilder body = new StringBuilder("{\"type\":\"team_sync\",\"teams\":[");
            boolean firstTeam = true;
            for (String key : teamKeys) {
                String root = "teams." + key;
                String rawId = (String) data.getClass().getMethod("getString", String.class).invoke(data, root + ".id");
                UUID teamId = rawId == null ? UUID.nameUUIDFromBytes(("kind-smp-team:" + key).getBytes(StandardCharsets.UTF_8)) : UUID.fromString(rawId);
                Collection<String> members = (Collection<String>) data.getClass().getMethod("getStringList", String.class).invoke(data, root + ".members");
                if (!firstTeam) body.append(',');
                firstTeam = false;
                body.append("{\"id\":\"").append(esc(teamId.toString())).append("\",\"name\":\"").append(esc(key.toLowerCase(Locale.ROOT))).append("\",\"members\":[");
                boolean firstMember = true;
                for (String rawMember : members) {
                    UUID memberId;
                    try { memberId = UUID.fromString(rawMember); } catch (IllegalArgumentException ignored) { continue; }
                    String username = (String) data.getClass().getMethod("getString", String.class).invoke(data, "players." + memberId + ".name");
                    if (username == null || !username.matches("[A-Za-z0-9_]{1,16}")) {
                        Player online = Bukkit.getPlayer(memberId);
                        username = online == null ? null : online.getName();
                    }
                    if (username == null || !username.matches("[A-Za-z0-9_]{1,16}")) continue;
                    if (!firstMember) body.append(',');
                    firstMember = false;
                    body.append("{\"uuid\":\"").append(memberId).append("\",\"username\":\"").append(esc(username)).append("\"}");
                }
                body.append("]}");
            }
            body.append("]}");
            teamSyncBusy = true;
            HttpRequest req = request("/api/v1/minecraft/event", body.toString());
            http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> {
                teamSyncBusy = false;
                if (err != null) getLogger().fine("Team Discord sync failed: " + err.getMessage());
                else if (res.statusCode() < 200 || res.statusCode() >= 300) getLogger().warning("Team Discord sync returned HTTP " + res.statusCode() + ".");
            });
        } catch (Exception e) {
            getLogger().warning("Could not read CraftedCore team membership for Discord sync: " + e.getMessage());
        }
    }

    private static Field findField(Class<?> type, String name) throws NoSuchFieldException {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            try {
                return current.getDeclaredField(name);
            } catch (NoSuchFieldException ignored) {
                // Continue through CraftedCore's parent classes.
            }
        }
        throw new NoSuchFieldException(name);
    }

    /** Public reflection API used by KindCore; the bridge owns the Railway secret. */
    public void submitBounty(String json) {
        if (json == null || json.length() > 180000 || !configured(null)) return;
        HttpRequest req = request("/bridge/bounties", json);
        http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> {
            if (err != null) getLogger().warning("Bounty submission could not reach KIND BOSS: " + err.getMessage());
            else if (res.statusCode() < 200 || res.statusCode() >= 300) getLogger().warning("Bounty submission rejected by KIND BOSS (HTTP " + res.statusCode() + "): " + res.body());
        });
    }

    /** Public reflection API used by KindCore to publish a claim/expiry/refund result. */
    public void updateBounty(String json) {
        if (json == null || json.length() > 180000 || !configured(null)) return;
        http.sendAsync(request("/bridge/bounties/update", json), HttpResponse.BodyHandlers.ofString())
            .whenComplete((res, err) -> {
                if (err != null || res.statusCode() < 200 || res.statusCode() >= 300)
                    getLogger().warning("Bounty status update could not be delivered; it will be retried by KindCore.");
            });
    }

    private void pollBountyActions() {
        if (bountyPollBusy || !configured(null)) return;
        bountyPollBusy = true;
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/bridge/bounties/actions?limit=20"))
            .timeout(Duration.ofSeconds(15)).header("Authorization", "Bearer " + secret).GET().build();
        http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> {
            if (err != null || res.statusCode() < 200 || res.statusCode() >= 300) {
                bountyPollBusy = false;
                if (err != null) getLogger().fine("Bounty action poll failed: " + err.getMessage());
                return;
            }
            try {
                List<String> actions = jsonObjects(res.body(), "actions");
                if (actions.isEmpty()) { bountyPollBusy = false; return; }
                Bukkit.getScheduler().runTask(this, () -> processBountyActions(actions));
            } catch (Exception e) {
                bountyPollBusy = false;
                getLogger().warning("Could not read bounty approval actions: " + e.getMessage());
            }
        });
    }

    private void processBountyActions(List<String> actions) {
        for (String action : actions) {
            long id = jsonNumber(action, "id", -1L);
            String bountyId = jsonString(action, "bountyId"), decision = jsonString(action, "action"), reviewer = jsonString(action, "reviewer");
            boolean done = false;
            try {
                Plugin core = kindCorePlugin();
                if (core != null && core.isEnabled() && bountyId != null && decision != null && reviewer != null) {
                    // The decision method belongs to KindCore's BountyManager,
                    // not the top-level plugin class.
                    Field bountiesField = findField(core.getClass(), "bounties");
                    bountiesField.setAccessible(true);
                    Object bounties = bountiesField.get(core);
                    if (bounties == null) throw new NoSuchFieldException("bounties manager is not ready");
                    Method decisionMethod = bounties.getClass().getDeclaredMethod("handleBountyDecision", String.class, String.class, String.class);
                    decisionMethod.setAccessible(true);
                    Object result = decisionMethod.invoke(bounties, bountyId, decision, reviewer);
                    done = Boolean.TRUE.equals(result);
                }
            } catch (ReflectiveOperationException | LinkageError e) {
                getLogger().warning("KindCore could not process bounty decision " + id + ": " + e.getMessage());
            }
            if (!done) break;
            acknowledgeBountyAction(id);
        }
        bountyPollBusy = false;
    }

    private void acknowledgeBountyAction(long id) {
        String body = "{\"id\":" + id + "}";
        http.sendAsync(request("/bridge/bounties/actions/ack", body), HttpResponse.BodyHandlers.discarding())
            .whenComplete((res, err) -> {
                if (err != null || res.statusCode() < 200 || res.statusCode() >= 300)
                    getLogger().warning("Bounty decision acknowledgement failed for action " + id + "; it may be retried.");
            });
    }

    /** Sends a staff-mode command audit entry through the authenticated shared API. */
    public void logStaffCommand(Player player, String command, String staffReason) {
        if (player == null) return;
        StringBuilder body = new StringBuilder("{\"type\":\"staff_command\"")
                .append(",\"uuid\":\"").append(esc(player.getUniqueId().toString())).append("\"")
                .append(",\"username\":\"").append(esc(player.getName())).append("\"")
                .append(",\"message\":\"").append(esc(command == null ? "" : command)).append("\"")
                .append(",\"staffReason\":\"").append(esc(staffReason == null ? "" : staffReason)).append("\"}");
        post("/api/v1/minecraft/event", body.toString());
    }

    private void syncPlayer(Player p) {
        post("/api/v1/players/upsert", "{\"uuid\":\""+esc(p.getUniqueId().toString())+"\",\"username\":\""+esc(p.getName())+"\"}");
    }

    private void pollApprovedStrikeActions() {
        if (strikePollBusy || !configured(null)) return;
        strikePollBusy = true;
        long cursor = getConfig().getLong("strike-action-cursor", -1L);
        String path = "/api/v1/strikes/actions?after=" + Math.max(0L, cursor) + "&limit=100";
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(Duration.ofSeconds(15))
                .header("Authorization", "Bearer " + secret).GET().build();
        http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> {
            if (err != null || res.statusCode() < 200 || res.statusCode() >= 300) {
                strikePollBusy = false;
                if (err != null) getLogger().fine("Strike action poll failed: " + err.getMessage());
                return;
            }
            try {
                if (cursor < 0) {
                    long latest = jsonNumber(res.body(), "latestActionId", 0L);
                    Bukkit.getScheduler().runTask(this, () -> {
                        getConfig().set("strike-action-cursor", latest);
                        saveConfig();
                        strikePollBusy = false;
                    });
                    return;
                }
                List<String> actions = jsonObjects(res.body(), "actions");
                Bukkit.getScheduler().runTask(this, () -> {
                    try {
                        long nextCursor = cursor;
                        for (String action : actions) {
                            long id = jsonNumber(action, "id", -1L);
                            if (id <= nextCursor) continue;
                            if ("add".equals(jsonString(action, "action"))) {
                                String username = jsonString(action, "username");
                                String reason = jsonString(action, "reason");
                                int total = (int) jsonNumber(action, "newTotal", 0L);
                                String punishment = jsonString(jsonObject(action, "punishment"), "type");
                                String duration = jsonString(jsonObject(action, "punishment"), "duration");
                                if (username != null && username.matches("[A-Za-z0-9_]{1,16}") && duration != null) {
                                    String safeReason = ("Approved strike level " + total + (reason == null || reason.isBlank() ? "" : ": " + reason))
                                            .replaceAll("[\\r\\n;]", " ").replace((char) 34, ' ');
                                    String command = "jail".equals(punishment)
                                            ? "jail " + username + " " + duration + " " + safeReason
                                            : "tempban " + username + " " + duration + " " + safeReason;
                                    if (!Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command)) {
                                        getLogger().warning("CraftedCore did not accept the strike punishment command for " + username + ". Cursor was not advanced.");
                                        break;
                                    }
                                }
                            }
                            nextCursor = id;
                            getConfig().set("strike-action-cursor", nextCursor);
                            saveConfig();
                        }
                    } finally { strikePollBusy = false; }
                });
            } catch (Exception e) {
                getLogger().warning("Could not read approved strike actions: " + e.getMessage());
                strikePollBusy = false;
            }
        });
    }

    private void pollApprovedStaffRankActions() {
        if (staffRankPollBusy || !configured(null)) return;
        staffRankPollBusy = true;
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1/staff/ranks/actions?limit=25"))
                .timeout(Duration.ofSeconds(15)).header("Authorization", "Bearer " + secret).GET().build();
        http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> {
            if (err != null || res.statusCode() < 200 || res.statusCode() >= 300) {
                if (err != null) getLogger().fine("Staff rank poll failed: " + err.getMessage());
                staffRankPollBusy = false;
                return;
            }
            try {
                List<String> actions = jsonObjects(res.body(), "actions");
                if (actions.isEmpty()) { staffRankPollBusy = false; return; }
                Bukkit.getScheduler().runTask(this, () -> processStaffRankActions(actions));
            } catch (Exception e) {
                getLogger().warning("Could not read approved staff rank actions: " + e.getMessage());
                staffRankPollBusy = false;
            }
        });
    }

    private void processStaffRankActions(List<String> actions) {
        for (String action : actions) {
            long id = jsonNumber(action, "id", -1L);
            long applicationId = jsonNumber(action, "applicationId", -1L);
            String username = jsonString(action, "username");
            String targetRank = jsonString(action, "targetRank");
            String minecraftRank = jsonString(action, "minecraftRank");
            String expectedRank = switch (targetRank == null ? "" : targetRank) {
                case "general" -> "general_staff";
                case "head_general" -> "head_staff_2nd";
                case "senior" -> "senior_staff";
                case "head_senior" -> "head_staff";
                case "co_owner" -> "co_owner";
                case "owner" -> "owner";
                default -> null;
            };
            boolean success = id > 0 && applicationId > 0 && username != null && username.matches("[A-Za-z0-9_]{1,16}")
                    && expectedRank != null && expectedRank.equals(minecraftRank);
            String error = success ? "" : "Invalid rank action payload";
            if (success) {
                String command = "rank set " + username + " " + minecraftRank;
                success = Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
                if (!success) error = "CraftedCore did not accept /rank set";
                else getLogger().info("Submitted approved staff rank " + minecraftRank + " for " + username + " (application #" + applicationId + ").");
            }
            acknowledgeStaffRankAction(id, success, error);
        }
        staffRankPollBusy = false;
    }

    private void acknowledgeStaffRankAction(long id, boolean success, String error) {
        if (id < 1) return;
        String body = "{\"id\":" + id + ",\"success\":" + success + ",\"error\":\"" + esc(error) + "\"}";
        HttpRequest req = request("/api/v1/staff/ranks/actions/ack", body);
        http.sendAsync(req, HttpResponse.BodyHandlers.discarding()).whenComplete((res, err) -> {
            if (err != null || res.statusCode() < 200 || res.statusCode() >= 300) {
                getLogger().warning("Could not acknowledge staff rank action #" + id + "; it will be retried.");
            }
        });
    }

    private void pollApprovedAppealReversals() {
        if (appealReversalPollBusy || !configured(null)) return;
        appealReversalPollBusy = true;
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/v1/strikes/reversals?limit=25"))
                .timeout(Duration.ofSeconds(15)).header("Authorization", "Bearer " + secret).GET().build();
        http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> {
            if (err != null || res.statusCode() < 200 || res.statusCode() >= 300) {
                if (err != null) getLogger().fine("Appeal reversal poll failed: " + err.getMessage());
                appealReversalPollBusy = false;
                return;
            }
            try {
                List<String> actions = jsonObjects(res.body(), "actions");
                if (actions.isEmpty()) { appealReversalPollBusy = false; return; }
                Bukkit.getScheduler().runTask(this, () -> processAppealReversals(actions));
            } catch (Exception e) {
                getLogger().warning("Could not read approved appeal reversals: " + e.getMessage());
                appealReversalPollBusy = false;
            }
        });
    }

    private void processAppealReversals(List<String> actions) {
        for (String action : actions) {
            long id = jsonNumber(action, "id", -1L);
            String username = jsonString(action, "username");
            String reason = jsonString(action, "reason");
            boolean success = id > 0 && username != null && username.matches("[A-Za-z0-9_]{1,16}");
            String error = success ? "" : "Invalid appeal reversal payload";
            if (success) {
                String safeReason = ("Approved strike appeal" + (reason == null || reason.isBlank() ? "" : ": " + reason))
                        .replaceAll("[\\r\\n;]", " ").replace((char) 34, ' ');
                if (safeReason.length() > 350) safeReason = safeReason.substring(0, 350);
                boolean unban = Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "unban " + username + " " + safeReason);
                boolean unjail = Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "unjail " + username + " " + safeReason);
                success = unban && unjail;
                if (!success) error = "CraftedCore did not accept both unban and unjail commands";
                else getLogger().info("Reversed Minecraft ban/jail for " + username + " after an owner-approved strike appeal.");
            }
            acknowledgeAppealReversal(id, success, error);
        }
        appealReversalPollBusy = false;
    }

    private void acknowledgeAppealReversal(long id, boolean success, String error) {
        if (id < 1) return;
        String body = "{\"id\":" + id + ",\"success\":" + success + ",\"error\":\"" + esc(error) + "\"}";
        HttpRequest req = request("/api/v1/strikes/reversals/ack", body);
        http.sendAsync(req, HttpResponse.BodyHandlers.discarding()).whenComplete((res, err) -> {
            if (err != null || res.statusCode() < 200 || res.statusCode() >= 300) {
                getLogger().warning("Could not acknowledge appeal reversal #" + id + "; it will be retried.");
            }
        });
    }

    private static List<String> jsonObjects(String json, String field) {
        List<String> objects = new ArrayList<>();
        int array = json.indexOf("\"" + field + "\"");
        int start = array < 0 ? -1 : json.indexOf('[', array);
        if (start < 0) return objects;
        boolean quoted = false, escaped = false;
        int depth = 0, objectStart = -1;
        for (int i = start + 1; i < json.length(); i++) {
            char ch = json.charAt(i);
            if (quoted) {
                if (escaped) escaped = false;
                else if (ch == '\\') escaped = true;
                else if (ch == '"') quoted = false;
                continue;
            }
            if (ch == '"') { quoted = true; continue; }
            if (ch == '{') { if (depth++ == 0) objectStart = i; }
            else if (ch == '}' && depth > 0 && --depth == 0) objects.add(json.substring(objectStart, i + 1));
            else if (ch == ']' && depth == 0) break;
        }
        return objects;
    }

    private static String jsonObject(String json, String field) {
        Matcher m = Pattern.compile("\\\"" + Pattern.quote(field) + "\\\"\\s*:\\s*(\\{[^{}]*})").matcher(json);
        return m.find() ? m.group(1) : "";
    }

    private static String jsonString(String json, String field) {
        Matcher m = Pattern.compile("\\\"" + Pattern.quote(field) + "\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"").matcher(json);
        if (!m.find()) return null;
        return m.group(1).replace("\\\\\"", "\"").replace("\\\\n", " ").replace("\\\\r", " ").replace("\\\\\\\\", "\\");
    }

    private static long jsonNumber(String json, String field, long fallback) {
        Matcher m = Pattern.compile("\\\"" + Pattern.quote(field) + "\\\"\\s*:\\s*(-?\\d+)").matcher(json);
        if (!m.find()) return fallback;
        try { return Long.parseLong(m.group(1)); } catch (NumberFormatException ignored) { return fallback; }
    }

    private static String safeChatText(String value) {
        return value == null ? "unknown" : value.replaceAll("[\\r\\n§]", "");
    }

    private void sendActiveStrikeList(String response, CommandSender sender) {
        List<String> players = jsonObjects(response, "players");
        if (players.isEmpty()) {
            sender.sendMessage("§eNo players currently have active strikes.");
            return;
        }
        sender.sendMessage("§6Active strikes (Minecraft and linked Discord accounts):");
        for (String player : players) {
            String username = safeChatText(jsonString(player, "username"));
            String discordId = jsonString(player, "discordUserId");
            String discord = discordId == null || discordId.isBlank() ? "not linked" : "ID " + safeChatText(discordId);
            long total = jsonNumber(player, "total", 0L);
            sender.sendMessage("§eMinecraft: §f" + username + " §8| §9Discord: §f" + discord + " §8| §cStrikes: " + total);
        }
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!isStaffSender(sender)) { sender.sendMessage("§cOnly a CraftedCore staff rank can manage strikes."); return true; }
        if (args.length == 1 && args[0].equalsIgnoreCase("list")) { get("/api/v1/strikes/active", sender); return true; }
        if (args.length < 4 || !(args[0].equalsIgnoreCase("add") || args[0].equalsIgnoreCase("remove"))) {
            sender.sendMessage("§e/strike add <player> <amount> <reason>");
            sender.sendMessage("§e/strike remove <player> <amount> <reason>");
            sender.sendMessage("§e/strike list"); return true;
        }
        int amount; try { amount = Integer.parseInt(args[2]); } catch (Exception e) { sender.sendMessage("§cAmount must be a number."); return true; }
        if (amount < 1) { sender.sendMessage("§cAmount must be at least 1."); return true; }
        String reason = String.join(" ", java.util.Arrays.copyOfRange(args, 3, args.length));
        Player target = Bukkit.getPlayerExact(args[1]);
        if (target != null) {
            submitStrike(target.getUniqueId().toString(), target.getName(), args[0], amount, reason, sender);
        } else {
            resolveOfflinePlayer(args[1], args[0], amount, reason, sender);
        }
        return true;
    }

    private boolean isStaffSender(CommandSender sender) {
        if (sender instanceof ConsoleCommandSender || sender instanceof RemoteConsoleCommandSender) return true;
        if (!(sender instanceof Player player)) return false;
        Plugin core = kindCorePlugin();
        if (core == null || !core.isEnabled()) return false;
        try { return Boolean.TRUE.equals(core.getClass().getMethod("canManageStrikes", UUID.class).invoke(core, player.getUniqueId())); }
        catch (ReflectiveOperationException | LinkageError ex) { return false; }
    }

    private void resolveOfflinePlayer(String username, String action, int amount, String reason, CommandSender sender) {
        if (!configured(sender)) return;
        String path = "/api/v1/players/resolve?username=" + java.net.URLEncoder.encode(username, StandardCharsets.UTF_8);
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(Duration.ofSeconds(15))
                .header("Authorization", "Bearer " + secret).GET().build();
        http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> Bukkit.getScheduler().runTask(this, () -> {
            if (err != null) sender.sendMessage("§cCould not find that player: " + err.getMessage());
            else if (res.statusCode() == 404) sender.sendMessage("§cUnknown player. They must have joined the SMP at least once.");
            else if (res.statusCode() < 200 || res.statusCode() >= 300) sender.sendMessage("§cPlayer lookup failed with HTTP " + res.statusCode() + ".");
            else {
                String uuid = jsonString(res.body(), "uuid"), name = jsonString(res.body(), "username");
                if (uuid == null || name == null) sender.sendMessage("§cPlayer lookup returned incomplete data.");
                else submitStrike(uuid, name, action, amount, reason, sender);
            }
        }));
    }

    private void submitStrike(String uuid, String username, String action, int amount, String reason, CommandSender sender) {
        String body = "{\"playerUuid\":\"" + esc(uuid) + "\",\"username\":\"" + esc(username) + "\",\"action\":\"" + esc(action.toLowerCase()) + "\",\"amount\":" + amount + ",\"reason\":\"" + esc(reason) + "\",\"source\":\"minecraft\",\"staffIdentity\":\"" + esc(sender.getName()) + "\"}";
        postWithReply("/api/v1/strikes/action", body, sender);
    }

    private HttpRequest request(String path, String body) {
        return HttpRequest.newBuilder(URI.create(baseUrl+path)).timeout(Duration.ofSeconds(15)).header("Authorization", "Bearer "+secret).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
    }
    private void post(String path, String body) { postWithReply(path, body, null); }
    private void postWithReply(String path, String body, CommandSender sender) {
        if (!configured(sender)) return;
        http.sendAsync(request(path, body), HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> Bukkit.getScheduler().runTask(this, () -> {
            if (sender == null) return;
            if (err != null) sender.sendMessage("§cBridge error: "+err.getMessage());
            else if (res.statusCode() >= 200 && res.statusCode() < 300) {
                String username = safeChatText(jsonString(res.body(), "username"));
                String discordId = jsonString(res.body(), "discordUserId");
                String account = discordId == null || discordId.isBlank() ? "Discord not linked through an accepted application" : "Discord ID " + safeChatText(discordId);
                if (res.body().contains("\"pending\":true")) {
                    sender.sendMessage("§eStrike proposal for Minecraft §f" + username + " §e(" + account + ") sent for owner approval. No strike change applies until approval.");
                } else {
                    sender.sendMessage("§aStrike update for Minecraft §f" + username + " §a(" + account + ") recorded.");
                }
            }
            else sender.sendMessage("§cBridge returned HTTP "+res.statusCode()+": "+res.body());
        }));
    }
    private void get(String path, CommandSender sender) {
        if (!configured(sender)) return;
        HttpRequest req=HttpRequest.newBuilder(URI.create(baseUrl+path)).timeout(Duration.ofSeconds(15)).header("Authorization","Bearer "+secret).GET().build();
        http.sendAsync(req,HttpResponse.BodyHandlers.ofString()).whenComplete((res,err)->Bukkit.getScheduler().runTask(this,()-> {
            if (err != null) sender.sendMessage("§cBridge error: " + err.getMessage());
            else if (res.statusCode() < 200 || res.statusCode() >= 300) sender.sendMessage("§cBridge returned HTTP " + res.statusCode() + ".");
            else sendActiveStrikeList(res.body(), sender);
        }));
    }
    private boolean configured(CommandSender sender) {
        boolean ok=baseUrl != null && secret != null && !baseUrl.isBlank() && !secret.isBlank() && !secret.equals("CHANGE_ME");
        if (!ok && sender != null) sender.sendMessage("§cConfigure bridge-url and bridge-secret in plugins/KindBossBridge/config.yml");
        return ok;
    }
    private Plugin kindCorePlugin() {
        Plugin core = Bukkit.getPluginManager().getPlugin("KindCore");
        return core != null ? core : Bukkit.getPluginManager().getPlugin("CraftedCore");
    }
    private static String esc(String s) { return s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n").replace("\r","\\r"); }
}

