/**
 * Automated Weapon Mastery — hook orchestrator.
 *
 * Preserves v0.0.36 listener registration order and asynchronous workflows.
 * No Cleave or Nick automation: both are managed by the player's activities.
 * Each mastery implementation lives in scripts/masteries/*.js.
 */
import {
  MODULE_ID,
  WEAPON_BY_ID,
  normalize,
  weaponMasteryId,
  actorHasMastery,
  escapeHtml,
  workflowTargetUuids,
  currentTurnStamp,
  hpDecreased,
  hpSnapshot,
} from "./common.js";
import { registerGMSocket } from "./gm-socket.js";
import { registerFeatureUi } from "./ui.js";
import {
  VEX_FLAG,
  vexPending,
  vexSpent,
  vexPreviousTurn,
  vexEntries,
  vexTrackAttack,
  vexApplyNativeConfig,
  vexApplyHpChange,
  vexOnHpUpdate,
  vexNextTurn,
  vexClear,
} from "./masteries/vex.js";
import { slowPending, slowTrackAttack, slowOnDamage } from "./masteries/slow.js";
import { sapBeforeAttack, sapAfterAttack, sapTrackAttack, sapConfirmHit, sapOnDamage, sapDamagePending } from "./masteries/sap.js";
import { topplePending, toppleStoreAttack, toppleWorkflowDone, toppleTryCard, toppleUse } from "./masteries/topple.js";
import { pushPending, pushStoreAttack, pushWorkflowDone, pushTryCard, pushUse } from "./masteries/push.js";
import { grazeMarkMiss, grazeModifyNativeDamage } from "./masteries/graze.js";

registerFeatureUi();

