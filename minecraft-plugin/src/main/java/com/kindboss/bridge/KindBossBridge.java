package com.kindboss.bridge;

import org.bukkit.Bukkit;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;

public final class KindBossBridge extends JavaPlugin implements Listener, CommandExecutor {
    private HttpClient http;
    private String baseUrl, secret;

    @Override public void onEnable() {
        saveDefaultConfig();
        baseUrl = getConfig().getString("bridge-url", "").replaceAll("/+$", "");
        secret = getConfig().getString("bridge-secret", "");
        http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        Bukkit.getPluginManager().registerEvents(this, this);
        if (getCommand("strike") != null) getCommand("strike").setExecutor(this);
        for (Player p : Bukkit.getOnlinePlayers()) syncPlayer(p);
        getLogger().info("KIND BOSS bridge enabled for Paper 1.21.11.");
    }

    @EventHandler public void onJoin(PlayerJoinEvent e) { syncPlayer(e.getPlayer()); }

    private void syncPlayer(Player p) {
        post("/api/v1/players/upsert", "{\"uuid\":\""+esc(p.getUniqueId().toString())+"\",\"username\":\""+esc(p.getName())+"\"}");
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission("kindboss.strike")) { sender.sendMessage("§cNo permission."); return true; }
        if (args.length == 1 && args[0].equalsIgnoreCase("list")) {
            get("/api/v1/strikes/active", sender); return true;
        }
        if (args.length < 4 || !(args[0].equalsIgnoreCase("add") || args[0].equalsIgnoreCase("remove"))) {
            sender.sendMessage("§e/strike add <player> <amount> <reason>");
            sender.sendMessage("§e/strike remove <player> <amount> <reason>");
            sender.sendMessage("§e/strike list"); return true;
        }
        Player target = Bukkit.getPlayerExact(args[1]);
        if (target == null) { sender.sendMessage("§cPlayer must be online at least for this command."); return true; }
        int amount; try { amount = Integer.parseInt(args[2]); } catch (Exception e) { sender.sendMessage("§cAmount must be a number."); return true; }
        if (amount < 1) { sender.sendMessage("§cAmount must be at least 1."); return true; }
        String reason = String.join(" ", java.util.Arrays.copyOfRange(args, 3, args.length));
        syncPlayer(target);
        String actionId = UUID.randomUUID().toString();
        String body = "{\"actionId\":\""+actionId+"\",\"playerUuid\":\""+target.getUniqueId()+"\",\"username\":\""+esc(target.getName())+"\",\"action\":\""+args[0].toLowerCase()+"\",\"amount\":"+amount+",\"reason\":\""+esc(reason)+"\",\"source\":\"minecraft\",\"staffIdentity\":\""+esc(sender.getName())+"\"}";
        postWithReply("/api/v1/strikes/action", body, sender); return true;
    }

    private void post(String path, String body) { postWithReply(path, body, null); }
    private void postWithReply(String path, String body, CommandSender sender) {
        if (!configured(sender)) return;
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl+path)).timeout(Duration.ofSeconds(15)).header("Authorization", "Bearer "+secret).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
        http.sendAsync(req, HttpResponse.BodyHandlers.ofString()).whenComplete((res, err) -> Bukkit.getScheduler().runTask(this, () -> {
            if (sender == null) return;
            if (err != null) sender.sendMessage("§cBridge error: "+err.getMessage());
            else if (res.statusCode() >= 200 && res.statusCode() < 300) sender.sendMessage("§aKIND BOSS strike system updated. "+res.body());
            else sender.sendMessage("§cBridge returned HTTP "+res.statusCode()+": "+res.body());
        }));
    }
    private void get(String path, CommandSender sender) {
        if (!configured(sender)) return;
        HttpRequest req=HttpRequest.newBuilder(URI.create(baseUrl+path)).timeout(Duration.ofSeconds(15)).header("Authorization","Bearer "+secret).GET().build();
        http.sendAsync(req,HttpResponse.BodyHandlers.ofString()).whenComplete((res,err)->Bukkit.getScheduler().runTask(this,()-> sender.sendMessage(err!=null?"§cBridge error: "+err.getMessage():"§eActive strikes: "+res.body())));
    }
    private boolean configured(CommandSender sender) {
        boolean ok=!baseUrl.isBlank() && !secret.isBlank() && !secret.equals("CHANGE_ME");
        if (!ok && sender != null) sender.sendMessage("§cConfigure bridge-url and bridge-secret in plugins/KindBossBridge/config.yml");
        return ok;
    }
    private static String esc(String s) { return s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n").replace("\r","\\r"); }
}
