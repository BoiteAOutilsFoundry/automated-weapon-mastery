/** Run with `node tests/regression.mjs`. Requires only Node >= 20. */
import assert from "node:assert/strict";

const registered = new Map();
const ready = [];
const messages = new Map();
const log = [];

const entries = key => registered.get(key) ?? [];
function fire(event, ...args) { for (const callback of entries(event)) callback(...args); }
async function settle() { await new Promise(resolve => setTimeout(resolve, 30)); }

globalThis.Hooks = {
  on(name, handler) { const list = entries(name); registered.set(name, [...list, handler]); },
  once(name, handler) { if (name === "ready") ready.push(handler); else this.on(name, handler); }
};
globalThis.Application = class {
  static get defaultOptions() { return {}; }
  constructor(options={}) { this.options=options; }
  activateListeners() {}
  close() { return Promise.resolve(); }
};
globalThis.foundry = {utils: {
  mergeObject: (a,b) => ({...a,...b}),
  getProperty: (o,k) => k.split(".").reduce((v,s)=>v?.[s],o),
  hasProperty: (o,k) => k.split(".").reduce((v,s)=>v?.[s],o) !== undefined
}};
globalThis.CONST = {ACTIVE_EFFECT_MODES: {ADD: 2, OVERRIDE: 5}};
globalThis.ui = {notifications:{warn:msg=>log.push(msg),error:msg=>log.push(msg)}};
globalThis.document = {createElement: () => ({
  _html:"",
  set innerHTML(value){this._html=value;},
  get innerHTML(){return this._html;},
  querySelector(selector){
    if (selector === ".midi-qol-damage-roll" && this._html.includes('midi-qol-damage-roll'))
      return {textContent: "7",querySelector(){return {}}};
    return null;
  },
  set textContent(value){ this._text=String(value);this._html=String(value); },
  get textContent(){return this._text??"";}
})};
const combat = {id:"combat1", round:1, turn:0, started:true,combatant:null,combatants:[]};
globalThis.game = {
  combat, socket:{on:()=>{},emit:()=>{}}, messages: {get:id=>messages.get(id)},
  modules: {get:id=>({active:id === "midi-qol"})},
  user: {id:"user1", isGM:true,targets:new Set()},
  users: [{id:"user1",isGM:true}],time:{worldTime:12345}
};
globalThis.canvas = {tokens:{placeables:[],get:id=>null}};
globalThis.ChatMessage = {getSpeaker:({actor})=>({actor:actor.id}),create:async()=>({})};
globalThis.fromUuid = async uuid => uuidLookup.get(uuid);
const uuidLookup = new Map();

await import("../scripts/main.js");
assert.equal(ready.length,1,"one ready handler");
ready[0]();

const expectedHooks = {
  renderItemSheet:1, "midi-qol.preAttackRoll":4,
  "midi-qol.AttackRollComplete":5,
  "dnd5e.preRollDamageV2":1,
  "midi-qol.damageRollComplete":2,
  "midi-qol.DamageRollComplete":2,
  "midi-qol.RollComplete":2,
  updateChatMessage:1,renderChatMessage:1,"dnd5e.preRollAttackV2":1,
  preUpdateActor:1,updateActor:1,preUpdateToken:1,updateToken:1,
  preUpdateCombat:1,updateCombat:1,deleteCombat:1
};
assert.deepEqual(Object.fromEntries([...registered].map(([k,v])=>[k,v.length]).sort()),
 Object.fromEntries(Object.entries(expectedHooks).sort()),"hook registration structure");

const {actorHasMastery,weaponMasteryId, hpDecreased} = await import("../scripts/common.js");
const {vexEntries} = await import("../scripts/masteries/vex.js");
function feat(weapons) { return {
  type:"feat",name:"Weapon Mastery",system:{identifier:"weapon-mastery"},
  getFlag: (_id,k) => k === "masteredWeapons" ? weapons : undefined
};}
class Effects extends Array { get(id) { return this.find(e => e.id === id); } }
let seq=0;
function makeActor(name, masteries=[], movement={walk:30}) {
  const id=++seq;
  const actor={id:`actor${id}`,uuid:`Actor.actor${id}`,name,isOwner:true,
    system:{attributes:{prof:3,hp:{value:25,temp:7},movement,spellcasting:"cha"},abilities:{str:{mod:2},dex:{mod:3},cha:{mod:5}}},
    items:masteries.map(feat),_flags:{}, effects:new Effects(),
    getFlag(scope,key){return this._flags[`${scope}.${key}`];},
    async setFlag(scope,key,value){this._flags[`${scope}.${key}`]=value;return value;},
    async createEmbeddedDocuments(type,data){for(const obj of data){const e={...obj,id:`effect${++seq}`,
      getFlag(scope,key){return this.flags?.[scope]?.[key];},
      async update(changes){Object.assign(this,changes);return this;}};this.effects.push(e);}return this.effects;},
    async deleteEmbeddedDocuments(type,ids){this.effects=Effects.from(this.effects.filter(e=>!ids.includes(e.id)));},
    async toggleStatusEffect(key,opts){this.status={key,opts};},
    async rollAbilitySave(){return {total:5,async toMessage(){}};}
  };
  uuidLookup.set(actor.uuid,actor);
  return actor;
}
function weapon(id,mastery,baseItem=id) { return {type:"weapon",uuid:`Actor.actor.Item.${++seq}`,name:`${id} weapon`,
 system:{type:{baseItem},identifier:id,mastery,damage:{base:{types:new Set(["slashing"])}}}};}
