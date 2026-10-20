const test=require('node:test');
const assert=require('node:assert/strict');
const {formatApprovedStrikeNotice}=require('../src/strikeNotice');

test('approved strike notice shows the player, change, total, reason, and punishment',()=>{
 const notice=formatApprovedStrikeNotice(
  {username:'PlayerOne',action:'add',reason:'Repeated griefing'},
  {discordUserId:'123456789',appliedAmount:2,newTotal:5,punishment:{type:'jail',duration:'10 minutes'}}
 );
 assert.match(notice,/PlayerOne/);
 assert.match(notice,/<@123456789>/);
 assert.match(notice,/\+2 strike\(s\)/);
 assert.match(notice,/Current strikes:\*\* 5/);
 assert.match(notice,/Repeated griefing/);
 assert.match(notice,/jail · 10 minutes/);
});

test('approved strike removal is also published and handles unlinked players',()=>{
 const notice=formatApprovedStrikeNotice(
  {username:'PlayerTwo',action:'remove',reason:'Appeal correction'},
  {discordUserId:null,appliedAmount:1,newTotal:0}
 );
 assert.match(notice,/-1 strike\(s\)/);
 assert.match(notice,/No approved Discord account link/);
 assert.match(notice,/Current strikes:\*\* 0/);
 assert.doesNotMatch(notice,/Punishment:/);
});
