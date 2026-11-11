'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bank = require('../src/interviewQuestions');
const source = fs.readFileSync(path.join(__dirname, '../src/staffApplications.js'), 'utf8');

// Discord-free integration harness: run the production board functions and
// interaction branches, checking platform size limits without connecting a bot.
class Builder {
  constructor(){this.data={};this.components=[];}
  setTitle(v){assert.ok(v.length<=256);this.data.title=v;return this;}
  setDescription(v){assert.ok(v.length<=4096,`Embed too long: ${v.length}`);this.data.description=v;return this;}
  setLabel(v){assert.ok(v.length<=80);this.data.label=v;return this;}
  setCustomId(v){assert.ok(v.length<=100);this.data.customId=v;return this;}
  setStyle(v){this.data.style=v;return this;}
  setPlaceholder(v){this.data.placeholder=v;return this;}
  setMinValues(v){this.data.min=v;return this;}
  setMaxValues(v){this.data.max=v;return this;}
  setURL(v){this.data.url=v;return this;}
  addOptions(v){assert.ok(v.length<=25);for(const x of v){assert.ok(x.label.length<=100);assert.ok(x.description.length<=100);}this.data.options=v;return this;}
  addComponents(...v){this.components.push(...v.flat());assert.ok(this.components.length<=5);return this;}
}
const labels={general:'General Staff',head_general:'Head of General Staff',senior:'Senior Staff',head_senior:'Head Senior Staff',co_owner:'Co-Owner',owner:'Owner'};
function harness(target='senior', saved={}){
  let row={id:42,user_id:'applicant',target_rank:target,interview_state:JSON.stringify(saved)};
  const ctx=vm.createContext({crypto:require('node:crypto'),presenterUrl:t=>'https://example.com/board/'+t,interviewQuestions:bank,EmbedBuilder:Builder,ActionRowBuilder:Builder,ButtonBuilder:Builder,StringSelectMenuBuilder:Builder,ButtonStyle:{Primary:1,Secondary:2,Success:3},rank:key=>({label:labels[key]}),STAFF_STUDY_GUIDE_URL:'https://example.com/study',seniorPlus:()=>true,m:{},eph:(_i,message)=>message,appById:()=>({...row})});
  const board=source.slice(source.indexOf('const LEGACY_CATEGORIES='),source.indexOf('async function createInterview('));
  vm.runInContext(board,ctx);
  vm.runInContext(source.slice(source.indexOf('function studyGuideEmbed('),source.indexOf('function availabilityHelp(')),ctx);
  vm.runInContext(source.slice(source.indexOf('function resultPages('),source.indexOf('\n}',source.indexOf('function resultPages('))+2),ctx);
  ctx.saveState=(_id,s)=>{row.interview_state=JSON.stringify(s);};
  return {ctx,row:()=>({...row}),run:async(action,extra={})=>{
    let payload;
    ctx.i={isButton:()=>true,customId:`sa:${action}:42`,user:{id:'lead'},update:async x=>{payload=x;},...extra};
    const marker=`if(i.isButton()&&i.customId.startsWith('sa:${action}:'))`;
    const start=source.indexOf(marker);assert.ok(start>=0);
    const end=source.indexOf('\n',start);
    const result=await vm.runInContext(`(async()=>{${source.slice(start,end)}})()`,ctx);
    return {payload,result};
  }};
}

test('six distinct rank banks cover every category with valid, unique questions',()=>{
  const seen=new Set();
  assert.equal(Object.keys(bank.QUESTIONS).length,6);
  for(const rank of Object.keys(labels)){
    assert.equal(bank.EVALUATIONS[rank].length,9);
    for(let i=0;i<9;i++){
      const cat=bank.categoryFor(rank,i);
      assert.equal(cat.qs.length,i===8?8:4);
      assert.ok(cat.evaluation&&cat.brief&&cat.source);
      for(const q of cat.qs){assert.ok(!seen.has(q),`Repeated question: ${q}`);seen.add(q);}
    }
  }
  assert.equal(seen.size,240);
  assert.throws(()=>bank.categoryFor('unknown',0),RangeError);
});

