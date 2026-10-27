import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { config } from '../src/config.js';
import { createDiscord } from '../src/discord.js';
import { submit } from '../src/applications.js';

function fixture(t,staffRole=false) {
  const s=new Store(':memory:'),c=config({});
  const app=submit(s,'applicant',{edition:'java',username:'KindPlayer',age:'13',rules:'yes',heard:'Friend',why:'Build together',youtube:''},c.cooldown);
  const {client}=createDiscord(s,c,{});
  t.after(async()=>{await client.destroy();s.close();});
  const responses=[];
  const roleAdds=[];
  const i={guildId:c.guild,user:{id:'reviewer'},customId:`approve:${app}`,isChatInputCommand:()=>false,isButton:()=>true,isModalSubmit:()=>false,
    guild:{members:{fetch:async target=>{const userId=typeof target==='string'?target:target.user;return {roles:{cache:new Map(userId==='reviewer' && staffRole ? [[c.staffRoles[0],{}]] : []),add:async(role,reason)=>roleAdds.push({userId,role,reason})}};}}},
    deferReply:async()=>{i.deferred=true;},reply:async data=>{responses.push(data);i.replied=true;},editReply:async data=>responses.push(data)};
  return {s,c,app,client,i,responses,roleAdds,handle:client.listeners('interactionCreate')[0]};
}
test('A non-staff member cannot approve even using a forged button ID',async t=>{
  const f=fixture(t,false); await f.handle(f.i);
  assert.equal(f.s.one('SELECT state FROM applications').state,'pending');
  assert.equal(f.s.one('SELECT count(*) AS n FROM jobs').n,0);
  assert.match(f.responses[0].content,/Only the configured/);
});
test('A staff interaction queues whitelist work and refuses a second decision',async t=>{
  const f=fixture(t,true); await f.handle(f.i);
  assert.equal(f.s.one('SELECT state FROM applications').state,'approved');
  assert.equal(f.s.one('SELECT count(*) AS n FROM jobs').n,1);
  assert.deepEqual(f.roleAdds,[{userId:'applicant',role:f.c.memberRole,reason:'Kind SMP application approved'}]);
  assert.equal(f.s.one('SELECT role_done FROM applications').role_done,1);
  await f.handle(f.i);
  assert.match(f.responses.at(-1).content,/already reviewed/);
});

test('A foreign-authored application message cannot block status updates or role retries',async t=>{
  const s=new Store(':memory:'),c=config({});
  const app=submit(s,'applicant',{edition:'java',username:'KindPlayer',age:'13',rules:'yes',heard:'Friend',why:'Build together',youtube:''},c.cooldown);
  s.run("UPDATE applications SET state='ready',reviewer='staff',log_id='legacy-message',notification_done=0 WHERE id=?",app);
  let roleAdded=false; const posted=[];
  const applicant={roles:{add:async()=>{roleAdded=true;}}};
  const guild={members:{fetch:async()=>applicant},roles:{fetch:async()=>null}};
  const oldMessage={embeds:[],edit:async()=>{const error=new Error('Cannot edit a message authored by another user');error.code=50005;throw error;}};
  const channel={guildId:c.guild,guild,isTextBased:()=>true,send:async body=>{posted.push(body);return {id:'replacement-message'};},messages:{fetch:async()=>oldMessage}};
  const fakeClient={isReady:()=>true,once:()=>{},on:()=>{},guilds:{fetch:async()=>guild},channels:{fetch:async()=>channel},users:{fetch:async()=>{throw new Error('unexpected DM');}}};
  const {maintenance}=createDiscord(s,c,{},fakeClient);
  try {
    await maintenance();
    assert.equal(roleAdded,true);
    assert.equal(s.one('SELECT role_done FROM applications WHERE id=?',app).role_done,1);
    assert.equal(s.one('SELECT log_id FROM applications WHERE id=?',app).log_id,'replacement-message');
    assert.equal(s.one('SELECT notification_done FROM applications WHERE id=?',app).notification_done,1);
    assert.match(posted[0].embeds[0].data.description,/Minecraft whitelist: complete/);
  } finally { s.close(); }
});

