/**
 * Push (2024 weapon mastery).
 * Adds a non-destructive button to the original Midi-QOL card; pushes the first valid hit target on the grid.
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
  workflowMessageId,
  cardHasDamage,
} from "../common.js";

// Push (2024): on a hit, optionally move a Large-or-smaller target away.
// No damage required. The original Midi combo card is preserved.
const pushPending = new Map();
const pushBusy = new Set();
const PUSH_SIZES = new Set(["tiny", "sm", "med", "lg"]);
function pushMastered(actor, item) {
  const id = weaponMasteryId(item);
  return item?.type === "weapon" && !!id &&
    normalize(item.system?.mastery ?? WEAPON_BY_ID.get(id)?.[2]) === "push" &&
    actorHasMastery(actor, id);
}
/** Record the attacker and each hit target for the eventual Push button. */
function pushStoreAttack(workflow) {
  const actor = workflow?.actor, item = workflow?.item;
  if (!actor || !pushMastered(actor, item)) return;
  const id = workflowMessageId(workflow);
  const hits = [...(workflow.hitTargets ?? [])];
  if (!id || !hits.length) return;
  const targets = hits.map(token => ({
    uuid: tokenUuid(token),
    name: token.name ?? token.document?.name ?? "Cible"
  })).filter(t => t.uuid);
  if (!targets.length) return;
  pushPending.set(id, {actorUuid: actor.uuid,
    attackerTokenUuid: workflow.token?.document?.uuid ?? workflow.token?.uuid ?? null,
    targets});
  pushScheduleCard(id);
}
function pushInsert(content) {
  if (content.includes("awm-push-zone") || content.includes("awm-push-result")) return content;
  const html = `<div class="awm-push-zone" style="margin:3px 0;border-top:1px solid var(--color-border-light-2);border-bottom:1px solid var(--color-border-light-2);padding:2px 0">
  <button type="button" class="awm-push-button" style="width:100%;height:24px;min-height:24px;padding:0 8px;font-size:.90em;line-height:1">Push</button></div>`;
  const index = content.search(/<div[^>]*class=["'][^"']*(?:midi-qol-hits-display|midi-qol-damage-application|midi-qol-apply-damage)[^"']*["']/i);
  return index >= 0 ? content.slice(0, index) + html + content.slice(index) : content + html;
}
async function pushTryCard(id) {
  const data = pushPending.get(id), message = game.messages.get(id);
  if (!data || !message || !message.isOwner || !cardHasDamage(message.content)) return false;
  if (!message.getFlag(MODULE_ID, "push")) {
    await message.update({
      content: pushInsert(message.content),
      [`flags.${MODULE_ID}.push`]: {...data, state:"ready"}
    });
  }
  pushPending.delete(id);
  return true;
}
function pushScheduleCard(id) {
  let tries = 0;
  const attempt = async () => {
    if (!pushPending.has(id)) return;
    try {if (await pushTryCard(id)) return;}
    catch(e) {console.error(`${MODULE_ID} | Push card`,e);}
    if (++tries < 35) setTimeout(attempt, 250);
    else {console.warn(`${MODULE_ID} | Push card not found`,id);pushPending.delete(id);}
  };
  setTimeout(attempt, 120);
}
function pushWorkflowDone(workflow) {
  const id = workflowMessageId(workflow);
  if (id && pushPending.has(id)) void pushTryCard(id);
}
function pushResult(content, text) {
  const node = document.createElement("div"); node.innerHTML = content;
  const zone = node.querySelector(".awm-push-zone");
  if (!zone) return content;
  const result = document.createElement("div");
  result.className = "awm-push-result";
  result.style.cssText = "margin:3px 0;text-align:center;font-weight:700;font-size:.90em";
  result.textContent = text;
  zone.replaceWith(result);
  return node.innerHTML;
}
/** Move a qualifying creature directly away, accounting for the scene grid and walls. */
async function pushUse(message) {
  const flag = message.getFlag(MODULE_ID,"push");
  if (flag?.state !== "ready" || pushBusy.has(message.id)) return;
  const actor = await fromUuid(flag.actorUuid);
  if (!actor?.isOwner && !game.user.isGM) return ui.notifications.warn("Push : attaquant non contrôlé.");
  pushBusy.add(message.id);
  try {
    const choices = [];
    for (const t of flag.targets) {
      const doc = await fromUuid(t.uuid);
      const size = normalize(doc?.actor?.system?.traits?.size);
      if (PUSH_SIZES.has(size)) choices.push({...t, doc});
    }
    if (!choices.length) {
      const current = game.messages.get(message.id);
      await current.update({content:pushResult(current.content,"Push — aucune cible de taille Large ou inférieure"),
        [`flags.${MODULE_ID}.push.state`]:"used"});
      return;
    }
    // A click immediately pushes the first eligible hit target by up to 10 ft.
    const target = choices[0];
    const pushFeet = 10;
    const source = flag.attackerTokenUuid ? await fromUuid(flag.attackerTokenUuid) : null;
    if (!source || !target?.doc?.parent || source.parent?.id !== target.doc.parent?.id) {
      return ui.notifications.warn("Push : les deux tokens doivent être présents sur la même scène.");
    }
    const scene = target.doc.parent, grid = scene.grid;
    if (grid.type === 0 || !Number(grid.distance) || !Number(grid.size))
      return ui.notifications.warn("Push nécessite une scène quadrillée avec des distances configurées.");
    const t=target.doc,a=source;
    const center = d=>({x:d.x+d.width*grid.size/2,y:d.y+d.height*grid.size/2});
    const from=center(a), to=center(t);
    const dx=to.x-from.x,dy=to.y-from.y, magnitude=Math.hypot(dx,dy);
    if (!magnitude) return ui.notifications.warn("Push : direction impossible, les tokens se superposent.");
    const px = pushFeet / grid.distance * grid.size;
    const intended = {x:t.x+dx/magnitude*px, y:t.y+dy/magnitude*px};
    const snapped = canvas.grid.getSnappedPosition(intended.x,intended.y,1);
    const endpoint = {x:snapped.x+t.width*grid.size/2,y:snapped.y+t.height*grid.size/2};
    const travelled = Math.hypot(endpoint.x-to.x, endpoint.y-to.y)*grid.distance/grid.size;
    // Grid snapping may move the target diagonally farther than the allowed distance.
    if (travelled > pushFeet + 0.01 || (endpoint.x-to.x)*dx+(endpoint.y-to.y)*dy <= 0)
      return ui.notifications.warn("Push : la case d'arrivée ne respecte pas la distance/direction maximale.");
    const tokenObj = canvas.tokens.get(t.id);
    if (tokenObj?.checkCollision?.(endpoint, {origin:to,type:"move"}))
      return ui.notifications.warn("Push : déplacement bloqué par un mur.");
    if (snapped.x < 0 || snapped.y < 0 || snapped.x+t.width*grid.size > scene.width || snapped.y+t.height*grid.size > scene.height)
      return ui.notifications.warn("Push : déplacement hors de la scène.");
    await t.update({x:snapped.x,y:snapped.y});
    const current = game.messages.get(message.id);
    await current.update({content:pushResult(current.content,`Push — ${target.name} repoussé (${Math.round(travelled*10)/10} ft)`),
      [`flags.${MODULE_ID}.push.state`]:"used"});
  } catch(e) {console.error(`${MODULE_ID} | Push`,e);ui.notifications.error(`Push : ${e.message ?? e}`);}
  finally {pushBusy.delete(message.id);}
}

export { pushPending, pushStoreAttack, pushWorkflowDone, pushTryCard, pushUse };
