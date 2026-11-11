#!/usr/bin/env node
// ESLint non-regression gate (MVP hardening WP5).
//
// The repository carried 31 ESLint errors when CI was introduced. Rather than disabling rules, the existing
// errors are recorded per file and per rule in config/eslint-baseline.json and this script fails when:
//   - any file/rule pair has MORE errors than its baseline (a new defect), or
//   - a file that is not in the baseline has any error.
// When errors are fixed the script reports the stale entries and, with --update, rewrites the baseline so the
// allowance can only ever shrink. Warnings are reported but do not fail the gate.
//
// Usage: node scripts/eslint-baseline-check.mjs [--update]
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {relative} from 'node:path';

const BASELINE_PATH='config/eslint-baseline.json';
const update=process.argv.includes('--update');
const run=spawnSync(process.execPath,['node_modules/eslint/bin/eslint.js','.','--format','json'],{encoding:'utf8',maxBuffer:256*1024*1024});
if(run.status!==0&&run.status!==1){console.error(run.stderr||run.stdout);console.error('ESLint did not complete; the gate cannot be evaluated.');process.exit(2);}
let results;
try{results=JSON.parse(run.stdout);}catch{console.error('Could not parse ESLint JSON output.');process.exit(2);}

const current={};let warnings=0;
for(const file of results){
 const path=relative(process.cwd(),file.filePath).split('\\').join('/');
 for(const m of file.messages){
  if(m.severity!==2){warnings++;continue;}
  const rule=m.ruleId??'parse-error';
  current[path]??={};current[path][rule]=(current[path][rule]??0)+1;
 }
}
const total=o=>Object.values(o).reduce((a,f)=>a+Object.values(f).reduce((x,y)=>x+y,0),0);

if(update){
 const sorted=Object.fromEntries(Object.keys(current).sort().map(f=>[f,Object.fromEntries(Object.keys(current[f]).sort().map(r=>[r,current[f][r]]))]));
 const previous=(()=>{try{return JSON.parse(readFileSync(BASELINE_PATH,'utf8'));}catch{return null;}})();
 if(previous&&total(sorted)>total(previous.errors)){console.error(`Refusing to raise the baseline from ${total(previous.errors)} to ${total(sorted)} errors. Fix the new errors instead.`);process.exit(1);}
 writeFileSync(BASELINE_PATH,JSON.stringify({description:'Pre-existing ESLint errors tolerated by scripts/eslint-baseline-check.mjs. This allowance may only shrink. Clean-up plan: docs/mvp-hardening-fable-52/06-ci-cd-release-gating.md.',recordedOn:new Date().toISOString().slice(0,10),totalErrors:total(sorted),errors:sorted},null,2)+'\n');
 console.log(`Baseline written: ${total(sorted)} error(s) across ${Object.keys(sorted).length} file(s).`);process.exit(0);
}

const baseline=JSON.parse(readFileSync(BASELINE_PATH,'utf8')).errors;
const regressions=[],improvements=[];
for(const [file,rules] of Object.entries(current))for(const [rule,count] of Object.entries(rules)){
 const allowed=baseline[file]?.[rule]??0;
 if(count>allowed)regressions.push(`${file}: ${rule} — ${count} error(s), baseline allows ${allowed}`);
}
for(const [file,rules] of Object.entries(baseline))for(const [rule,allowed] of Object.entries(rules)){
 const count=current[file]?.[rule]??0;
 if(count<allowed)improvements.push(`${file}: ${rule} — now ${count}, baseline ${allowed}`);
}
console.log(`ESLint: ${total(current)} error(s) (baseline ${total(baseline)}), ${warnings} warning(s).`);
if(improvements.length){console.log('\nBaseline entries that can be tightened (run with --update):');for(const i of improvements)console.log(`  ${i}`);}
if(regressions.length){console.error('\nNew ESLint errors above the baseline:');for(const r of regressions)console.error(`  ${r}`);process.exit(1);}
console.log('No new ESLint errors.');
