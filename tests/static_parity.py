"""Compare v0.0.36 against the split files (code-level function preservation)."""
import zipfile,re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
if len(sys.argv) != 2:
    sys.exit('Usage: python3 tests/static_parity.py /path/to/automated-weapon-mastery-v0.0.36.zip')
archive=Path(sys.argv[1])
with zipfile.ZipFile(archive) as z:
    old=z.read('automated-weapon-mastery/scripts/main.js').decode()
new='\n'.join(p.read_text() for p in [root/'scripts/common.js',root/'scripts/ui.js',*sorted((root/'scripts/masteries').glob('*.js'))])
renames={'vexTargetKey':'tokenUuid','vexCurrentTurn':'currentTurnStamp',
         'vexTargets':'workflowTargetUuids','vexHpDecrease':'hpDecreased',
         'vexHpSnapshot':'hpSnapshot','toppleMessageId':'workflowMessageId',
         'toppleAttackAbility':'attackAbility','toppleDamageShown':'cardHasDamage',
         'toppleSchedulePush':'pushScheduleCard'}
for oldname,newname in renames.items():
    old=re.sub(r'\b'+oldname+r'\b',newname,old)

def functions(source):
    found={}
    for match in re.finditer(r'^function (\w+)\(',source,re.M):
        begin=match.start();brace=source.index('{',match.end()); pos=brace+1; level=1
        while level:
            c=source[pos];level+=(c=='{')-(c=='}');pos+=1
        found[match.group(1)]=source[begin:pos]
    return found
base=functions(old); built=functions(new)
assert base.keys() == built.keys(),f'Missing/new functions: {base.keys() ^ built.keys()}'
for key in base:
    a,b=base[key],built[key]
    # No whitespace changes were made inside the moved function bodies.
    if a!=b:
        print(f'Non-identical function: {key}')
        import difflib
        print(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True))))
        sys.exit(1)
print(f'PASS: {len(base)} top-level functions preserved byte-for-byte after shared-helper renames')

# All original feature dialog and panel implementation (incl. CSS) retained.
original_ui=old[old.index('function featurePanel('):old.index('Hooks.on("renderItemSheet"')]
current_ui=(root/'scripts/ui.js').read_text()
current_ui=re.sub(r'/\*\*.*?\*/\s*', '', current_ui, flags=re.S)
assert original_ui in current_ui, 'Feature UI code changed'
with zipfile.ZipFile(archive) as z:
    assert (root/'styles/awm.css').read_bytes()==z.read('automated-weapon-mastery/styles/awm.css')
print('PASS: UI implementation and CSS unchanged')

# Module metadata parity besides version.
import json
with zipfile.ZipFile(archive) as z:
    oldmeta=json.loads(z.read('automated-weapon-mastery/module.json'))
newmeta=json.loads((root/'module.json').read_text())
assert newmeta['version']=='0.0.37'
oldmeta['version']=newmeta['version']
assert oldmeta==newmeta
print('PASS: manifest unchanged except version')
