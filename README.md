# Automated Weapon Mastery — v0.0.37

Refactor of **v0.0.36**. No gameplay behaviors are intentionally changed.

## Files

| File | Role |
| --- | --- |
| `scripts/main.js` | Hook registration and coordination between masteries. |
| `scripts/common.js` | Weapon catalog, multiclass feature selection, token/turn helpers, HP/temp HP detection, native attack and chat helpers. |
| `scripts/ui.js` | Item sheet panel, selection dialog and filters. |
| `scripts/masteries/vex.js` | Targeted advantage after damage; consumed by next attack. |
| `scripts/masteries/slow.js` | Non-stacking movement reduction after damage; Times Up expiration. |
| `scripts/masteries/sap.js` | Disadvantage on next attack; one refreshed ActiveEffect. |
| `scripts/masteries/topple.js` | Original-card button, GM-only CON save, immunity to Prone. |
| `scripts/masteries/push.js` | Original-card button and movement directly away. |
| `scripts/masteries/graze.js` | Reconfiguration of native damage after a miss. |
| `styles/awm.css` | Existing styles, unchanged. |

Nick and Cleave **only appear in the weapon selection catalog**. Neither has automated hooks, buttons, or attack logic; Cleave is handled by a manually configured activity.

## Compatibility

Foundry V12, dnd5e 4.4.2, Midi-QOL 12.4.53, and Times Up >= 13.1.0 (same as v0.0.36). The entry point remains `scripts/main.js` (ES module).

## Maintenance rules

- Hook execution order is intentionally preserved in `main.js`.
- `common.js` owns shared helpers; each mastery owns its state and effects.
- Topple and Push alter chat cards **by inserting independent fragments**, without rebuilding the existing attack/damage sections; external macros can still insert their own sections.
- Existing module flags (`masteredWeapons`, `vexTargets`, `topple`, `push`, `slow2024`, `sap2024`) are unchanged: no data migration required.
- To add a mastery, implement it in `scripts/masteries/` and register its hooks in `main.js`.

## Validation

Static checks and regression simulation are included under `tests/`. They do not replace an in-game test with the installed versions of Foundry / Midi-QOL / Times Up. See `tests/README.md`.

## Tests

`node tests/regression.mjs` runs the simulation; `python3 tests/static_parity.py <original-v0.0.36.zip>` verifies source parity. Full instructions: `tests/README.md`.
