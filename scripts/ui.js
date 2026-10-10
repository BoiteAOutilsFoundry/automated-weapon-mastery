/** The Weapon Mastery item-sheet panel and weapon-selection dialog. */
import {
  MODULE_ID,
  FLAG_KEY,
  WEAPONS,
  WEAPON_BY_ID,
  isWeaponMasteryFeature,
  getMasteredWeapons,
  escapeHtml,
} from "./common.js";

function featurePanel(feature) {
  const selected = getMasteredWeapons(feature).map(id => WEAPON_BY_ID.get(id)).filter(Boolean);
  const panel = document.createElement("section");
  panel.className = "awm-panel";
  panel.dataset.awmPanel = "true";
  panel.innerHTML = `
    <h3>Automated Weapon Mastery</h3>
    ${selected.length ? `<ul class="awm-selected">${selected.map(w => `<li class="awm-selected-item"><span class="awm-selected-name">${escapeHtml(w[1])}</span><button type="button" class="awm-remove" data-weapon-id="${escapeHtml(w[0])}" aria-label="Retirer ${escapeHtml(w[1])}" title="Retirer ${escapeHtml(w[1])}"><i class="fas fa-times"></i></button></li>`).join("")}</ul>` : `<p class="awm-empty">Aucune arme sélectionnée.</p>`}
    <button type="button" class="awm-configure"><i class="fas fa-sliders-h"></i> Modifier les maîtrises</button>`;
  panel.querySelector(".awm-configure").addEventListener("click", ev => {
    ev.preventDefault(); ev.stopPropagation(); openConfig(feature);
  });
  panel.querySelectorAll(".awm-remove").forEach(button => {
    button.addEventListener("click", async ev => {
      ev.preventDefault(); ev.stopPropagation();
      const weaponId = String(button.dataset.weaponId ?? "");
      if (!weaponId) return;
      const updated = getMasteredWeapons(feature).filter(id => id !== weaponId);
      await feature.setFlag(MODULE_ID, FLAG_KEY, updated);
      if (feature.sheet?.rendered) feature.sheet.render(false);
    });
  });
  return panel;
}

/** Foundry V12 Application for selecting weapons on one class feature. */
class WeaponMasteryConfig extends Application {
  constructor(feature, options = {}) {
    super(options);
    this.feature = feature;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "awm-config",
      title: "Weapon Mastery — Armes maîtrisées",
      width: 500,
      height: 450,
      resizable: false,
      classes: ["awm-config-app"]
    });
  }

  async _renderInner() {
    const selected = new Set(getMasteredWeapons(this.feature));
    const masteries = [...new Set(WEAPONS.map(w => w[2]))].sort();
    const rows = WEAPONS.map(([id, name, mastery]) => `
      <label class="awm-weapon-row" data-name="${name.toLowerCase()}" data-mastery="${mastery}">
        <input type="checkbox" name="awmWeapon" value="${id}" ${selected.has(id) ? "checked" : ""}>
        <span>${name}</span>
      </label>`).join("");

    return $(`<div class="awm-config-body">
      <div class="awm-tools">
        <input class="awm-search" type="search" placeholder="Rechercher une arme…" autocomplete="off">
        <select class="awm-filter">
          <option value="">Toutes les maîtrises</option>
          ${masteries.map(m => `<option value="${m}">${m.toUpperCase()}</option>`).join("")}
        </select>
      </div>
      <div class="awm-weapon-list">${rows}</div>
      <div class="awm-count"></div>
      <div class="awm-actions">
        <button type="button" class="awm-save"><i class="fas fa-save"></i> Enregistrer</button>
        <button type="button" class="awm-cancel"><i class="fas fa-times"></i> Annuler</button>
      </div>
    </div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const update = () => {
      const q = String(html.find(".awm-search").val() ?? "").trim().toLowerCase();
      const mastery = String(html.find(".awm-filter").val() ?? "");
      let shown = 0;
      html.find(".awm-weapon-row").each((_, el) => {
        const row = $(el);
        const visible = (!q || String(row.attr("data-name") ?? "").includes(q)) &&
          (!mastery || String(row.attr("data-mastery") ?? "") === mastery);
        el.hidden = !visible;
        if (visible) shown++;
      });
      const checked = html.find('input[name="awmWeapon"]:checked').length;
      html.find(".awm-count").text(`${checked} sélectionnée(s) • ${shown} affichée(s)`);
    };

    html.find(".awm-search").on("input", update);
    html.find(".awm-filter").on("change", update);
    html.find('input[name="awmWeapon"]').on("change", update);
    html.find(".awm-cancel").on("click", () => this.close());
    html.find(".awm-save").on("click", async () => {
      const ids = html.find('input[name="awmWeapon"]:checked').map((_, el) => el.value).get();
      await this.feature.setFlag(MODULE_ID, FLAG_KEY, ids);
      if (this.feature.sheet?.rendered) this.feature.sheet.render(false);
      await this.close();
    });
    update();
  }
}

function openConfig(feature) {
  new WeaponMasteryConfig(feature).render(true);
}

/** Keep the UI panel scoped to owned, embedded Weapon Mastery features. */
function injectPanel(app, root) {
  const item = app?.item ?? app?.document ?? app?.object;
  if (!isWeaponMasteryFeature(item) || !item.isEmbedded || !item.actor || !item.isOwner) return;
  const element = root instanceof HTMLElement ? root : root?.[0];
  if (!(element instanceof HTMLElement)) return;
  element.querySelectorAll('[data-awm-panel="true"]').forEach(e => e.remove());
  const destination = element.querySelector('.tab[data-tab="description"]') ?? element.querySelector('[data-tab="description"]') ?? element.querySelector("form") ?? element;
  destination.appendChild(featurePanel(item));
}
export function registerFeatureUi() {
  Hooks.on("renderItemSheet", (app, html) => injectPanel(app, html));
}