Hooks.once("ready", () => {
  registerGMSocket();
  if (!game.modules.get("midi-qol")?.active) {
    ui.notifications.warn("Automated Weapon Mastery nécessite Midi-QOL."); return;
  }
  // Attack hooks: order matches the legacy module; different masteries can
  // act on the same workflow without overwriting one another.
  Hooks.on("midi-qol.preAttackRoll", vexTrackAttack);
  Hooks.on("midi-qol.preAttackRoll", slowTrackAttack);
  Hooks.on("midi-qol.preAttackRoll", sapBeforeAttack);
  Hooks.on("midi-qol.preAttackRoll", sapTrackAttack);
  Hooks.on("midi-qol.AttackRollComplete", workflow => {
    // Consume existing Sap and discard misses; new effects wait for committed damage.
    sapConfirmHit(workflow);
    void sapAfterAttack(workflow).catch(e => console.error(`${MODULE_ID} | Sap consumption`, e));
  });
  Hooks.on("midi-qol.AttackRollComplete", grazeMarkMiss);
  Hooks.on("dnd5e.preRollDamageV2", grazeModifyNativeDamage);
  Hooks.on("midi-qol.AttackRollComplete", workflow => toppleStoreAttack(workflow));
  Hooks.on("midi-qol.AttackRollComplete", workflow => pushStoreAttack(workflow));
  Hooks.on("midi-qol.damageRollComplete", toppleWorkflowDone);
  Hooks.on("midi-qol.DamageRollComplete", toppleWorkflowDone);
  Hooks.on("midi-qol.RollComplete", toppleWorkflowDone);
  Hooks.on("midi-qol.damageRollComplete", pushWorkflowDone);
  Hooks.on("midi-qol.DamageRollComplete", pushWorkflowDone);
  Hooks.on("midi-qol.RollComplete", pushWorkflowDone);
  // Each chat-button mastery inserts only its own fragment in the Midi card.
  // Do not replace the card: other modules/macros also extend its content.
  Hooks.on("updateChatMessage", message => {
    if (pushPending.has(message.id)) void pushTryCard(message.id).catch(error => console.error(`${MODULE_ID} | Push update`,error));
    if (topplePending.has(message.id)) void toppleTryCard(message.id).catch(error =>
      console.error(`${MODULE_ID} | Topple update`, error));
  });
  Hooks.on("renderChatMessage", (message, html) => {
    html.find(".awm-push-button").on("click", event => {event.preventDefault();event.stopPropagation();void pushUse(message);});
    html.find(".awm-topple-button").on("click", event => {
      event.preventDefault(); event.stopPropagation();
      void toppleUse(message);
    });
  });
  Hooks.on("dnd5e.preRollAttackV2", (item, config) => vexApplyNativeConfig(config));
  // Shared HP-change detection for Vex and Slow (normal and temporary HP).
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    const hpPath = "system.attributes.hp";
    if (foundry.utils.hasProperty(changes, `${hpPath}.value`) ||
        foundry.utils.hasProperty(changes, `${hpPath}.temp`))
      options.awmPreviousHp = hpSnapshot(actor);
  });
  Hooks.on("updateActor", (actor, changes, options) => {
    void vexOnHpUpdate(actor, changes, options).catch(e => console.error(`${MODULE_ID} | Vex HP error`, e));
    if (options?.awmPreviousHp && hpDecreased(changes, options.awmPreviousHp))
      {
        void slowOnDamage(actor).catch(e => console.error(`${MODULE_ID} | Slow HP error`, e));
        void sapOnDamage(actor).catch(e => console.error(`${MODULE_ID} | Sap HP error`, e));
      }
  });
  // Unlinked tokens can receive their HP changes via the token actorData.
  Hooks.on("preUpdateToken", (doc, changes, options) => {
    if (foundry.utils.hasProperty(changes, "actorData.system.attributes.hp.value") ||
        foundry.utils.hasProperty(changes, "actorData.system.attributes.hp.temp"))
      options.awmPreviousHp = hpSnapshot(doc.actor);
  });
  Hooks.on("updateToken", (doc, changes, options) => {
    if (doc.actor && options.awmPreviousHp &&
        hpDecreased(changes, options.awmPreviousHp, "actorData.system.attributes.hp")) {
      void slowOnDamage(doc.actor).catch(e => console.error(`${MODULE_ID} | Slow token error`, e));
      void sapOnDamage(doc.actor).catch(e => console.error(`${MODULE_ID} | Sap token error`, e));
      void vexApplyHpChange(doc.actor, Number(doc.actor.system.attributes.hp.value))
        .catch(e => console.error(`${MODULE_ID} | Vex token error`, e));
    }
  });
  Hooks.on("midi-qol.AttackRollComplete", workflow => {
    const actor = workflow?.actor;
    const targets = workflowTargetUuids(workflow);
    if (actor && targets.length === 1 && vexSpent.has(`${actor.uuid}|${targets[0]}`)) {
      vexSpent.delete(`${actor.uuid}|${targets[0]}`);
      void vexClear(actor, targets[0]);
    }
  });
  // Combat lifecycle: Vex alone manages its expiration; Slow/Sap delegate
  // their ActiveEffect expiration to Times Up.
  Hooks.on("preUpdateCombat", combat => vexPreviousTurn.set(combat.id, {
    actor: combat.combatant?.actor, stamp: currentTurnStamp()
  }));
  Hooks.on("updateCombat", (combat, changed) => {
    void vexNextTurn(combat, changed);
    for (const pending of [slowPending, sapDamagePending])
      for (const [key, p] of pending) if (Date.now() - p.created > 120000) pending.delete(key);
  });
  Hooks.on("deleteCombat", combat => {
    slowPending.clear(); sapDamagePending.clear();
    vexPending.clear(); vexSpent.clear(); vexPreviousTurn.delete(combat.id);
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (actor?.isOwner && vexEntries(actor).length) void actor.setFlag(MODULE_ID, VEX_FLAG, []);
    }
  });
  console.log(`${MODULE_ID} | Ready (v12.0.2)`);
});
