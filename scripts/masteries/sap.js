/**
 * Sap (2024 weapon mastery).
 * Applies an ActiveEffect on hit. The effect is consumed by the next attack and expired by Times Up if unused.
 *
 * Hook registration is centralized in main.js to preserve the original
 * hook execution order and cross-mastery interactions.
 */
import { MODULE_ID, WEAPON_BY_ID, normalize, weaponMasteryId, actorHasMastery } from "../common.js";

// Sap 2024: hit is sufficient; damage is not required.
// Times Up handles expiration at the start of the source's next turn.
const SAP_MARK = "sap2024";
const sapPending = new WeakMap();
function sapEffects(actor) {
  return [...(actor?.effects ?? [])].filter(e => e.getFlag(MODULE_ID, SAP_MARK));
}
function sapMastered(actor, item) {
  const id = weaponMasteryId(item);
  return item?.type === "weapon" && !!id &&
    normalize(item.system?.mastery ?? WEAPON_BY_ID.get(id)?.[2]) === "sap" &&
    actorHasMastery(actor, id);
}
/** One Sap effect per victim. A new application refreshes the duration and source. */
async function sapOnHit(workflow) {
  const source = workflow?.actor;
  if (!sapMastered(source, workflow?.item) || !source?.isOwner) return;
  for (const target of workflow?.hitTargets ?? []) {
    const victim = target.actor ?? target.document?.actor;
    if (!victim) continue;
    // As with Slow, keep a single Sap effect per victim, regardless of the attacker.
    // Refresh the duration and source at every new successful Sap hit.
    const existing = sapEffects(victim);
    const prior = existing[0];
    const effect = {
      name: "Weapon Mastery: Sap (Disadvantage)",
      icon: "icons/svg/daze.svg",
      origin: source.uuid,
      transfer: false, disabled: false,
      changes: [{
        key: "flags.midi-qol.disadvantage.attack.all",
        mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
        value: "1", priority: 20
      }],
      duration: {rounds: 1, startRound: game.combat?.round ?? 0,
        startTurn: game.combat?.turn ?? 0,
        startTime: game.time.worldTime},
      flags: {
        [MODULE_ID]: {[SAP_MARK]: true, sapSource: source.uuid},
        dae: {specialDuration: ["turnStartSource"]}
      }
    };
    if (prior) {
      await prior.update(effect);
      // Collapse legacy multiple Sap effects into the one refreshed instance.
      if (existing.length > 1) {
        await victim.deleteEmbeddedDocuments("ActiveEffect", existing.slice(1).map(e => e.id));
      }
    } else await victim.createEmbeddedDocuments("ActiveEffect", [effect]);
    console.info(`${MODULE_ID} | Sap REFRESHED`, {source:source.name, victim:victim.name});
  }
}
function sapBeforeAttack(workflow) {
  const actor = workflow?.actor;
  if (!actor) return;
  const effects = sapEffects(actor);
  if (!effects.length) return;
  workflow.disadvantage = true;
  workflow.workflowOptions ??= {};
  workflow.workflowOptions.disadvantage = true;
  workflow.attackRollOptions ??= {};
  workflow.attackRollOptions.disadvantage = true;
  sapPending.set(workflow, effects.map(e => e.id));
}
/** Consume Sap after the attack roll; expiration if unused is delegated to Times Up. */
async function sapAfterAttack(workflow) {
  const ids = sapPending.get(workflow);
  sapPending.delete(workflow);
  if (!ids?.length || !workflow?.attackRoll || !workflow?.actor?.isOwner) return;
  const actor = workflow.actor;
  const actual = ids.filter(id => actor.effects.get(id)?.getFlag(MODULE_ID, SAP_MARK));
  if (actual.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", actual);
    console.info(`${MODULE_ID} | Sap CONSUMED`, {actor:actor.name});
  }
}

export { sapBeforeAttack, sapAfterAttack, sapOnHit };
