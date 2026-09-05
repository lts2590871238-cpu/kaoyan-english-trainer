#!/usr/bin/env python3
import json,tempfile
from pathlib import Path
from release_contract import REQUIRED_PAYLOAD,write_manifest,validate_manifest
with tempfile.TemporaryDirectory() as td:
    d=Path(td)
    for name in REQUIRED_PAYLOAD:
        obj={'ready':True,'counts':{'vocab':3000},'days':100,'title':'轩轩冲刺50分大作战！'} if name=='meta.json' else {}
        (d/name).write_text(json.dumps(obj,ensure_ascii=False),encoding='utf8')
    write_manifest(d)
    _,err=validate_manifest(d)
    assert not err,err
    (d/'schedule.json').write_text('{"tampered":true}',encoding='utf8')
    _,err=validate_manifest(d)
    assert any('schedule.json' in x for x in err),err
print('RELEASE CONTRACT SELFTEST: PASS')
