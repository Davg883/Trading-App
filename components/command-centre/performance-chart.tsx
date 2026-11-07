'use client';
import Link from 'next/link';
import {useMemo,useState,type KeyboardEvent} from 'react';
import {WINDOWS,performance,benchmarkReturnGbp,benchmarkSeries,flowEvents,type BenchmarkObservation,type CashFlow,type Valuation,type WindowId} from '../../lib/portfolio/performance';
import {Shown,iso,money,pct,signedMoney} from './shared';

type Benchmark={id:string;label:string;observations:BenchmarkObservation[];convention:string;evidenceHref:string};
type Mode='twr'|'value';
/**
 * Interactive performance chart with two modes:
 * - Time-weighted return: genuine investment performance with deposits and withdrawals removed.
 * - GBP account value: the stored balances, which DO include deposits; flow markers explain the jumps.
 * Only stored valuations are plotted. Benchmark lines use only observations with a known GBP rate.
 */
export function PerformanceChart({valuations,flows,currency,now,benchmarks,fixHref,compact=false,provider='Trading 212'}:{valuations:Valuation[];flows:CashFlow[];currency:string;now:number;benchmarks:Benchmark[];fixHref:string;compact?:boolean;provider?:string}){
 const[windowId,setWindow]=useState<WindowId>('All'),[mode,setMode]=useState<Mode>('twr'),[benchmarkId,setBenchmark]=useState(''),[focus,setFocus]=useState<number|null>(null);
 const perf=useMemo(()=>performance(valuations,flows,currency,windowId,now),[valuations,flows,currency,windowId,now]);
 const s=perf.series,from=s[0]?.at??0,to=s.at(-1)?.at??0;
 const events=s.length>=2?flowEvents(flows,currency,from,to):[];
 const bench=benchmarks.find(b=>b.id===benchmarkId)??null;
 const benchReturn=bench&&s.length>=2?benchmarkReturnGbp(bench.observations,from,to):null;
 const benchLine=bench&&s.length>=2&&mode==='twr'?benchmarkSeries(bench.observations,from,to):null;
 // Narrow screens get a taller canvas (not a stretched one) so the line, markers and labels stay readable.
 const W=compact?420:1000,H=compact?300:280,P=compact?28:40;
 const ys=[...s.map(p=>mode==='twr'?p.cumulativeTwr:p.value),...(benchLine?.points.map(b=>b.cumulativeReturn)??[])];
 const xs=[...s.map(p=>p.at),...(benchLine?.points.map(b=>b.at)??[])],x0=Math.min(...xs),x1=Math.max(...xs);
 const y0=mode==='twr'?Math.min(0,...ys):Math.min(...ys),y1=mode==='twr'?Math.max(0,...ys):Math.max(...ys),pad=(y1-y0)*0.08||1;
 const X=(t:number)=>x1===x0?W/2:P+(t-x0)/(x1-x0)*(W-2*P),Y=(v:number)=>H-P-(v-(y0-pad))/((y1+pad)-(y0-pad))*(H-2*P);
 const yOf=(p:{cumulativeTwr:number;value:number})=>Y(mode==='twr'?p.cumulativeTwr:p.value);
 const path=s.map((p,i)=>`${i?'L':'M'}${X(p.at).toFixed(1)} ${yOf(p).toFixed(1)}`).join(' ');
 const benchPath=benchLine?.points.map((p,i)=>`${i?'L':'M'}${X(p.at).toFixed(1)} ${Y(p.cumulativeReturn).toFixed(1)}`).join(' ');
 const onKey=(e:KeyboardEvent)=>{if(!s.length)return;if(e.key==='ArrowRight'){e.preventDefault();setFocus(f=>Math.min(s.length-1,(f??-1)+1));}if(e.key==='ArrowLeft'){e.preventDefault();setFocus(f=>Math.max(0,(f??s.length)-1));}};
 const point=focus!==null?s[focus]:null;
 return <section className="cc-panel cc-chart" aria-labelledby="perf-title" data-testid="performance-chart">
  <header className="cc-panel-head"><div><h2 id="perf-title">Portfolio performance</h2><p>{mode==='twr'?'Time-weighted return: investment performance with deposits and withdrawals removed.':`Account value in GBP as stored at each ${provider} sync. Includes deposits and withdrawals (marked); it is not a return.`}</p></div>
   <div className="cc-chart-controls">
    <div role="radiogroup" aria-label="Display mode" className="cc-segment" data-testid="chart-mode"><button role="radio" aria-checked={mode==='twr'} onClick={()=>setMode('twr')}>Return (TWR)</button><button role="radio" aria-checked={mode==='value'} onClick={()=>{setMode('value');setBenchmark('');}}>Value (GBP)</button></div>
    <div role="radiogroup" aria-label="Time window" className="cc-segment">{WINDOWS.map(w=><button key={w.id} role="radio" aria-checked={windowId===w.id} onClick={()=>{setWindow(w.id);setFocus(null);}}>{w.id}</button>)}</div>
    <label className="cc-select">Compare with<select value={benchmarkId} disabled={mode==='value'} title={mode==='value'?'Benchmarks compare returns, not balances':''} onChange={e=>setBenchmark(e.target.value)}><option value="">No benchmark</option>{benchmarks.map(b=><option key={b.id} value={b.id}>{b.label}</option>)}</select></label></div></header>
  <div className="cc-chart-stats">
   <div><span>Time-weighted</span><Shown v={perf.twr} format={v=>pct(v)}/></div>
   <div><span>Money-weighted</span><Shown v={perf.mwr} format={v=>pct(v)}/></div>
   <div><span>Cash flows in window</span><strong>{perf.flowsInWindow}</strong></div>
   {bench&&<div><span>{bench.label} (GBP)</span>{benchReturn?<Shown v={benchReturn} format={v=>pct(v)}/>:<span className="cc-unavailable">Unavailable<small>Needs a portfolio history first</small></span>}</div>}
  </div>
  {s.length<2?<div className="cc-empty" role="status" data-testid="chart-empty"><strong>No reliable performance history yet</strong><p>{perf.twr.ok?'':`${perf.twr.reason}. `}{perf.observations} stored valuation{perf.observations===1?'':'s'} in this window. The chart is never drawn from the latest balance alone.</p><Link className="cc-fix" href={fixHref}>Synchronise your account on Broker Connections →</Link></div>:
  <figure className="cc-figure"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${mode==='twr'?'Cumulative time-weighted return':'Account value in GBP'}, ${s.length} stored valuations from ${iso(from)} to ${iso(to)}${events.length?`, ${events.length} cash-flow event(s) marked`:''}`} tabIndex={0} onKeyDown={onKey} onBlur={()=>setFocus(null)}>
   {mode==='twr'&&<line x1={P} x2={W-P} y1={Y(0)} y2={Y(0)} className="cc-axis"/>}
   {events.map(e=><g key={e.reference} className={e.amount>=0?'cc-flow-in':'cc-flow-out'}><line x1={X(e.at)} x2={X(e.at)} y1={P/2} y2={H-P/2} className="cc-flow-line"/><text x={X(e.at)>W*0.75?X(e.at)-4:X(e.at)+4} textAnchor={X(e.at)>W*0.75?'end':'start'} y={P/2+10} className="cc-flow-label">{e.amount>=0?'Deposit':'Withdrawal'}</text></g>)}
   {benchPath&&<path d={benchPath} className="cc-bench-line" data-testid="benchmark-line"/>}
   <path d={path} className="cc-line"/>
   {s.map((p,i)=><circle key={p.at} cx={X(p.at)} cy={yOf(p)} r={focus===i?6:3.5} className="cc-dot" onMouseEnter={()=>setFocus(i)} onMouseLeave={()=>setFocus(null)}/>)}
  </svg>
  <figcaption aria-live="polite">{point?`${iso(point.at)} · value ${money(point.value,currency)} · cumulative TWR ${pct(point.cumulativeTwr)}`:'Hover or focus the chart and use the arrow keys to read each stored valuation.'}</figcaption></figure>}
  {events.length>0&&<div className="cc-flow-list" data-testid="flow-events"><strong>Cash-flow events (not performance):</strong> {events.map(e=><span key={e.reference}>{iso(e.at)} {e.amount>=0?'deposit':'withdrawal'} {signedMoney(e.amount,currency)}</span>)}</div>}
  {bench&&<p className="cc-note">{bench.convention}{benchLine?.reason?` ${benchLine.reason}.`:''} <Link className="cc-fix" href={bench.evidenceHref}>Benchmark evidence →</Link></p>}
 </section>;
}