test('welcome, study guide, every category brief and question menu match each target rank',()=>{
  for(const rank of Object.keys(labels)){
    const {ctx,row}=harness(rank);
    const a=row(),s={leadInterviewer:'lead',partnerInterviewer:'partner'};
    const welcome=ctx.boardEmbed(a,s).data;
    assert.equal(welcome.title,'📋 PROMOTION BOARD BRIEF');assert.ok(welcome.description.includes('Sir, yes sir'));assert.ok(welcome.description.includes('repeated **2 times**'));
    assert.ok(welcome.description.includes(labels[rank]));
    for(const line of bank.EVALUATIONS[rank])assert.ok(welcome.description.includes(line));
    const guide=ctx.studyGuideEmbed(a).data.description;
    assert.ok(guide.includes(bank.EVALUATIONS[rank][0]));
    assert.ok(!guide.includes(bank.categoryFor(rank,0).qs[0]));
    for(let i=0;i<9;i++){
      Object.assign(s,{started:true,category:i,awaitingCategoryBrief:true});
      assert.ok(ctx.boardEmbed(a,s).data.description.includes(bank.EVALUATIONS[rank][i]));
      assert.equal(ctx.boardComponents(a,s)[0].components[0].data.label,'▶️ Start Category');
      s.awaitingCategoryBrief=false;s.selected=[0,1,2];
      const board=ctx.boardEmbed(a,s).data.description;
      const menu=ctx.boardComponents(a,s)[0].components[0].data;
      assert.equal(menu.min,3);assert.equal(menu.max,3);assert.equal(menu.options.length,i===8?8:4);
      for(const q of bank.categoryFor(rank,i).qs)assert.ok(board.includes(q));
      assert.equal(menu.options.filter(x=>x.default).length,3);
      assert.equal(ctx.boardComponents(a,s).length,i===8?3:4);
      if(i===8){assert.ok(board.includes('Unscored bonus'));for(const prompt of bank.BONUS_PROMPTS)assert.ok(board.includes(prompt));}
    }
  }
});

test('General to Senior flow shows welcome then all nine briefs, alternates turns and keeps scores',async()=>{
  const h=harness('senior',{started:false,leadInterviewer:'lead',partnerInterviewer:'partner'});
  const start=await h.run('startInterview');
  assert.ok(start.payload.embeds[0].data.title.includes('Category Brief'));
  assert.equal(JSON.parse(h.row().interview_state).questionBankVersion,bank.VERSION);assert.match(JSON.parse(h.row().interview_state).presenterToken,/^[a-f0-9]{32}$/);
  assert.ok((await h.run('startInterview')).result.includes('already started'));
  for(let idx=0;idx<9;idx++){
    const user=idx%2?'partner':'lead';
    const opened=await h.run('startCategory',{user:{id:user}});
    for(const q of bank.categoryFor('senior',idx).qs)assert.ok(opened.payload.embeds[0].data.description.includes(q));
    let s=JSON.parse(h.row().interview_state);s.selected=[0,1,2];if(idx<8)s.grades[idx]=3;h.ctx.saveState(42,s);
    const done=await h.run('completeCategory',{user:{id:user}});
    assert.ok(done.payload.embeds[0].data.title.includes(idx<8?'Category Brief':'All Categories Complete'));
    s=JSON.parse(h.row().interview_state);
    assert.deepEqual(s.questionHistory[idx],[0,1,2]);
    if(idx<8){assert.equal(s.category,idx+1);assert.equal(s.awaitingCategoryBrief,true);}
    else {assert.ok(done.payload.embeds[0].data.description.includes('24/24'));assert.equal(s.grades[8],undefined);}
  }
});

test('saved questions stay stable and legacy started interviews retain original indices',()=>{
  const saved=bank.snapshot('senior');saved[0].qs[0]='Previously asked question';
  const h=harness('senior',{started:true,questionBankVersion:2,questionBank:saved});
  assert.equal(h.ctx.catFor(h.row(),0).qs[0],'Previously asked question');
  const old=harness('senior',{started:true});
  assert.equal(old.ctx.catFor(old.row(),0).qs[0],'What is the main responsibility of your current staff rank?');
  assert.equal(old.ctx.catFor(old.row(),7).qs[0],'What changes when handling serious cheating investigations?');
});

test('final result pagination preserves long notes within Discord description limits',()=>{
  const {ctx}=harness();
  const blocks=Array.from({length:8},(_,i)=>`${i}: `+'question and notes '.repeat(100));
  blocks.push('Final notes: '+'X'.repeat(4000));
  const pages=ctx.resultPages(blocks);
  assert.ok(pages.length>1);
  for(const page of pages)assert.ok(page.length>0&&page.length<=3800);
  assert.equal(pages.join('').replaceAll('\n\n',''),blocks.join(''));
});

test('bonus rejects numeric grading',async()=>{
  const h=harness('senior',{started:true,category:8,leadInterviewer:'lead',selected:[0,1,2]});
  const result=await h.run('setGrade',{customId:'sa:setGrade:42:3'});
  assert.equal(result.result,'The bonus category is unscored. Use notes instead.');
  assert.equal(JSON.parse(h.row().interview_state).grades,undefined);
});

