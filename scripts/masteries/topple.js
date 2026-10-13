/**
 * Topple (2024 weapon mastery).
 * Adds a non-destructive button to the existing Midi-QOL chat card and rolls a GM-only Constitution save on demand.
 *
 * Hook registration is centralized in main.js to preserve the original
 * hook execution order and cross-mastery interactions.
 */
import { gmRequest } from "../gm-socket.js";
import {
  MODULE_ID,
  WEAPON_BY_ID,
  normalize,
  weaponMasteryId,
  actorHasMastery,
  tokenUuid,
  workflowMessageId,
  attackAbility,
  cardHasDamage,
} from "../common.js";

// Topple 2024 — add a choice to the existing Midi-QOL combo card *after* damage.
// A message flag stores the attack's context so the button survives chat re-renders.
const topplePending = new Map();
const toppleInProgress = new Set();
function toppleMastered(actor, item) {
  const id = weaponMasteryId(item);
  return item?.type === "weapon" && !!id &&
    normalize(item.system?.mastery ?? WEAPON_BY_ID.get(id)?.[2]) === "topple" &&
    actorHasMastery(actor, id);
}
/** Persist attack context for later insertion into the existing combo card. */
function toppleStoreAttack(workflow) {
  const actor = workflow?.actor, item = workflow?.item;
  if (!actor || !toppleMastered(actor, item)) return;
  const id = workflowMessageId(workflow);
  const targets = [...(workflow.hitTargets ?? [])];
  if (!id || !targets.length) return;
  const ability = attackAbility(workflow);
  const mod = Number(actor.system.abilities?.[ability]?.mod ?? 0);
  const pb = Number(actor.system.attributes?.prof ?? 0);
  const record = {
    actorUuid: actor.uuid, itemUuid: item.uuid, messageId: id,
    targets: targets.map(t => ({uuid: tokenUuid(t), name: t.name ?? t.document?.name ?? "Cible"})).filter(t => t.uuid),
    dc: 8 + mod + pb, ability, created: Date.now()
  };
  topplePending.set(id, record);
  toppleScheduleCard(id);
}
function toppleButtonHtml() {
  return `<div class="awm-topple-zone" style="margin:3px 0;border-top:1px solid var(--color-border-light-2);border-bottom:1px solid var(--color-border-light-2);padding:2px 0">
    <button type="button" class="awm-topple-button" style="width:100%;height:24px;min-height:24px;padding:0 8px;font-size:.90em;line-height:1">Topple</button>
  </div>`;
}
function toppleInsert(content) {
  if (content.includes("awm-topple-zone") || content.includes("awm-topple-result")) return content;
  const html = toppleButtonHtml();
  const index = content.search(/<div[^>]*class=["'][^"']*(?:midi-qol-hits-display|midi-qol-damage-application|midi-qol-apply-damage)[^"']*["']/i);
  return index >= 0 ? content.slice(0,index) + html + content.slice(index) : content + html;
}
/** Insert the button only after native Midi damage is displayed, without replacing content. */
async function toppleTryCard(id) {
  const data = topplePending.get(id);
  const message = game.messages.get(id);
  if (!data || !message || !cardHasDamage(message.content)) return false;
  if (!message.isOwner) return false;
  // Preserve every Midi-QOL field, attack roll, damage breakdown and APPLY buttons.
  if (!message.getFlag(MODULE_ID, "topple")) {
    await message.update({
      content: toppleInsert(message.content),
      [`flags.${MODULE_ID}.topple`]: {actorUuid:data.actorUuid,itemUuid:data.itemUuid,targets:data.targets,dc:data.dc,ability:data.ability,state:"ready"}
    });
  }
  topplePending.delete(id);
  return true;
}
function toppleScheduleCard(id) {
  // The combo card can be filled asynchronously, particularly with manual APPLY.
  let tries = 0;
  const attempt = async () => {
    if (!topplePending.has(id)) return;
    try { if (await toppleTryCard(id)) return; }
    catch (error) { console.error(`${MODULE_ID} | Topple card`, error); }
    if (++tries < 35) setTimeout(attempt, 250);
    else { console.warn(`${MODULE_ID} | Topple damage card not found`, id); topplePending.delete(id); }
  };
  setTimeout(attempt, 120);
}
function toppleWorkflowDone(workflow) {
  const id = workflowMessageId(workflow);
  if (id && topplePending.has(id)) void toppleTryCard(id);
}
function toppleResult(content, text) {
  const node = document.createElement("div");
  node.innerHTML = content;
  const zone = node.querySelector(".awm-topple-zone");
  if (!zone) return content;
  const result = document.createElement("div");
  result.className = "awm-topple-result";
  result.style.cssText = "margin:3px 0;text-align:center;font-weight:700;font-size:.90em";
  result.textContent = text;
  zone.replaceWith(result);
  return node.innerHTML;
}
function toppleImmuneToProne(victim) {
  // dnd5e 4.x stores condition immunities in system.traits.ci.value (a Set).
  const ci = victim?.system?.traits?.ci;
  const values = ci?.value ?? ci;
  if (values instanceof Set) return values.has("prone");
  if (Array.isArray(values)) return values.includes("prone");
  if (values && typeof values.has === "function") return values.has("prone");
  return false;
}

/** Check condition immunity BEFORE a GM-only saving throw, then apply Prone on failure. */
async function toppleUse(message) {
  const flag = message.getFlag(MODULE_ID, "topple");
  if (flag?.state !== "ready" || toppleInProgress.has(message.id)) return;
  const actor = await fromUuid(flag.actorUuid);
  if (!actor?.isOwner && !game.user.isGM) { ui.notifications.warn("Topple : vous ne contrôlez pas l'attaquant."); return; }
  toppleInProgress.add(message.id);
  try {
    const results = [];
    const gmIds = game.users.filter(user => user.isGM).map(user => user.id);
    for (const target of flag.targets) {
      const token = await fromUuid(target.uuid);
      const victim = token?.actor ?? token;
      if (!victim?.rollAbilitySave) { results.push(`${target.name} : cible introuvable`); continue; }
      if (toppleImmuneToProne(victim)) {
        results.push(`${target.name} : immunisé à Prone`);
        continue;
      }
      if (!victim.isOwner && !game.user.isGM) {
        const remote = await gmRequest("topple", {sourceUuid:flag.actorUuid,itemUuid:flag.itemUuid,
          targetUuid:target.uuid,messageId:message.id});
        results.push(`${target.name} : ${remote.immune ? "immunisé à Prone" : remote.cancelled ? "jet annulé" : remote.passed ? "résiste" : "à terre"}`);
        continue;
      }
      // Never publish the saving throw to all players. Roll without a chat card,
      // then send the complete rolled result as a GM-only whisper.
      const roll = await victim.rollAbilitySave("con", {chatMessage: false, fastForward: true});
      if (!roll) { results.push(`${target.name} : jet annulé`); continue; }
      const passed = Number(roll.total) >= Number(flag.dc);
      if (!passed) await victim.toggleStatusEffect("prone", {active: true});
      if (gmIds.length) {
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({actor: victim}),
          flavor: `Topple — ${target.name} — JS Constitution (DD ${flag.dc})`,
          whisper: gmIds,
          blind: true
        }, {rollMode: "blindroll"});
      }
      // The shared attack card only reveals the resulting condition/outcome,
      // never the actual save total or die breakdown.
      results.push(`${target.name} : ${passed ? "résiste" : "à terre"}`);
    }
    const current = game.messages.get(message.id);
    await current.update({
      content: toppleResult(current.content, `Topple — ${results.join(" ; ")}`),
      [`flags.${MODULE_ID}.topple.state`]: "used"
    });
  } catch(error) {
    console.error(`${MODULE_ID} | Topple save`, error);
    ui.notifications.error(`Topple : ${error.message ?? error}`);
  } finally { toppleInProgress.delete(message.id); }
}

export { topplePending, toppleStoreAttack, toppleWorkflowDone, toppleTryCard, toppleUse };
