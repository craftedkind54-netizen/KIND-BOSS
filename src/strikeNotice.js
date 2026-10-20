function formatApprovedStrikeNotice(proposal,result){
 const change=proposal.action==='add'?`+${result.appliedAmount}`:`-${result.appliedAmount}`;
 const discord=result.discordUserId?`<@${result.discordUserId}>`:'No approved Discord account link';
 const lines=[
  `⚖️ **Strike update — ${proposal.username}**`,
  `**Minecraft username:** ${proposal.username}`,
  `**Discord account:** ${discord}`,
  `**Change:** ${change} strike(s)`,
  `**Current strikes:** ${result.newTotal}`,
  `**Reason:** ${(proposal.reason||'No reason provided').slice(0,900)}`,
 ];
 if(result.punishment)lines.push(`**Punishment:** ${result.punishment.type} · ${result.punishment.duration}`);
 return lines.join('\n');
}

module.exports={formatApprovedStrikeNotice};
