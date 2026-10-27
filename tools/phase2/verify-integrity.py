import json,hashlib,subprocess,sys
from pathlib import Path
snapshot=Path(sys.argv[1] if len(sys.argv)>1 else 'TEST_EVIDENCE_PHASE2/before-integrity.json')
before=json.loads(snapshot.read_text(encoding='utf-8-sig'));rows=[]
for root,record in before.items():
 changed=[]
 for name,digest in record['files'].items():
  p=Path(root)/name
  if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest().lower()!=digest.lower():changed.append(name)
 head=subprocess.check_output(['git','-C',root,'rev-parse','HEAD'],text=True).strip();status=subprocess.check_output(['git','-C',root,'status','--porcelain=v1'],text=True).strip()
 rows.append({'root':root,'head':head,'headUnchanged':head==record['head'],'checkedFiles':len(record['files']),'changedFiles':changed,'statusUnchanged':status==record['status']})
protected=['package.json','lib/mos/workspace-contract.js','lib/mos/adapters/workspace.js','lib/mos/workspace-client.js','lib/mos/eventconsumer.js','lib/mos/routes/reviews.js','lib/mos/routes/publishing.js','lib/mos/routes/admissions.js']
verified=[]
for f in protected:
 old=subprocess.check_output(['git','show','319c5b3:'+f]);current=Path(f).read_bytes();verified.append({'file':f,'unchanged':old.replace(b'\r\n',b'\n')==current.replace(b'\r\n',b'\n')})
out={'originalAndPhase1':rows,'protectedCapabilitiesAndContracts':verified,'ok':all(not r['changedFiles'] and r['headUnchanged'] and r['statusUnchanged'] for r in rows) and all(r['unchanged'] for r in verified)}
Path('TEST_EVIDENCE_PHASE2/integrity.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8');print('Source and protected data integrity:',out['ok']);sys.exit(0 if out['ok'] else 1)
