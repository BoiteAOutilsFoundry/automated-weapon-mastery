/**
 * Slow (2024 weapon mastery).
 * Uses Vex-style damage confirmation, then refreshes one non-stacking ActiveEffect on the target. Times Up controls expiry.
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
} from "../common.js";

// Slow 2024 — a single non-stacking effect per target; Times Up handles expiry.
// The damage-confirmation path is shared with Vex (including temporary HP).
const SLOW_MARK = "slow2024";
const slowPending = new Map();
const slowBusy = new Set();
function slowMastered(actor, item) {
  const id = weaponMasteryId(item);
  return item?.type === "weapon" && !!id &&
    normalize(item.system?.mastery ?? WEAPON_BY_ID.get(id)?.[2]) === "slow" && actorHasMastery(actor, id);
}
function slowEffect(victim) {
  return victim?.effects?.find(e => !!e.getFlag(MODULE_ID, SLOW_MARK));
}
/** Do not trigger Slow until a successful weapon hit is confirmed by HP loss. */
function slowTrackAttack(workflow) {
  const actor = workflow?.actor, item = workflow?.item;
  if (!slowMastered(actor, item)) return;
  const targets = workflowTargetUuids(workflow);
  if (targets.length !== 1) return;
  const target = targets[0];
  slowPending.set(`${actor.uuid}|${target}`, {
    actor, target, workflow, created: Date.now(), combat: game.combat?.id,
    stamp: currentTurnStamp()
  });
  console.info(`${MODULE_ID} | Slow TRACKING`, {attacker: actor.name, target});
}
async function slowOnDamage(victim) {
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (token.actor?.uuid !== victim.uuid) continue;
    const target = tokenUuid(token);
    const candidates = [...slowPending].filter(([, p]) => p.target === target &&
      Date.now() - p.created < 120000 && (!p.combat || p.combat === game.combat?.id));
    for (const [key, pending] of candidates) {
      const workflow = pending.workflow;
      const hits = [...(workflow?.hitTargets ?? [])].map(tokenUuid);
      const hasDamage = !!(workflow?.damageRoll || workflow?.damageRolls?.length ||
        workflow?.damageDetail?.length || workflow?.damageList?.length);
      if (!workflow?.attackRoll || !hits.includes(target) || !hasDamage) continue;
      slowPending.delete(key);
      await slowApply(victim, pending);
    }
  }
}
/** Refresh one movement-reduction effect, leaving expiration to Times Up. */
async function slowApply(victim, pending) {
  const key = victim.uuid;
  if (slowBusy.has(key)) return;
  slowBusy.add(key);
  try {
    const current = slowEffect(victim);
    // A single effect remains on the victim. Each new Slow hit refreshes it;
    // the expiration is delegated entirely to Times Up.
    const movement = victim.system?.attributes?.movement ?? {};
    const speedChanges = ["walk", "fly", "swim", "climb", "burrow"]
      .filter(type => Number(movement[type] ?? 0) > 0)
      .map(type => ({key: `system.attributes.movement.${type}`,
        mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -10, priority: 20}));
    const duration = {rounds: 1, startRound: game.combat?.round ?? 0,
      startTurn: game.combat?.turn ?? 0};
    const flags = {
      [MODULE_ID]: {[SLOW_MARK]: true},
      dae: {specialDuration: ["turnStartSource"]}
    };
    if (current) {
      await current.update({
        origin: pending.actor.uuid,
        flags,
        changes: speedChanges,
        duration
      });
    } else {
      await victim.createEmbeddedDocuments("ActiveEffect", [{
        name: "Weapon Mastery: Slow (-10 ft)", icon: "icons/svg/downgrade.svg",
        transfer: false, disabled: false,
        origin: pending.actor.uuid,
        changes: speedChanges,
        duration,
        flags
      }]);
    }
    console.info(`${MODULE_ID} | Slow APPLIED`, {victim: victim.name, attacker: pending.actor.name});
  } catch (e) {console.error(`${MODULE_ID} | Slow effect creation failed`, e);}
  finally {slowBusy.delete(key);}
}

export { slowPending, slowTrackAttack, slowOnDamage };
