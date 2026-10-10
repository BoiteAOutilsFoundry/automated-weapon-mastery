/**
 * Shared weapon mastery data and helpers (D&D5e 4.4.2 / Foundry V12).
 *
 * All class features keep independent selections; active automations inspect
 * their union. Magical weapons are identified by system.type.baseItem first.
 * Also contains the shared Midi-QOL token, attack and chat-card utilities.
 */
const MODULE_ID = "automated-weapon-mastery";
const FLAG_KEY = "masteredWeapons";

// Official PHB 2024 base weapons: [system id, display name, mastery].
const WEAPONS = [
  ["battleaxe", "Battleaxe", "topple"],
  ["blowgun", "Blowgun", "vex"],
  ["club", "Club", "slow"],
  ["dagger", "Dagger", "nick"],
  ["dart", "Dart", "vex"],
  ["flail", "Flail", "sap"],
  ["glaive", "Glaive", "graze"],
  ["greataxe", "Greataxe", "cleave"],
  ["greatclub", "Greatclub", "push"],
  ["greatsword", "Greatsword", "graze"],
  ["halberd", "Halberd", "cleave"],
  ["hand-crossbow", "Hand Crossbow", "vex"],
  ["handaxe", "Handaxe", "vex"],
  ["heavy-crossbow", "Heavy Crossbow", "push"],
  ["javelin", "Javelin", "slow"],
  ["lance", "Lance", "topple"],
  ["light-crossbow", "Light Crossbow", "slow"],
  ["light-hammer", "Light Hammer", "nick"],
  ["longbow", "Longbow", "slow"],
  ["longsword", "Longsword", "sap"],
  ["mace", "Mace", "sap"],
  ["maul", "Maul", "topple"],
  ["morningstar", "Morningstar", "sap"],
  ["pike", "Pike", "push"],
  ["quarterstaff", "Quarterstaff", "topple"],
  ["rapier", "Rapier", "vex"],
  ["scimitar", "Scimitar", "nick"],
  ["shortbow", "Shortbow", "vex"],
  ["shortsword", "Shortsword", "vex"],
  ["sickle", "Sickle", "nick"],
  ["sling", "Sling", "slow"],
  ["spear", "Spear", "sap"],
  ["trident", "Trident", "topple"],
  ["war-pick", "War Pick", "sap"],
  ["warhammer", "Warhammer", "push"],
  ["whip", "Whip", "slow"],
];
const WEAPON_BY_ID = new Map(WEAPONS.map(w => [w[0], w]));

function normalize(value) { return String(value ?? "").trim().toLowerCase(); }
// Prefer the underlying base weapon (e.g. +1 Rapier -> rapier).
/** Returns the base weapon ID, including for enchanted variants (e.g. +1 Rapier). */
function weaponMasteryId(item) {
  return normalize(item?.system?.type?.baseItem) || normalize(item?.system?.identifier);
}
/** Only the actual class feat is configurable, not an arbitrary item. */
function isWeaponMasteryFeature(item) {
  if (!item || item.type !== "feat") return false;
  return normalize(item.system?.identifier) === "weapon-mastery" || normalize(item.name) === "weapon mastery";
}
function getMasteredWeapons(feature) {
  const value = feature?.getFlag(MODULE_ID, FLAG_KEY);
  return Array.isArray(value) ? value : [];
}
// Each class feature keeps its own selection. Automation uses their deduplicated union.
/** Collect mastered weapon IDs across all class features (multiclass-safe). */
function getActorMasteredWeapons(actor) {
  const ids = new Set();
  for (const feature of actor?.items ?? []) {
    if (!isWeaponMasteryFeature(feature)) continue;
    for (const id of getMasteredWeapons(feature)) ids.add(normalize(id));
  }
  return ids;
}
/** Check the union of all mastered weapons on the actor. */
function actorHasMastery(actor, id) {
  return !!id && getActorMasteredWeapons(actor).has(normalize(id));
}
function escapeHtml(value) {
  const div = document.createElement("div"); div.textContent = String(value ?? ""); return div.innerHTML;
}


/** Compare token document UUIDs; actor UUIDs are not token identities. */
function tokenUuid(token) { return token?.document?.uuid ?? token?.uuid ?? null; }

/** Stable combat-turn key used by timed mastery mechanics. */
function currentTurnStamp() {
  const c = game.combat;
  return c?.started ? `${c.id}:${c.round}:${c.turn}` : null;
}

/** Extract the attack workflow target UUIDs in one shared representation. */
function workflowTargetUuids(workflow) { return [...(workflow?.targets ?? [])].map(tokenUuid).filter(Boolean); }

/** Detect real-HP OR temporary-HP damage, including unlinked token updates. */
function hpDecreased(changes, previous, prefix = "system.attributes.hp") {
  const hp = foundry.utils.getProperty(changes, `${prefix}.value`);
  const temp = foundry.utils.getProperty(changes, `${prefix}.temp`);
  if (hp === undefined && temp === undefined) return false;
  return (hp !== undefined && Number(hp) < previous.value) ||
    (temp !== undefined && Number(temp) < previous.temp);
}

/** Read HP before Foundry applies an actor update. */
function hpSnapshot(actor) {
  return {
    value: Number(actor?.system?.attributes?.hp?.value ?? 0),
    temp: Number(actor?.system?.attributes?.hp?.temp ?? 0)
  };
}

/** Resolve the existing Midi-QOL card instead of generating a second card. */
function workflowMessageId(workflow) {
  return workflow?.itemCardId ?? workflow?.chatMessage?.id ?? workflow?.itemCardUuid?.split(".").pop() ?? null;
}

/** Resolve the actual attack ability, including spellcasting and finesse. */
function attackAbility(workflow) {
  const actor = workflow.actor;
  const roll = workflow.attackRoll;
  const activity = workflow.activity;
  let ability = normalize(roll?.options?.ability ?? workflow?.attackRollOptions?.ability ??
    activity?.attack?.ability ?? activity?.system?.attack?.ability ?? workflow.item?.system?.ability);
  if (ability === "spellcasting") ability = normalize(actor.system?.attributes?.spellcasting);
  if (!actor.system?.abilities?.[ability]) {
    const props = workflow.item?.system?.properties;
    const hasFinesse = props?.has?.("fin") || (Array.isArray(props) && props.includes("fin"));
    const isRanged = normalize(workflow.item?.system?.type?.value) === "ranged" ||
      ["simpleR", "martialR"].includes(workflow.item?.system?.type?.value);
    ability = isRanged ? "dex" : (hasFinesse &&
      Number(actor.system.abilities.dex.mod) > Number(actor.system.abilities.str.mod) ? "dex" : "str");
  }
  return ability;
}

/** Check whether the native combo card already contains a damage section. */
function cardHasDamage(content) {
  const node = document.createElement("div");
  node.innerHTML = content;
  const damage = node.querySelector(".midi-qol-damage-roll");
  return damage ? !!damage.textContent.trim() || !!damage.querySelector(".dice-roll, .dice-total") : false;
}

export {
  MODULE_ID,
  FLAG_KEY,
  WEAPONS,
  WEAPON_BY_ID,
  normalize,
  weaponMasteryId,
  isWeaponMasteryFeature,
  getMasteredWeapons,
  getActorMasteredWeapons,
  actorHasMastery,
  escapeHtml,
  tokenUuid,
  currentTurnStamp,
  workflowTargetUuids,
  hpDecreased,
  hpSnapshot,
  workflowMessageId,
  attackAbility,
  cardHasDamage
};