function token(actor,name="Ghoul") {const id=`token${++seq}`;
  const doc={id,uuid:`Scene.scene.Token.${id}`,actor, parent:{id:"scene"},name, width:1,height:1,x:0,y:0};
  const t={document:doc,actor,name,uuid:doc.uuid};uuidLookup.set(doc.uuid,doc);canvas.tokens.placeables.push(t);return t;
}
function workflow(actor,item,targets,opts={}) {
 return {actor,item,targets:new Set(targets),hitTargets:new Set(opts.hits??targets),
    missTargets:new Set(opts.misses??[]),attackRoll:opts.attackRoll??{total:15,options:{ability:opts.ability??"cha"}},
    damageRoll: opts.damage ?? {total:8}, activity:{uuid:`activity${++seq}`},
    itemCardId:opts.card??`msg${++seq}`,token: opts.source ?? null};
}
function hpChange(victim,kind,newVal){
 const changes={system:{attributes:{hp:{[kind]:newVal}}}},opts={};
 fire("preUpdateActor",victim,changes,opts);
 victim.system.attributes.hp[kind]=newVal;
 fire("updateActor",victim,changes,opts);
}

// Weapon identity, multiclass union, magical variants.
const attacker = makeActor("attacker",[["maul"],["rapier","greatsword","club","mace","warhammer"]]);
assert.equal(actorHasMastery(attacker,"rapier"),true);
assert.equal(actorHasMastery(attacker,"maul"),true);
assert.equal(actorHasMastery(attacker,"greataxe"),false);
assert.equal(weaponMasteryId(weapon("1-rapier","vex","rapier")),"rapier");
assert.equal(hpDecreased({system:{attributes:{hp:{temp:4}}}}, {value:25,temp:7}),true);

// Vex applied on TEMP HP damage, then grants advantage and is consumed.
const victim=makeActor("enemy");const t=token(victim);
const rapier=weapon("1-rapier","vex","rapier");
const hit=workflow(attacker,rapier,[t]);
fire("midi-qol.preAttackRoll",hit);
fire("midi-qol.AttackRollComplete",hit);
hpChange(victim,"temp",3);
await settle();
assert.equal(vexEntries(attacker).length,1,"Vex triggers from temp HP damage");
const second=workflow(attacker,rapier,[t],{damage:null});
fire("midi-qol.preAttackRoll",second);
assert.equal(second.advantage,true,"Vex advantages the next attack");
fire("midi-qol.AttackRollComplete",second);
await settle();
assert.equal(vexEntries(attacker).length,0,"Vex consumed after the attack");

// Sap is refreshed as a single effect and consumed when victim next attacks.
const mace=weapon("mace","sap");
const sapOne=workflow(attacker,mace,[t]);
fire("midi-qol.preAttackRoll",sapOne);
fire("midi-qol.AttackRollComplete",sapOne);
await settle();
assert.equal(victim.effects.filter(e=>e.getFlag("automated-weapon-mastery","sap2024")).length,0,"Sap waits for applied damage");
hpChange(victim,"value",23);
await settle();
assert.equal(victim.effects.filter(e=>e.getFlag("automated-weapon-mastery","sap2024")).length,1);
const firstSap=victim.effects.find(e=>e.getFlag("automated-weapon-mastery","sap2024"));
const sapTwo=workflow(attacker,mace,[t]);
fire("midi-qol.preAttackRoll",sapTwo);
fire("midi-qol.AttackRollComplete",sapTwo);
hpChange(victim,"value",22);
await settle();
assert.equal(victim.effects.filter(e=>e.getFlag("automated-weapon-mastery","sap2024")).length,1);
assert.equal(victim.effects[0],firstSap,"Sap refreshes existing effect");
const enemyAttack=workflow(victim,weapon("other","vex"),[token(attacker,"Attacker")]);
fire("midi-qol.preAttackRoll",enemyAttack);
assert.equal(enemyAttack.disadvantage,true);
fire("midi-qol.AttackRollComplete",enemyAttack);
await settle();
assert.equal(victim.effects.filter(e=>e.getFlag("automated-weapon-mastery","sap2024")).length,0);