test('Member role errors are saved and posted to the staff log',async t=>{
  const s=new Store(':memory:'),c=config({});
  const app=submit(s,'applicant',{edition:'java',username:'KindPlayer',age:'13',rules:'yes',heard:'Friend',why:'Build together',youtube:''},c.cooldown);
  s.run("UPDATE applications SET state='approved',log_id='existing-message',notification_done=1 WHERE id=?",app);
  const posted=[];
  const guild={members:{fetch:async()=>({roles:{add:async()=>{const error=new Error('Missing Permissions');error.code=50013;throw error;}}})},roles:{fetch:async()=>null}};
  const channel={guildId:c.guild,guild,isTextBased:()=>true,send:async body=>{posted.push(body);return {id:'staff-notice'};},messages:{fetch:async()=>({embeds:[],edit:async()=>{}})}};
  const fakeClient={isReady:()=>true,once:()=>{},on:()=>{},guilds:{fetch:async()=>guild},channels:{fetch:async()=>channel},users:{fetch:async()=>{throw new Error('unexpected DM');}}};
  const {maintenance}=createDiscord(s,c,{},fakeClient);
  try {
    await maintenance();
    assert.equal(s.one('SELECT role_done FROM applications WHERE id=?',app).role_done,0);
    assert.match(s.get('discordError'),/Discord 50013/);
    assert.match(posted[0].content,/Move the bot role above SMP Members/);
  } finally { s.close(); }
});

test('Discord Unknown Member cancels the application, stops role retries, and privately asks them to reapply',async t=>{
  const s=new Store(':memory:'),c=config({});
  const app=submit(s,'departed-member',{edition:'java',username:'KindPlayer',age:'13',rules:'yes',heard:'Friend',why:'Build together',youtube:''},c.cooldown);
  s.run("UPDATE applications SET state='ready',role_done=0,log_id='application-message',notification_done=1 WHERE id=?",app);
  s.queue('whitelist:'+app,'whitelist',{applicationId:app});
  s.run("UPDATE jobs SET state='leased',lease='active-lease' WHERE unique_key=?",'whitelist:'+app);
  const roleFetches=[], dmMessages=[], staffPosts=[], edited=[];
  const guild={
    members:{fetch:async userId=>{roleFetches.push(userId);const error=new Error('Unknown Member');error.code=10007;throw error;}},
    roles:{fetch:async()=>null}
  };
  const channel={
    guildId:c.guild,guild,isTextBased:()=>true,
    permissionsFor:()=>null,
    send:async body=>{staffPosts.push(body);return {id:'cancel-notice'};},
    messages:{fetch:async()=>({embeds:[],edit:async body=>edited.push(body)})}
  };
  const fakeClient={
    isReady:()=>true,once:()=>{},on:()=>{},guilds:{fetch:async()=>guild},channels:{fetch:async()=>channel},
    users:{fetch:async id=>({send:async message=>dmMessages.push({id,message})})}
  };
  const {maintenance}=createDiscord(s,c,{},fakeClient);
  try {
    await maintenance();
    assert.equal(s.one('SELECT state FROM applications WHERE id=?',app).state,'cancelled');
    await maintenance(); // Outcome notification is processed on the next maintenance cycle.
    assert.equal(s.one('SELECT role_done FROM applications WHERE id=?',app).role_done,1);
    assert.equal(s.one('SELECT state FROM jobs WHERE unique_key=?','whitelist:'+app).state,'cancelled');
    assert.equal(roleFetches.length,1);
    assert.equal(dmMessages.length,1);
    assert.match(dmMessages[0].message,/rejoin the server, then use \/apply/i);
    assert.match(staffPosts[0].content,/cancelled/i);
    assert.match(edited[0].content,/Cancelled because the applicant is no longer a member/);
    assert.equal(s.ack(s.one('SELECT id FROM jobs WHERE unique_key=?','whitelist:'+app).id,'active-lease',true,{uuid:'12345678-1234-1234-1234-123456789012'}),false);

    await maintenance();
    assert.equal(roleFetches.length,1,'cancelled applications should no longer retry role assignment');
    assert.equal(dmMessages.length,1,'the applicant should receive a single reapply DM');
    assert.equal(staffPosts.length,1,'the cancellation notice should not repeat');
  } finally { s.close(); }
});

