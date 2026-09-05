#!/usr/bin/env python3
import shutil
from pathlib import Path
from release_contract import ALL_RELEASE_FILES,validate_manifest
ROOT=Path(__file__).resolve().parents[1]
CAND=ROOT/'data/candidate'; DATA=ROOT/'data'; GEN=DATA/'generated'; STAGE=DATA/'.generated-next'; OLD=DATA/'.generated-old'

_,errors=validate_manifest(CAND)
if errors:
    raise SystemExit('candidate manifest invalid before publish:\n- '+'\n- '.join(errors))
for d in (STAGE,OLD):
    if d.exists(): shutil.rmtree(d)
STAGE.mkdir(parents=True)
for name in ALL_RELEASE_FILES:
    shutil.copy2(CAND/name,STAGE/name)
_,errors=validate_manifest(STAGE)
if errors:
    raise SystemExit('staged release invalid:\n- '+'\n- '.join(errors))
# Repository users never see this filesystem transition until the final git commit.
# Locally we still swap the directory as one unit to prevent mixed generations.
if GEN.exists(): GEN.rename(OLD)
STAGE.rename(GEN)
if OLD.exists(): shutil.rmtree(OLD)
print('PUBLISH RELEASE: COMPLETE (atomic directory swap)')
