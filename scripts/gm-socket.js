/** Authorized GM proxy, adapted from Automated Marks (native Foundry socket). */
import { MODULE_ID, WEAPON_BY_ID, normalize, weaponMasteryId, actorHasMastery } from "./common.js";
const CHANNEL = `module.${MODULE_ID}`;
const pending = new Map();
const MARKS = {sap: "sap2024", slow: "slow2024"};
function activeGM() { return game.users.filter(u => u.active && u.isGM).sort((a,b) => a.id.localeCompare(b.id))[0] ?? null; }
function sourceAllowed(actor, item, user, mastery) {
  const id = weaponMasteryId(item);
  return actor?.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) &&
    item?.parent?.uuid === actor.uuid && item.type === "weapon" && !!id &&
    normalize(item.system?.mastery ?? WEAPON_BY_ID.get(id)?.[2]) === mastery && actorHasMastery(actor,id);
}
export async function gmRequest(operation, payload) {
  if (game.user.isGM) return execute(operation,payload,game.user);
  const gm = activeGM();
  if (!gm) throw new Error("Aucun MJ actif pour appliquer la maîtrise.");
  const id = foundry.utils.randomID();
  return new Promise((resolve,reject) => {
    const timeout = setTimeout(() => {pending.delete(id); reject(new Error("Délai de réponse MJ dépassé."));},10000);
    pending.set(id,{resolve,reject,timeout});
    game.socket.emit(CHANNEL,{kind:"request",id,operation,payload,requesterId:game.user.id,gmId:gm.id});
  });
}
export function registerGMSocket() {game.socket.on(CHANNEL, async msg => {
  if (msg?.kind === "response" && msg.recipientId === game.user.id) {
    const request = pending.get(msg.id); if (!request) return;
    clearTimeout(request.timeout); pending.delete(msg.id);
    if (msg.ok) request.resolve(msg.result); else request.reject(new Error(msg.error || "Refus MJ"));
    return;
  }
  if (msg?.kind !== "request" || !game.user.isGM || msg.gmId !== game.user.id || activeGM()?.id !== game.user.id) return;
  try {
    const requester = game.users.get(msg.requesterId);
    if (!requester) throw new Error("Joueur introuvable");
    const result = await execute(msg.operation,msg.payload,requester);
    game.socket.emit(CHANNEL,{kind:"response",id:msg.id,recipientId:requester.id,ok:true,result});
  } catch (e) {
    console.error(`${MODULE_ID} | GM proxy`,e);
    game.socket.emit(CHANNEL,{kind:"response",id:msg.id,recipientId:msg.requesterId,ok:false,error:e.message});
  }
});}
async function execute(operation,payload,user) {
  const source = await fromUuid(payload?.sourceUuid);
  const item = await fromUuid(payload?.itemUuid);
  const mastery = operation === "topple" ? "topple" : operation === "effect" ? payload?.mastery : null;
  if (!(["sap","slow","topple"].includes(mastery) && sourceAllowed(source,item,user,mastery)))
    throw new Error("Maîtrise ou acteur source non autorisé.");
  const token = await fromUuid(payload?.targetUuid);
  const victim = token?.actor ?? token;
  if (!victim || victim.documentName !== "Actor") throw new Error("Cible introuvable.");
  if (operation === "effect") {
    const marker = MARKS[mastery];
    const effects = [...victim.effects].filter(e => e.getFlag(MODULE_ID,marker) === true);
    const data = mastery === "sap" ? {
      name:"Weapon Mastery: Sap (Disadvantage)",icon:"icons/svg/daze.svg",origin:source.uuid,transfer:false,disabled:false,
      changes:[{key:"flags.midi-qol.disadvantage.attack.all",mode:CONST.ACTIVE_EFFECT_MODES.OVERRIDE,value:"1",priority:20}],
      duration:{rounds:1,startRound:game.combat?.round ?? 0,startTurn:game.combat?.turn ?? 0,startTime:game.time.worldTime},
      flags:{[MODULE_ID]:{sap2024:true,sapSource:source.uuid},dae:{specialDuration:["turnStartSource"]}}
    } : {
      name:"Weapon Mastery: Slow (-10 ft)",icon:"icons/svg/downgrade.svg",origin:source.uuid,transfer:false,disabled:false,
      changes:["walk","fly","swim","climb","burrow"].filter(t=>Number(victim.system?.attributes?.movement?.[t] ?? 0)>0)
        .map(t=>({key:`system.attributes.movement.${t}`,mode:CONST.ACTIVE_EFFECT_MODES.ADD,value:-10,priority:20})),
      duration:{rounds:1,startRound:game.combat?.round ?? 0,startTurn:game.combat?.turn ?? 0},
      flags:{[MODULE_ID]:{slow2024:true},dae:{specialDuration:["turnStartSource"]}}
    };
    if (effects[0]) await effects[0].update(data);
    else await victim.createEmbeddedDocuments("ActiveEffect",[data]);
    if (effects.length>1) await victim.deleteEmbeddedDocuments("ActiveEffect",effects.slice(1).map(e=>e.id));
    return {applied:true};
  }
  if (operation === "topple") {
    const message = game.messages.get(payload?.messageId);
    const flag = message?.getFlag(MODULE_ID,"topple");
    if (!flag || flag.state !== "ready" || flag.actorUuid !== source.uuid ||
        !flag.targets?.some(t => t.uuid === payload.targetUuid) || !Number.isFinite(Number(flag.dc)) ||
        Number(flag.dc) !== 8 + Number(source.system.abilities?.[flag.ability]?.mod ?? 0) + Number(source.system.attributes?.prof ?? 0))
      throw new Error("Carte Topple non valide.");
    const ci = victim.system?.traits?.ci?.value ?? victim.system?.traits?.ci;
    if (ci?.has?.("prone") || ci?.includes?.("prone")) return {immune:true};
    const roll = await victim.rollAbilitySave("con",{chatMessage:false,fastForward:true});
    if (!roll) return {cancelled:true};
    const passed = Number(roll.total) >= Number(flag.dc);
    if (!passed) await victim.toggleStatusEffect("prone",{active:true});
    const gmIds = game.users.filter(u=>u.isGM).map(u=>u.id);
    if (gmIds.length) await roll.toMessage({speaker:ChatMessage.getSpeaker({actor:victim}),
      flavor:`Topple — ${token.name ?? victim.name} — JS Constitution (DD ${flag.dc})`,whisper:gmIds,blind:true}, {rollMode:"blindroll"});
    return {passed};
  }
  throw new Error("Opération inconnue.");
}