test('final approval includes the exact asked questions and bonus notes without adding bonus points',async()=>{
  const questionBank=bank.snapshot('senior');
  const grades=Object.fromEntries(Array.from({length:9},(_,i)=>[i,3]));
  const questionHistory=Object.fromEntries(Array.from({length:9},(_,i)=>[i,[0,1,2]]));
  const notes=Object.fromEntries(Array.from({length:9},(_,i)=>[i,{lead:'A'.repeat(4000),partner:'B'.repeat(4000)}]));
  const h=harness('senior',{started:true,questionBankVersion:2,questionBank,grades,questionHistory,notes});
  const sent=[];let persisted;
  h.ctx.appById=()=>({...h.row(),notes:'Z'.repeat(4000)});
  h.ctx.FINAL='final';h.ctx.text=async()=>({send:async payload=>{sent.push(payload);return {id:'summary'};}});
  h.ctx.db={prepare:()=>({run:(...args)=>{persisted=args;}})};
  vm.runInContext(source.slice(source.indexOf('async function postFinal('),source.indexOf('function resultPages(')),h.ctx);
  await h.ctx.postFinal(42);
  const last=sent.at(-1);
  assert.ok(last.embeds[0].data.description.includes('TOTAL: 24/24'));
  assert.ok(last.embeds[0].data.description.includes('Bonus / Troll Check: **Unscored**'));
  assert.equal(persisted[1],24);
  const details=sent.slice(0,-1).map(x=>x.embeds[0].data.description).join('\n');
  for(const cat of questionBank)for(const q of cat.qs.slice(0,3))assert.ok(details.includes(q));
  assert.ok(details.includes('A'.repeat(350)));
  assert.equal(last.components[0].components.length,2);
});

test('every rank has its own scored categories',()=>{
  const names=Object.keys(labels).map(r=>bank.categoriesFor(r).slice(0,8).map(c=>c.name).join('|'));
  assert.equal(new Set(names).size,6);
  for(const r of Object.keys(labels)){const cats=bank.categoriesFor(r);assert.equal(cats.length,bank.CATEGORY_COUNT);assert.equal(new Set(cats.map(c=>c.key)).size,9);assert.ok(cats[8].bonus);}
});

test('screen share shows one selected question at a time with a timer and two repeats',async()=>{
  const h=harness('general',{started:true,questionBankVersion:bank.VERSION,questionBank:bank.snapshot('general'),category:0,leadInterviewer:'lead',selected:[3,0,2],grades:{},notes:{}});
  h.ctx.rank=key=>({label:labels[key]});
  assert.equal(h.ctx.presenterState(h.row()).phase,'waiting');
  for(let n=0;n<3;n++){
    await h.run('showQ');
    const st=h.ctx.presenterState(h.row());
    assert.equal(st.phase,'question');assert.equal(st.number,n+1);assert.equal(st.seconds,60);
    assert.equal(st.question,bank.categoryFor('general',0).qs[[3,0,2][n]]);
  }
  assert.ok((await h.run('showQ')).result.includes('All 3 questions'));
  await h.run('repeatQ');await h.run('repeatQ');
  assert.equal(h.ctx.presenterState(h.row()).repeats,2);
  assert.ok((await h.run('repeatQ')).result.includes('No repeats left'));
  let s=JSON.parse(h.row().interview_state);s.grades[0]=2;h.ctx.saveState(42,s);
  await h.run('completeCategory');
  assert.equal(JSON.parse(h.row().interview_state).live,null);
  assert.equal(h.ctx.presenterState(h.row()).phase,'brief');
});

test('presenter page serves only valid tokens',async()=>{
  const {startBoardPresenter}=require('../src/boardPresenter');
  const good='a'.repeat(32);
  const server=startBoardPresenter({port:0,lookup:t=>t===good?{phase:'waiting',rank:'Senior Staff'}:null});
  await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/board/`;
  try{
    assert.equal((await fetch(base+good)).status,200);
    const st=await (await fetch(base+good+'/state')).json();assert.equal(st.phase,'waiting');assert.ok(st.now);
    assert.equal((await fetch(base+'b'.repeat(32))).status,404);
    assert.equal((await fetch(base+'../etc')).status,404);
  }finally{server.close();}
});

test('practice boards are labelled, can be ended, and summarise scores',()=>{
  const {ctx,row}=harness('senior');
  const a={...row(),source:'practice'},s={leadInterviewer:'lead'};
  assert.ok(ctx.boardEmbed(a,s).data.title.startsWith('🧪 PRACTICE'));
  const rows=ctx.boardComponents(a,s);
  assert.equal(rows.at(-1).components[0].data.customId,'sa:endPractice:42');
  assert.ok(!ctx.boardComponents(row(),s).some(r=>r.components.some(c=>String(c.data.customId).startsWith('sa:endPractice'))));
  Object.assign(s,{started:true,category:0,awaitingCategoryBrief:false,selected:[0,1,2]});
  assert.ok(ctx.boardComponents(a,s).length<=5);
  const sum=ctx.practiceSummary(a,{grades:{0:3,1:2}});
  assert.ok(sum.includes('5/24'));assert.ok(sum.includes(bank.categoriesFor('senior')[0].name));
});
