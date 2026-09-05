#!/usr/bin/env python3
import re

WORD_RE=re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*")


def _norm(s):
    return re.sub(r"[^a-z'-]+", "", str(s or '').lower())


def generated_inflections(term):
    """Small deterministic morphology net used only to validate an AI practice example.
    It is intentionally permissive: the canonical vocabulary item remains the lemma.
    """
    t=_norm(term)
    if not t or ' ' in t or '-' in t or "'" in t:
        return {t} if t else set()
    out={t}
    if t.endswith('y') and len(t)>2 and t[-2] not in 'aeiou':
        out.update({t[:-1]+'ies', t[:-1]+'ied', t[:-1]+'ying'})
    elif t.endswith('e'):
        out.update({t+'s', t[:-1]+'ing', t+'d'})
    else:
        out.update({t+'s', t+'ed', t+'ing'})
        if t.endswith(('s','x','z','ch','sh')):
            out.add(t+'es')
    return out


def allowed_forms(entry):
    forms=set()
    term=str(entry.get('term') or '').strip().lower()
    if term:
        forms.add(term)
        forms.update(generated_inflections(term))
    for f in entry.get('forms') or []:
        f=str(f or '').strip().lower()
        if f:
            forms.add(f)
            forms.update(generated_inflections(f))
    return {f for f in forms if f}


def example_mentions_entry(entry, text):
    """Accept the lemma OR any attested/generated inflected form as a real use.
    Fixes cases such as deny -> denied/denies, carry -> carried, study -> studied.
    """
    text=str(text or '')
    if not text.strip():
        return False
    if entry.get('type')=='phrase':
        p=' '.join(str(entry.get('term') or '').lower().split())
        n=' '.join(text.lower().split())
        return bool(p and p in n)
    tokens={m.group(0).lower() for m in WORD_RE.finditer(text)}
    return bool(tokens & allowed_forms(entry))


def short_zh(dict_zh):
    s=str(dict_zh or '').strip()
    if not s:
        return ''
    # Strip common POS prefixes for a short fallback sense, then take the first gloss.
    s=re.sub(r'^(?:n|v|vt|vi|adj|adv|prep|conj|pron|aux|a|r)\.?\s*', '', s, flags=re.I)
    parts=re.split(r'[；;，,、/]|\s{2,}', s)
    return (parts[0] if parts else s).strip(' .；;,，')[:40]


def merge_lexicon_ai(entry, ai):
    """Dictionary identity is local-first. AI is used for contextual sense and, when
    necessary, filling a genuinely missing field; a malformed AI reply cannot erase local data.
    """
    ai=ai if isinstance(ai,dict) else {}
    local_zh=str(entry.get('dict_zh') or '').strip()
    local_def=str(entry.get('definition_en') or '').strip()
    local_pos=str(entry.get('pos') or '').strip()
    sense=str(ai.get('sense_zh') or '').strip() or short_zh(local_zh) or local_zh
    dict_zh=local_zh or str(ai.get('dict_zh') or '').strip() or sense
    definition=local_def or str(ai.get('definition_en') or '').strip()
    pos=local_pos or str(ai.get('pos') or '').strip() or ('phrase' if entry.get('type')=='phrase' else '')
    return {
        'sense_zh':sense,
        'dict_zh':dict_zh,
        'definition_en':definition,
        'pos':pos,
        'example_en':str(ai.get('example_en') or '').strip(),
        'example_zh':str(ai.get('example_zh') or '').strip(),
    }


def lexicon_output_issues(entry, out):
    issues=[]
    if not out.get('sense_zh'): issues.append('sense_zh')
    if not out.get('dict_zh'): issues.append('dict_zh')
    if entry.get('type')=='word' and not out.get('definition_en'): issues.append('definition_en')
    if entry.get('needs_context_fill'):
        if not out.get('example_en'): issues.append('example_en')
        if not out.get('example_zh'): issues.append('example_zh')
        if out.get('example_en') and not example_mentions_entry(entry,out['example_en']): issues.append('example_form')
    return issues