// A missed attack must never leave a Sap application waiting for unrelated HP loss.
const missedSap=workflow(attacker,mace,[t],{hits:[],misses:[t]});
fire("midi-qol.preAttackRoll",missedSap);
fire("midi-qol.AttackRollComplete",missedSap);
hpChange(victim,"value",21);
await settle();
assert.equal(victim.effects.filter(e=>e.getFlag("automated-weapon-mastery","sap2024")).length,0,"missed Sap must not apply");

// Slow applies once, reduces speed by -10, and refreshes without stacking.
const club=weapon("club","slow");
const slowOne=workflow(attacker,club,[t]);
fire("midi-qol.preAttackRoll",slowOne);
hpChange(victim,"value",20);
await settle();
let slowEffects=victim.effects.filter(e=>e.getFlag("automated-weapon-mastery","slow2024"));
assert.equal(slowEffects.length,1);
assert.equal(slowEffects[0].changes[0].value,-10);
const slowTwo=workflow(attacker,club,[t]);
fire("midi-qol.preAttackRoll",slowTwo);
hpChange(victim,"value",18);
await settle();
slowEffects=victim.effects.filter(e=>e.getFlag("automated-weapon-mastery","slow2024"));
assert.equal(slowEffects.length,1);

// Topple / Push register one button flag on the original damage card.
const cardByMastery = {};
const sourceToken = token(attacker,"Attacker");
for (const [mastery,id] of [["topple","maul"],["push","warhammer"]]) {
 const card=`msg${++seq}`;
 const message={id:card,isOwner:true, content:'<div class="midi-qol-damage-roll">7</div><div class="midi-qol-hits-display">Ghoul</div>', flags:{},
 getFlag(scope,name){return this.flags[scope]?.[name];},
 async update(update){if(update.content) this.content=update.content;
    for(const [key,value] of Object.entries(update)){
      if(key.startsWith("flags.")){this.flags["automated-weapon-mastery"]??={};
        this.flags["automated-weapon-mastery"][key.split(".").slice(2).join(".")]=value;}}}
 };
 messages.set(card,message); cardByMastery[mastery]=message;
 const wf=workflow(attacker,weapon(id,mastery),[t],{card,source:sourceToken});
 fire("midi-qol.AttackRollComplete",wf);
 if (mastery==="topple") {const mod=await import("../scripts/masteries/topple.js"); await mod.toppleTryCard(card);}
 else {const mod=await import("../scripts/masteries/push.js");await mod.pushTryCard(card);}
 assert.equal(message.content.includes(`awm-${mastery}-zone`),true,`${mastery} button inserted`);
 assert.equal(message.content.includes('midi-qol-damage-roll'),true,`${mastery} preserves damage`);
 assert.equal(message.content.includes('midi-qol-hits-display'),true,`${mastery} preserves hit targets`);
}

// Topple immunity is checked before any CON save is requested.
let saves=0;
victim.system.traits={ci:{value:new Set(["prone"])},size:"med"};
const originalSave=victim.rollAbilitySave;
victim.rollAbilitySave=async (...args) => {saves++;return originalSave(...args);};
const {toppleUse}=await import("../scripts/masteries/topple.js");
await toppleUse(cardByMastery.topple);
assert.equal(saves,0,"Topple skips CON save for prone-immune targets");

// Push uses the original attack context to move the hit target, no second card.
const scene={id:"scene",grid:{type:1,distance:5,size:100},width:2000,height:2000};
t.document.parent=scene;sourceToken.document.parent=scene;
t.document.x=100;t.document.y=0;
sourceToken.document.x=0;sourceToken.document.y=0;
t.document.update=async changes => Object.assign(t.document,changes);
canvas.grid={getSnappedPosition:(x,y)=>({x:Math.round(x/100)*100,y:Math.round(y/100)*100})};
const {pushUse}=await import("../scripts/masteries/push.js");
await pushUse(cardByMastery.push);
assert.equal(t.document.x,300,"Push moves exactly 10 ft away on a 5-ft grid");

// Graze modifies exactly one existing damage roll, and does not create a card.
const gs=weapon("greatsword","graze"); gs.actor=attacker;
const miss=workflow(attacker,gs,[t],{hits:[],misses:[t]});
fire("midi-qol.AttackRollComplete",miss);
const config={subject:{uuid:miss.activity.uuid,item:gs},rolls:[{parts:["2d6 + 5"],options:{type:"slashing"}},{parts:["2d6"],options:{type:"radiant"}}]};
// The stored callback takes the native damage configuration as its argument.
entries("dnd5e.preRollDamageV2")[0](config);
assert.equal(config.rolls.length,1);
assert.deepEqual(config.rolls[0].parts,["5"]);

// No automatic Cleave or Nick listeners or UI markers introduced.
const allSource=await (await import("node:fs/promises")).readFile(new URL("../scripts/main.js",import.meta.url),"utf8");
assert.equal(allSource.includes("cleaveUse"),false);
console.log("PASS: hooks, multiclass, magical weapon, Vex/temp HP, Sap, Slow, Topple immunity, Push distance, Graze, no Cleave.");
