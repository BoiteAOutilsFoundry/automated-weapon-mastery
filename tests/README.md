# Validation / tests

## Regression simulation

```bash
node tests/regression.mjs
```

Runs mocked Foundry / Midi-QOL interactions and checks:
- The original hook-registration counts (including separate Push/Topple insertion).
- Multiclass feature union and magical weapon `baseItem` identifiers.
- Vex on temporary-HP loss, Vex advantage and consumption.
- Sap refresh and consumption by the next attack.
- Slow's single effect, negative movement bonus and refresh.
- Topple & Push insert their own button while retaining the original Midi card.
- Topple does not roll a save on an immune target.
- Push moves a token up to 10 feet away, using a 5-ft grid.
- Graze replaces only the native damage roll parameters after a miss.
- Cleave remains without automatic handling.

## Static comparison against the supplied v0.0.36

```bash
python3 tests/static_parity.py /path/to/automated-weapon-mastery-v0.0.36.zip
```

Compares 48 function bodies, the original item-sheet UI, styles and manifest metadata.
The original ZIP is not bundled in v0.0.37.

**Limit:** mocks are not a substitute for testing in actual Foundry V12,
DnD5e 4.4.2, Midi-QOL 12.4.53 and Times Up 13.1.0.
