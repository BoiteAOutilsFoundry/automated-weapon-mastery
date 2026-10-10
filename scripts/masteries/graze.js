/**
 * Graze (2024 weapon mastery).
 * Marks a miss and modifies the existing native D&D5e damage configuration. No extra damage-roll dialog is opened.
 *
 * Hook registration is centralized in main.js to preserve the original
 * hook execution order and cross-mastery interactions.
 */
import { MODULE_ID, WEAPON_BY_ID, normalize, weaponMasteryId, actorHasMastery, tokenUuid, attackAbility } from "../common.js";

// Graze 2024: only change the damage configuration of the EXISTING Midi workflow.
// Midi itself opens the ordinary damage dialog; never open another dialog here.
const grazePending = new Map();
function grazeMastered(actor, item) {
  const id = weaponMasteryId(item);
  return item?.type === "weapon" && !!id &&
    normalize(item.system?.mastery ?? WEAPON_BY_ID.get(id)?.[2]) === "graze" &&
    actorHasMastery(actor, id);
}
function grazeDamageType(item) {
  const base = item.system?.damage?.base ?? {};
  const types = base.types;
  const first = types?.first?.() ?? (Array.isArray(types) ? types[0] :
    types instanceof Set ? [...types][0] : null);
  return normalize(first ?? base.type ?? item.system?.damage?.parts?.[0]?.[1] ?? "") || null;
}
/** Only on a miss, remember the exact attack ability and weapon damage type. */
function grazeMarkMiss(workflow) {
  const actor = workflow?.actor, item = workflow?.item;
  if (!actor || !grazeMastered(actor, item) || !workflow.attackRoll) return;
  const missed = [...(workflow.missTargets ?? [])];
  const hitIds = new Set([...(workflow.hitTargets ?? [])].map(tokenUuid));
  if (!missed.length) missed.push(...[...(workflow.targets ?? [])].filter(t => !hitIds.has(tokenUuid(t))));
  if (!missed.length) return;
  const ability = attackAbility(workflow);
  const modifier = Number(actor.system?.abilities?.[ability]?.mod);
  const type = grazeDamageType(item);
  if (!Number.isFinite(modifier) || !type) return;
  grazePending.set(item.uuid, {actorUuid:actor.uuid, modifier:Math.max(0,modifier), type,
    created:Date.now(), activityUuid:workflow.activity?.uuid});
  console.info(`${MODULE_ID} | Graze miss: waiting for Midi native damage dialog`, {item:item.name,ability,modifier,type});
}
/** Modify the already-opening native damage dialog, never create an extra dialog. */
function grazeModifyNativeDamage(config) {
  const activity = config?.subject ?? config?.activity;
  const item = activity?.item;
  if (!item) return;
  const pending = grazePending.get(item.uuid);
  if (!pending) return;
  if (Date.now()-pending.created > 30000) {grazePending.delete(item.uuid);return;}
  if (item.actor?.uuid !== pending.actorUuid) return;
  if (pending.activityUuid && activity?.uuid && pending.activityUuid !== activity.uuid) return;
  grazePending.delete(item.uuid);
  const formula=String(pending.modifier);
  // D&D5e 4.4 damage roll data has a separate entry for each damage type.
  // Preserve the native configuration/dialog, but remove ALL the regular damage
  // parts (weapon dice, True Strike, bonuses) and replace them with one flat part.
  if (Array.isArray(config.rolls) && config.rolls.length) {
    const first = config.rolls[0];
    first.parts = [formula];
    first.options ??= {};
    first.options.type = pending.type;
    first.options.types = [pending.type];
    config.rolls = [first];
  } else {
    config.rolls = [{parts:[formula], options:{type:pending.type,types:[pending.type]}}];
  }
  if (Array.isArray(config.parts)) config.parts=[formula];
  if (config.critical && typeof config.critical === "object") config.critical.allow=false;
  console.info(`${MODULE_ID} | Graze native damage configured`, {formula,type:pending.type,rolls:config.rolls});
}

export { grazeMarkMiss, grazeModifyNativeDamage };