test('Staff rejection through the Discord modal requires a nonblank reason',async t=>{
  const f=fixture(t,true); f.i.customId=`rejection:${f.app}`; f.i.fields={getTextInputValue:()=> '   '};
  await f.handle(f.i); assert.equal(f.s.one('SELECT state FROM applications').state,'pending');
  f.i.fields.getTextInputValue=()=> 'Please explain why you want to join.';
  await f.handle(f.i); assert.equal(f.s.one('SELECT state FROM applications').state,'rejected');
});

for (const edition of ['java', 'bedrock']) {
  for (const youtube of ['', 'https://www.youtube.com/@KindCrafted']) {
    test(edition + ' submits the application and optional YouTube link in one form: ' + youtube, async t => {
      const f = fixture(t);
      f.i.user.id = 'new-applicant';
      f.i.customId = 'edition:' + edition;
      let modal;
      f.i.showModal = async value => { modal = value.toJSON(); };
      await f.handle(f.i);
      assert.equal(modal.components.length, 5);
      assert.match(modal.components[0].description, /By submitting.*agree/);
      const inputs = modal.components.map(label => label.component);
      assert.deepEqual(inputs.map(input => input.custom_id), ['username','age','heard','why','youtube']);
      assert.equal(inputs.at(-1).required, false);
      const values = {username: edition === 'java' ? 'NewPlayer' : 'New Player', age:'18', heard:'A friend', why:'Build together', youtube};
      f.i.customId = modal.custom_id;
      f.i.isButton = () => false;
      f.i.isModalSubmit = () => true;
      f.i.fields = {getTextInputValue: key => values[key]};
      await f.handle(f.i);
      const saved = f.s.one('SELECT * FROM applications WHERE user_id=?', f.i.user.id);
      assert.equal(saved.state, 'pending');
      assert.equal(saved.edition, edition);
      assert.deepEqual(JSON.parse(saved.answers), {...values, edition, rules:'yes'});
      assert.equal(f.s.one('SELECT count(*) AS n FROM drafts').n, 0);
      assert.match(f.responses.at(-1).content, /Application submitted/);
      await f.handle(f.i);
      assert.match(f.responses.at(-1).content, /already have/);
    });
  }
}
for (const changes of [{age:'12'}, {youtube:'https://example.com/channel'}]) {
  test('Single form rejects invalid input: ' + JSON.stringify(changes), async t => {
    const f = fixture(t);
    f.i.user.id = 'new-applicant';
    f.i.customId = 'application-single:java';
    const values = {username:'NewPlayer',age:'18',heard:'Friend',why:'Build together',youtube:'',...changes};
    f.i.fields = {getTextInputValue: key => values[key]};
    await f.handle(f.i);
    assert.equal(f.s.one('SELECT id FROM applications WHERE user_id=?', f.i.user.id), undefined);
    assert.match(f.responses.at(-1).content, /at least 13|YouTube channel URL/);
  });
}

test('Accepted member can open the same form and submit a new account through Discord',async t=>{
  const f=fixture(t); f.s.run("UPDATE applications SET state='ready',uuid=? WHERE id=?",'12345678-1234-1234-1234-123456789012',f.app);
  f.i.user.id='applicant'; f.i.customId='edition:bedrock'; let modal;
  f.i.showModal=async value=>{modal=value.toJSON();}; await f.handle(f.i);
  assert.equal(modal.custom_id,'application-single:bedrock');
  f.i.customId=modal.custom_id;
  const values={username:'New Xbox',age:'18',heard:'Already a member',why:'New account',youtube:''};
  f.i.fields={getTextInputValue:key=>values[key]}; await f.handle(f.i);
  assert.match(f.responses.at(-1).content,/Application submitted/);
  assert.equal(f.s.one("SELECT count(*) AS n FROM applications WHERE user_id='applicant'").n,2);
});
