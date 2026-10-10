/**
 * Vex (2024 weapon mastery).
 * Tracks a successful weapon hit and confirms HP/temporary HP damage. Stores advantage state on the attacker and consumes it on the next matching attack.
 *
 * Hook registration is centralized in main.js to preserve the original
 * hook execution order and cross-mastery interactions.
 */
import {
  MODULE_ID,
  WEAPON_BY_ID,
  normalize,
  weaponMasteryId,
  actorHasMastery,
  tokenUuid,
  currentTurnStamp,
  workflowTargetUuids,
  hpDecreased,
} from "../common.js";

// Vex 2024 — pending attacks are matched with HP changes on the actual target.
// This is needed for Midi-QOL's manual APPLY flow, where damage hooks may not fire.
const VEX_FLAG = "workflowTargetUuids";
const vexPending = new Map();
const vexSpent = new Map();
const vexPreviousTurn = new Map();
function vexEntries(actor) { const v = actor?.getFlag(MODULE_ID, VEX_FLAG); return Array.isArray(v) ? v : []; }
function vexMastered(actor, item) {
  if (!actor || item?.type !== "weapon") return false;
  const id = weaponMasteryId(item);
  return !!id && normalize(item.system?.mastery ?? WEAPON_BY_ID.get(id)?.[2]) === "vex" &&
    actorHasMastery(actor, id);
}
function vexPendingFor(actor, target) {
  return [...vexPending.values()].filter(p => p.actor.uuid === actor.uuid && p.target === target);
}
async function vexSet(actor, target) {
  const entries = vexEntries(actor).filter(e => e.target !== target);
  entries.push({target, origin: currentTurnStamp(), nextTurn: null});
  await actor.setFlag(MODULE_ID, VEX_FLAG, entries);
  console.info(`${MODULE_ID} | Vex ACTIVATED`, {attacker: actor.name, target});
}
async function vexClear(actor, target) {
  await actor.setFlag(MODULE_ID, VEX_FLAG, vexEntries(actor).filter(e => e.target !== target));
  console.info(`${MODULE_ID} | Vex CONSUMED`, {attacker: actor.name, target});
}
function vexHas(actor, target) { return vexEntries(actor).some(e => e.target === target); }
/** At preAttackRoll, remember a potentially qualifying hit and request any stored Vex advantage. */
function vexTrackAttack(workflow) {
  const actor = workflow?.actor, item = workflow?.item;
  if (!actor) return;
  const targets = workflowTargetUuids(workflow);
  if (targets.length !== 1) return;
  const target = targets[0];
  // Every new roll has its own registration. A token HP update is only matched
  // with a successful damage workflow, not arbitrary HP loss.
  if (vexMastered(actor, item)) {
    const key = `${actor.uuid}|${target}`;
    vexPending.set(key, {actor, target, workflow, item, created: Date.now(), combat: game.combat?.id});
    console.info(`${MODULE_ID} | Vex TRACKING`, {attacker: actor.name, target, weapon: item.name});
  }
  if (vexHas(actor, target)) {
    workflow.workflowOptions ??= {};
    workflow.workflowOptions.advantage = true;
    workflow.advantage = true;
    workflow.attackRollOptions ??= {};
    workflow.attackRollOptions.advantage = true;
    // This is consumed by the roll; a successful Vex attack can immediately
    // reapply it after its damage is dealt.
    vexSpent.set(`${actor.uuid}|${target}`, {actor, target, workflow});
    console.info(`${MODULE_ID} | Vex ADVANTAGE requested`, {attacker: actor.name, target});
  }
}
function vexApplyNativeConfig(config) {
  // preRollAttackV2 signature: (item, config, dialog). The older hook may
  // use a different shape, so this function only accepts a real config.
  const workflow = config?.workflow;
  const actor = workflow?.actor ?? config?.subject?.actor ?? config?.subject?.item?.actor;
  const targets = workflow ? workflowTargetUuids(workflow) : [...(game.user?.targets ?? [])].map(tokenUuid);
  if (!actor || targets.length !== 1 || !vexHas(actor, targets[0])) return;
  config.advantage = true;
  config.midiOptions ??= {};
  config.midiOptions.advantage = true;
  if (Array.isArray(config.rolls)) for (const roll of config.rolls) {
    roll.options ??= {}; roll.options.advantage = true;
  }
  console.info(`${MODULE_ID} | Vex NATIVE ADVANTAGE`, {attacker: actor.name, target: targets[0]});
}
/** Match an HP loss to the exact attacked token, not to arbitrary damage. */
async function vexApplyHpChange(victim, updatedHp) {
  const possibleTargets = canvas?.tokens?.placeables?.filter(t => t.actor?.uuid === victim.uuid) ?? [];
  for (const token of possibleTargets) {
    const target = tokenUuid(token);
    const candidates = [...vexPending.values()].filter(p => p.target === target && Date.now() - p.created < 120000 &&
      (!p.combat || p.combat === game.combat?.id));
    for (const pending of candidates) {
      const workflow = pending.workflow;
      const hits = [...(workflow?.hitTargets ?? [])].map(tokenUuid);
      const hasAttack = !!workflow?.attackRoll;
      const hasDamage = !!(workflow?.damageRoll || workflow?.damageRolls?.length || workflow?.damageDetail?.length || workflow?.damageList?.length);
      console.info(`${MODULE_ID} | Vex HP MATCH`, {target, attacker: pending.actor.name, hits, hasAttack, hasDamage, hp: updatedHp});
      // Don't create Vex from a manual HP edit or an unrelated spell.
      if (!hits.includes(target) || !hasAttack || !hasDamage) continue;
      vexPending.delete(`${pending.actor.uuid}|${target}`);
      await vexSet(pending.actor, target);
    }
  }
}
// Damage absorbed by temporary HP also qualifies for Vex.
async function vexOnHpUpdate(actor, changes, options) {
  const previous = options?.awmPreviousHp;
  if (!previous || !hpDecreased(changes, previous)) return;
  console.info(`${MODULE_ID} | Vex HP/TEMP DAMAGE`, {actor: actor.name, previous});
  await vexApplyHpChange(actor, Number(actor.system.attributes.hp.value));
}
/** Expire Vex after the source gets its next turn, using the existing turn bookkeeping. */
async function vexNextTurn(combat, changed) {
  if (!("turn" in changed || "round" in changed) || !combat.started) return;
  const prior = vexPreviousTurn.get(combat.id);
  vexPreviousTurn.delete(combat.id);
  const stamp = currentTurnStamp();
  for (const actor of new Set([prior?.actor, combat.combatant?.actor].filter(Boolean))) {
    if (!actor.isOwner) continue;
    const current = vexEntries(actor), updated = [];
    for (const e of current) {
      if (actor.uuid === prior?.actor?.uuid && e.nextTurn === prior?.stamp) continue;
      if (actor.uuid === combat.combatant?.actor?.uuid && !e.nextTurn && e.origin !== stamp)
        updated.push({...e, nextTurn: stamp});
      else updated.push(e);
    }
    if (JSON.stringify(current) !== JSON.stringify(updated)) await actor.setFlag(MODULE_ID, VEX_FLAG, updated);
  }
  // stale attack records must not be mistaken for damage on a later turn
  for (const [k, p] of vexPending) if (Date.now() - p.created > 120000) vexPending.delete(k);
}

export { VEX_FLAG, vexPending, vexSpent, vexPreviousTurn, vexEntries, vexTrackAttack, vexApplyNativeConfig, vexApplyHpChange, vexOnHpUpdate, vexNextTurn, vexClear };
