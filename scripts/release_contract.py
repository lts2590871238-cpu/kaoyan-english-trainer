#!/usr/bin/env python3
import hashlib, json
from datetime import datetime, timezone
from pathlib import Path

MANIFEST_NAME='release_manifest.json'
REQUIRED_PAYLOAD=[
    'meta.json','lexicon.json','lexicon_index.json','dictionary_lookup.json',
    'sentences.json','sentence_meta.json','corpus.json','analysis.json',
    'context_translations.json','schedule.json'
]
ALL_RELEASE_FILES=REQUIRED_PAYLOAD+[MANIFEST_NAME]
SCHEMA_VERSION=1

def sha256_file(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):
            h.update(chunk)
    return h.hexdigest()

def build_manifest(directory:Path):
    directory=Path(directory)
    files={}
    for name in REQUIRED_PAYLOAD:
        p=directory/name
        if not p.is_file():
            raise FileNotFoundError(f'release payload missing: {name}')
        files[name]={'sha256':sha256_file(p),'bytes':p.stat().st_size}
    meta=json.loads((directory/'meta.json').read_text(encoding='utf8'))
    digest=hashlib.sha256()
    for name in sorted(files):
        digest.update(name.encode())
        digest.update(files[name]['sha256'].encode())
        digest.update(str(files[name]['bytes']).encode())
    release_id=digest.hexdigest()[:20]
    return {
        'schema':SCHEMA_VERSION,
        'ready':True,
        'release_id':release_id,
        'created_utc':datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        'required_files':REQUIRED_PAYLOAD,
        'files':files,
        'counts':meta.get('counts',{}),
        'days':meta.get('days'),
        'title':meta.get('title','轩轩冲刺50分大作战！')
    }

def write_manifest(directory:Path):
    directory=Path(directory)
    manifest=build_manifest(directory)
    (directory/MANIFEST_NAME).write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    return manifest

def validate_manifest(directory:Path):
    directory=Path(directory); errors=[]
    mp=directory/MANIFEST_NAME
    if not mp.is_file(): return None,[f'missing {MANIFEST_NAME}']
    try: m=json.loads(mp.read_text(encoding='utf8'))
    except Exception as e: return None,[f'invalid manifest json: {e}']
    if m.get('schema')!=SCHEMA_VERSION: errors.append(f'unsupported manifest schema: {m.get("schema")}')
    if m.get('ready') is not True: errors.append('manifest ready != true')
    req=m.get('required_files')
    if req!=REQUIRED_PAYLOAD: errors.append('manifest required_files contract mismatch')
    files=m.get('files') or {}
    for name in REQUIRED_PAYLOAD:
        p=directory/name
        rec=files.get(name)
        if not p.is_file(): errors.append(f'missing payload: {name}'); continue
        if not isinstance(rec,dict): errors.append(f'manifest missing file record: {name}'); continue
        size=p.stat().st_size
        if rec.get('bytes')!=size: errors.append(f'byte-size mismatch: {name}')
        got=sha256_file(p)
        if rec.get('sha256')!=got: errors.append(f'sha256 mismatch: {name}')
    try:
        meta=json.loads((directory/'meta.json').read_text(encoding='utf8'))
        if meta.get('ready') is not True: errors.append('meta.ready != true')
        if m.get('counts')!=meta.get('counts',{}): errors.append('manifest/meta count mismatch')
    except Exception as e:
        errors.append(f'invalid meta.json: {e}')
    return m,errors
