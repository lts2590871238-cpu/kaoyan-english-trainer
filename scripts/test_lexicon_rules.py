#!/usr/bin/env python3
from lexicon_rules import allowed_forms,example_mentions_entry,merge_lexicon_ai,lexicon_output_issues

def check(cond,msg):
    if not cond: raise SystemExit('LEXICON RULE SELFTEST FAIL: '+msg)

deny={'term':'deny','type':'word','forms':['denied','denies'],'dict_zh':'vt. 否认, 拒绝','definition_en':'v. declare to be untrue','pos':'v.','needs_context_fill':True}
out=merge_lexicon_ai(deny,{'sense_zh':'否认','example_en':'The company denied the claim after reviewing the evidence.','example_zh':'该公司审查证据后否认了这一说法。'})
check(not lexicon_output_issues(deny,out),f'deny should accept denied; issues={lexicon_output_issues(deny,out)}')
check('denied' in allowed_forms(deny),'attested form lost')
carry={'term':'carry','type':'word','forms':['carried'],'dict_zh':'v. 携带','definition_en':'v. move while supporting','pos':'v.','needs_context_fill':True}
out=merge_lexicon_ai(carry,{'example_en':'The device carried the signal across the network.','example_zh':'该设备把信号传过网络。'})
check(not lexicon_output_issues(carry,out),f'carry/carried failed {lexicon_output_issues(carry,out)}')
local={'term':'stable','type':'word','forms':['stable'],'dict_zh':'a. 稳定的','definition_en':'a. resistant to change','pos':'a.','needs_context_fill':False}
out=merge_lexicon_ai(local,{})
check(out['sense_zh'] and out['dict_zh'] and out['definition_en'],'local dictionary must survive empty AI reply')
check(not lexicon_output_issues(local,out),f'local fallback failed {lexicon_output_issues(local,out)}')
print('LEXICON RULE SELFTEST: PASS')
