// GitHub Pages daily-price renderer. Bundled from the newer modular source files.
// Loaded by the existing index.html; no separate module script tags are required.

// ===== shared hooks =====
const { useState, useEffect, useMemo, useCallback, useRef, Fragment } = React;

// ===== parsing.jsx =====
// parsing.jsx
// Core constants, CSV parsing, date/price formatting utilities.
// Must load FIRST — every other file depends on these.

const HE_COLS = Array.from({length: 25}, (_, i) => 'HE' + String(i+1).padStart(2,'0'));
const ONPEAK = new Set([7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]);
const NODE_ID = 'MEADS_2_N101';
const FETCH_COOLDOWN_MS = 10000;
const MONTH_ABBR=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function validPrice(v) { return typeof v === 'number' && Number.isFinite(v); }

function average(xs) { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; }

function dateKey(d) {
  const parts = d.split('/');
  const m = parts[0], dd = parts[1], y = parts[2];
  return y + '-' + m.padStart(2,'0') + '-' + dd.padStart(2,'0');
}

function heatColor(v, min, max) {
  if (!validPrice(v)) return '#343d49';
  const t = max > min ? (v-min)/(max-min) : 0.5;
  const stops = [[205,65,65],[238,187,73],[49,165,100]];
  const segment = t < 0.5 ? 0 : 1;
  const f = t < 0.5 ? t*2 : (t-0.5)*2;
  const a=stops[segment],b=stops[segment+1];
  return 'rgb('+a.map((v,i)=>Math.round(v+(b[i]-v)*f)).join(',')+')';
}

function formatPrice(v) {
  if (v === null || v === undefined || isNaN(v)) return 'N/A';
  return '$' + v.toFixed(2);
}

function addDaysToIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

function medianOf(arr) {
  const s=[...arr].sort((a,b)=>a-b), n=s.length;
  if(!n) return null;
  return n%2 ? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2;
}

function money(v) {return v===null||!Number.isFinite(v)?'—':v.toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0});}

function trendText(recent,prior) {return recent===null||prior===null?'Not enough comparable days':(recent-prior>=0?'+':'')+(recent-prior).toFixed(2)+' $/MWh vs preceding period';}


// ===== analysis-core.jsx =====
// analysis-core.jsx — core stats, audits, seasonal/trend analysis, opportunity/release logic,
// period filtering, holiday detection, and operator dashboard helpers.
// Load AFTER parsing.jsx.

function computeStats(hours) {
  const vals = HE_COLS.map(h => hours[h]).filter(v => v !== null && v !== undefined && !isNaN(v));
  if (vals.length === 0) return null;
  const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const onpeak = [], offpeak = [];
  HE_COLS.forEach(h => {
    const he = parseInt(h.slice(2));
    const v = hours[h];
    if (v === null || v === undefined || isNaN(v)) return;
    if (ONPEAK.has(he)) onpeak.push(v); else offpeak.push(v);
  });
  const onAvg = onpeak.length ? onpeak.reduce((a,b)=>a+b,0)/onpeak.length : null;
  const offAvg = offpeak.length ? offpeak.reduce((a,b)=>a+b,0)/offpeak.length : null;
  const variance = vals.reduce((a,b)=>a+Math.pow(b-avg,2),0) / vals.length;
  const std = Math.sqrt(variance);
  const peakHour = HE_COLS.find(h => hours[h] === max);
  const spread = (onAvg !== null && offAvg !== null) ? (onAvg - offAvg) : null;
  return { avg, min, max, onAvg, offAvg, spread, std, peakHour };
}

function dayAudit(records) {
  if (!records.length) return {missingDays:[], incomplete:[], checked:0};
  const byKey = new Map(records.map(r => [r.key,r]));
  const keys = [...byKey.keys()].sort();
  const missingDays = [], incomplete = [];
  let day = new Date(keys[0]+'T12:00:00Z');
  const end = new Date(keys[keys.length-1]+'T12:00:00Z');
  let checked = 0;
  while (day <= end && checked < 200000) {
    const key = day.toISOString().slice(0,10);
    const record = byKey.get(key);
    if (!record) missingDays.push(key);
    else {
      const hours = HE_COLS.filter(h => !validPrice(record.hours[h]));
      // HE25 is normally absent; DST-specific validity requires source interval metadata.
      const required = hours.filter(h => h !== 'HE25');
      if (required.length) incomplete.push({key, hours:required});
    }
    day.setUTCDate(day.getUTCDate()+1); checked++;
  }
  return {missingDays,incomplete,checked};
}

function peakAnalysis(records, limit) {
  const days = [...records].sort((a,b)=>b.key.localeCompare(a.key)).slice(0,limit);
  const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
  const amHours = Array.from({length:12},(_,i)=>i+1), pmHours = Array.from({length:12},(_,i)=>i+13);
  const entries = days.map(r => {
    const peak = hs => hs.map(h=>({h,v:r.hours['HE'+String(h).padStart(2,'0')]})).filter(x=>validPrice(x.v)).sort((a,b)=>b.v-a.v)[0];
    return {key:r.key,am:peak(amHours),pm:peak(pmHours)};
  }).filter(x=>x.am && x.pm);
  const amAvg = avg(entries.map(x=>x.am.v)), pmAvg = avg(entries.map(x=>x.pm.v));
  const amWins = entries.filter(x=>x.am.v>x.pm.v).length;
  const amCounts = {},pmCounts={};
  entries.forEach(x=>{amCounts[x.am.h]=(amCounts[x.am.h]||0)+1;pmCounts[x.pm.h]=(pmCounts[x.pm.h]||0)+1;});
  const top = counts => Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([h,n])=>'HE'+String(h).padStart(2,'0')+' ('+Math.round(100*n/entries.length)+'%)').join(', ');
  return {entries,amAvg,pmAvg,amWins,amTop:top(amCounts),pmTop:top(pmCounts)};
}

// US federal holidays: actual date and weekday-observed date are separate categories.
function holidayLabel(date) {
  const y=Number(date.slice(0,4));
  function iso(d){return d.toISOString().slice(0,10)}
  function fixed(m,d){return new Date(Date.UTC(y,m-1,d))}
  function nth(m,weekday,n){const first=new Date(Date.UTC(y,m-1,1));return new Date(Date.UTC(y,m-1,1+(weekday-first.getUTCDay()+7)%7+7*(n-1)))}
  function last(m,weekday){const end=new Date(Date.UTC(y,m,0));return new Date(Date.UTC(y,m-1,end.getUTCDate()-(end.getUTCDay()-weekday+7)%7))}
  const actual=[['New Year',fixed(1,1)],['MLK Day',nth(1,1,3)],['Washington Birthday',nth(2,1,3)],['Memorial Day',last(5,1)],['Juneteenth',fixed(6,19)],['Independence Day',fixed(7,4)],['Labor Day',nth(9,1,1)],['Columbus Day',nth(10,1,2)],['Veterans Day',fixed(11,11)],['Thanksgiving',nth(11,4,4)],['Christmas',fixed(12,25)]];
  // Adjacent-year New Year's observance can fall on December 31.
  actual.push(['New Year',new Date(Date.UTC(y+1,0,1))]);
  for(const [name,d] of actual){if(iso(d)===date)return {name,kind:'actual'};}
  for(const [name,d] of actual){if([0,6].includes(d.getUTCDay())){const observed=new Date(d.getTime()+(d.getUTCDay()===6?-1:1)*86400000);if(iso(observed)===date)return {name,kind:'observed'};}}
  return null;
}

function completePeakRows(records) {
  return records.filter(r=>[...Array(12)].every((_,i)=>validPrice(r.hours['HE'+String(i+1).padStart(2,'0')]))&&[...Array(12)].every((_,i)=>validPrice(r.hours['HE'+String(i+13).padStart(2,'0')]))).map(r=>{
    const am=Math.max(...Array.from({length:12},(_,i)=>r.hours['HE'+String(i+1).padStart(2,'0')]));
    const pm=Math.max(...Array.from({length:12},(_,i)=>r.hours['HE'+String(i+13).padStart(2,'0')]));
    return {date:r.key,am,pm,diff:pm-am};
  }).sort((a,b)=>a.date.localeCompare(b.date));
}

function holidayAnalysis(records, monthsBack){
  const all=completePeakRows(records), latest=all.length?all[all.length-1].date:'';
  const cutoff=latest?new Date(Date.UTC(Number(latest.slice(0,4)),Number(latest.slice(5,7))-1-monthsBack,1)).toISOString().slice(0,10):'';
  const groups={weekday:[],weekend:[],actual:[],observed:[]};const holidayDays=[];
  all.filter(r=>r.date>=cutoff).forEach(r=>{
    const h=holidayLabel(r.date),dow=new Date(r.date+'T12:00:00Z').getUTCDay();
    if(h){groups[h.kind].push(r);holidayDays.push({...r,name:h.name,kind:h.kind});}
    else groups[dow===0||dow===6?'weekend':'weekday'].push(r);
  });
  const summary=arr=>({days:arr.length,am:average(arr.map(x=>x.am)),pm:average(arr.map(x=>x.pm)),diff:average(arr.map(x=>x.diff))});
  return {groups:Object.keys(groups).map(key=>({key,...summary(groups[key])})),holidayDays:holidayDays.reverse()};
}

function rollingAnalysis(records,windowSize){
  const rows=completePeakRows(records);
  const points=rows.map((r,i)=>{
    if(i+1<windowSize)return null;
    const a=rows.slice(i+1-windowSize,i+1);
    return {date:r.date,am:average(a.map(x=>x.am)),pm:average(a.map(x=>x.pm)),diff:average(a.map(x=>x.diff))};
  }).filter(Boolean);
  const recent=rows.slice(-windowSize),prior=rows.slice(-2*windowSize,-windowSize);
  const change=recent.length===windowSize&&prior.length===windowSize?['am','pm','diff'].map(k=>{
    const current=average(recent.map(r=>r[k])),previous=average(prior.map(r=>r[k]));
    return {key:k,current,previous,delta:current-previous,pct:previous!==0?100*(current-previous)/Math.abs(previous):null};
  }):[];
  return {points,change};
}

function yearMonthSeries(records){
  const by=new Map();completePeakRows(records).forEach(r=>{
    const key=r.date.slice(0,7),a=by.get(key)||[];a.push(r);by.set(key,a);
  });
  return [...by].map(([key,a])=>({year:Number(key.slice(0,4)),month:Number(key.slice(5,7)),days:a.length,am:average(a.map(r=>r.am)),pm:average(a.map(r=>r.pm)),diff:average(a.map(r=>r.pm-r.am))}));
}

function seasonalSummary(records, monthsBack) {
  const sorted=[...records].sort((a,b)=>b.key.localeCompare(a.key));
  const latest=sorted.length?sorted[0].key.slice(0,7):'';
  const monthKeys=[];
  if(latest){const [y,m]=latest.split('-').map(Number);for(let i=monthsBack-1;i>=0;i--){const d=new Date(Date.UTC(y,m-1-i,1));monthKeys.push(d.toISOString().slice(0,7));}}
  const periods={weekday:[],weekend:[],holiday:[]};
  const monthly=monthKeys.map(month=>{
    const rows=sorted.filter(r=>r.key.slice(0,7)===month);
    const complete=rows.filter(r=>[...Array.from({length:12},(_,i)=>i+1),...Array.from({length:12},(_,i)=>i+13)].every(h=>validPrice(r.hours['HE'+String(h).padStart(2,'0')])));
    const pairs=complete.map(r=>{
      const am=Math.max(...Array.from({length:12},(_,i)=>r.hours['HE'+String(i+1).padStart(2,'0')]));
      const pm=Math.max(...Array.from({length:12},(_,i)=>r.hours['HE'+String(i+13).padStart(2,'0')]));
      const weekday=new Date(r.key+'T12:00:00Z').getUTCDay();
      const type=weekday===0||weekday===6?'weekend':'weekday';
      const entry={am,pm,diff:pm-am,date:r.key};periods[type].push(entry);
      return entry;
    });
    return {month,days:pairs.length,am:average(pairs.map(x=>x.am)),pm:average(pairs.map(x=>x.pm)),diff:average(pairs.map(x=>x.diff)),amWins:pairs.filter(x=>x.am>x.pm).length};
  });
  const summarize=a=>({days:a.length,am:average(a.map(x=>x.am)),pm:average(a.map(x=>x.pm)),diff:average(a.map(x=>x.diff)),amWins:a.filter(x=>x.am>x.pm).length});
  return {monthly,weekday:summarize(periods.weekday),weekend:summarize(periods.weekend)};
}

function trendInsights(records, monthsBack) {
  const complete = records.filter(r => [...Array(12)].every((_,i)=>validPrice(r.hours['HE'+String(i+1).padStart(2,'0')])) && [...Array(12)].every((_,i)=>validPrice(r.hours['HE'+String(i+13).padStart(2,'0')]))).sort((a,b)=>a.key.localeCompare(b.key));
  const rows=complete.map(r=>{
    const am=Math.max(...Array.from({length:12},(_,i)=>r.hours['HE'+String(i+1).padStart(2,'0')]));
    const pm=Math.max(...Array.from({length:12},(_,i)=>r.hours['HE'+String(i+13).padStart(2,'0')]));
    return {date:r.key,am,pm,diff:pm-am};
  });
  const rolling=rows.slice(-120).map((r,i,a)=>{
    const window=a.slice(Math.max(0,i-29),i+1);
    if(window.length<7)return null;
    return {date:r.date,days:window.length,am:average(window.map(x=>x.am)),pm:average(window.map(x=>x.pm)),diff:average(window.map(x=>x.diff))};
  }).filter(Boolean);
  const yearly=new Map();
  rows.forEach(r=>{
    const key=r.date.slice(0,7), a=yearly.get(key)||[];a.push(r);yearly.set(key,a);
  });
  const months=[...yearly.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,Math.max(12,monthsBack)).map(([month,a])=>({month,days:a.length,am:average(a.map(x=>x.am)),pm:average(a.map(x=>x.pm)),diff:average(a.map(x=>x.diff)),amWins:a.filter(x=>x.am>x.pm).length}));
  const last=rows.slice(-30), prior=rows.slice(-60,-30);
  return {rolling,months,change:prior.length>=7&&last.length>=7?{am:average(last.map(x=>x.am))-average(prior.map(x=>x.am)),pm:average(last.map(x=>x.pm))-average(prior.map(x=>x.pm)),diff:average(last.map(x=>x.diff))-average(prior.map(x=>x.diff)),recent:last.length,previous:prior.length}:null};
}

function tomorrowOutlook(records) {
  if (!records.length) return null;
  const latest = [...records].sort((a,b)=>b.key.localeCompare(a.key))[0];
  const tomorrow = addDaysToIso(latest.key,1);
  const weekday = new Date(tomorrow+'T12:00:00Z').getUTCDay();
  const matching = records.filter(r=>new Date(r.key+'T12:00:00Z').getUTCDay()===weekday && r.key<=latest.key).sort((a,b)=>b.key.localeCompare(a.key)).slice(0,8);
  const prices = HE_COLS.slice(0,24).map(h=>{
    const values = matching.map(r=>r.hours[h]).filter(validPrice);
    return {hour:h,price:values.length ? values.reduce((a,b)=>a+b,0)/values.length:null,count:values.length};
  });
  return {tomorrow,matching:matching.length,prices};
}

// ---- Reusable period selection: {mode:'all'} | {mode:'year',year} | {mode:'range',start,end} | {mode:'month',month} ----
function filterByPeriod(records, period) {
  if (!period || period.mode === 'all') return records;
  if (period.mode === 'year') return records.filter(r => r.key.slice(0,4) === String(period.year));
  if (period.mode === 'range') return records.filter(r => (!period.start||r.key>=period.start) && (!period.end||r.key<=period.end));
  if (period.mode === 'month') return records.filter(r => Number(r.key.slice(5,7)) === period.month);
  return records;
}

function periodLabel(period) {
  if (!period || period.mode === 'all') return 'All available data';
  if (period.mode === 'year') return String(period.year);
  if (period.mode === 'range') return (period.start||'…')+' to '+(period.end||'…');
  if (period.mode === 'month') return MONTH_ABBR[period.month-1]+' (all years)';
  return '';
}

function opportunity(records, count, premium) {
  const days=[...records].sort((a,b)=>b.key.localeCompare(a.key)).slice(0,count);
  const hours=(r,from,to)=>Array.from({length:to-from+1},(_,i)=>({he:from+i,price:r.hours['HE'+String(from+i).padStart(2,'0')]}));
  const complete=days.filter(r=>hours(r,1,12).concat(hours(r,13,24)).every(x=>validPrice(x.price)));
  const entries=complete.map(r=>{
    const am=hours(r,1,12),pm=hours(r,13,24);
    const best=arr=>arr.reduce((a,b)=>a.price>=b.price?a:b);
    const a=best(am),b=best(pm);
    // "Premium" = peak price minus the median of the OTHER 11 hours in its own window — measures how
    // decisive the peak is (a sharp spike vs. a flat plateau) without relying on hours outside the window.
    const amOthers=am.filter(x=>x.he!==a.he).map(x=>x.price);
    const pmOthers=pm.filter(x=>x.he!==b.he).map(x=>x.price);
    const amMed=medianOf(amOthers), pmMed=medianOf(pmOthers);
    return {key:r.key,am:a,pm:b,amPremium:amMed===null?null:a.price-amMed,pmPremium:pmMed===null?null:b.price-pmMed,spread:a.price-b.price};
  });
  const amPeaks=entries.filter(x=>x.amPremium!==null&&x.amPremium>=premium);
  const pmPeaks=entries.filter(x=>x.pmPremium!==null&&x.pmPremium>=premium);
  const recent=entries.slice(0,Math.min(7,entries.length));
  const prior=entries.slice(7,Math.min(21,entries.length));
  const hourly=(from,to)=>Array.from({length:to-from+1},(_,i)=>{
    const he=from+i,key='HE'+String(he).padStart(2,'0');
    const vals=complete.map(r=>r.hours[key]);
    return {he:key,mean:average(vals),count:vals.length};
  }).sort((a,b)=>b.mean-a.mean);
  return {entries,amPeaks,pmPeaks,avgAmPremium:average(entries.map(x=>x.amPremium).filter(validPrice)),avgPmPremium:average(entries.map(x=>x.pmPremium).filter(validPrice)),amHours:hourly(1,12),pmHours:hourly(13,24),recentAM:average(recent.map(x=>x.am.price)),priorAM:average(prior.map(x=>x.am.price)),recentPM:average(recent.map(x=>x.pm.price)),priorPM:average(prior.map(x=>x.pm.price)),amWins:entries.filter(x=>x.spread>0).length,avgSpread:average(entries.map(x=>x.spread)),premium};
}

function bestWindows(prices, n, start, end) {
  const values=prices.filter(x=>x.he>=start&&x.he<=end&&validPrice(x.price));
  const chosen=[...values].sort((a,b)=>b.price-a.price).slice(0,n).sort((a,b)=>a.he-b.he);
  return {chosen,mean:average(chosen.map(x=>x.price)),total:chosen.reduce((a,b)=>a+b.price,0)};
}

function releaseComparison(prices, n, mwh) {
  const am=bestWindows(prices,n,1,12),pm=bestWindows(prices,n,13,24);
  const all=bestWindows(prices,n,1,24);
  const energy=Number(mwh);
  return {am,pm,all,amRevenue:am.mean===null?null:am.mean*energy,pmRevenue:pm.mean===null?null:pm.mean*energy,allRevenue:all.mean===null?null:all.mean*energy};
}

// V10: only complete AM/PM days enter the opportunity calendar and migration statistics.
function opportunityRows(records){
  return records.map(r=>{
    const best=(first,last)=>{const vals=[];for(let h=first;h<=last;h++){const v=r.hours['HE'+String(h).padStart(2,'0')];if(!validPrice(v))return null;vals.push({hour:h,price:v});}
      const sorted=[...vals].sort((a,b)=>b.price-a.price);
      return sorted.length?{...sorted[0], margin: sorted.length>1?sorted[0].price-sorted[1].price:null}:null;};
    const am=best(1,12),pm=best(13,24);
    return am&&pm?{date:r.key,am,pm,advantage:am.price-pm.price}:null;
  }).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date));
}
// ---- Operator-focused Dashboard helpers ----

// Latest stored operating day + its hourly shape, peak window(s), negative hours.
// Peak detection runs separately on AM (HE01-12) and PM (HE13-24) halves, consistent
// with how the rest of the app treats morning/evening — avoids bridging across the
// midday valley into one falsely-wide "peak window".
function latestDayShape(records) {
  if (!records.length) return null;
  const latest = [...records].sort((a,b)=>b.key.localeCompare(a.key))[0];
  const hours = HE_COLS.slice(0,24).map((h,i) => ({ he:i+1, label:h, price: latest.hours[h] }));
  const valid = hours.filter(x => validPrice(x.price));
  if (!valid.length) return { key: latest.key, hours, valid:[], peakWindows:[], negativeHours:[], stats:null };

  const stats = computeStats(latest.hours);

  function peakWindowIn(from, to) {
    const slice = valid.filter(x => x.he >= from && x.he <= to);
    if (!slice.length) return null;
    const maxPrice = Math.max(...slice.map(x=>x.price));
    const threshold = maxPrice * 0.85;
    const hes = slice.filter(x => x.price >= threshold).map(x=>x.he).sort((a,b)=>a-b);
    return hes.length ? { from: hes[0], to: hes[hes.length-1], hours: hes, maxPrice } : null;
  }

  const amWindow = peakWindowIn(1, 12);
  const pmWindow = peakWindowIn(13, 24);
  const peakWindows = [amWindow, pmWindow].filter(Boolean);

  const negativeHours = valid.filter(x => x.price < 0).map(x=>x.he);

  return { key: latest.key, hours, valid, peakWindows, negativeHours, stats };
}

// How does the latest day / recent week compare to the seasonal (same-month, prior years) norm?
// Computed separately for AM (HE01-12 peak) and PM (HE13-24 peak) so a strong evening
// season isn't diluted by averaging against a flatter morning, or vice versa.
function seasonalContext(records) {
  if (!records.length) return null;
  const sorted = [...records].sort((a,b)=>b.key.localeCompare(a.key));
  const latest = sorted[0];
  const latestMonth = latest.key.slice(5,7);
  const latestYear = latest.key.slice(0,4);

  function halfMax(hoursObj, from, to) {
    let best = null;
    for (let h = from; h <= to; h++) {
      const v = hoursObj['HE'+String(h).padStart(2,'0')];
      if (validPrice(v) && (best === null || v > best)) best = v;
    }
    return best;
  }

  const recent7 = sorted.slice(0,7);
  const recentAmVals = recent7.map(r=>halfMax(r.hours,1,12)).filter(v=>v!==null);
  const recentPmVals = recent7.map(r=>halfMax(r.hours,13,24)).filter(v=>v!==null);
  const recentAm = recentAmVals.length ? average(recentAmVals) : null;
  const recentPm = recentPmVals.length ? average(recentPmVals) : null;

  const priorSameMonth = records.filter(r =>
    r.key.slice(5,7) === latestMonth && r.key.slice(0,4) !== latestYear
  );
  const normAmVals = priorSameMonth.map(r=>halfMax(r.hours,1,12)).filter(v=>v!==null);
  const normPmVals = priorSameMonth.map(r=>halfMax(r.hours,13,24)).filter(v=>v!==null);
  const normAm = normAmVals.length ? average(normAmVals) : null;
  const normPm = normPmVals.length ? average(normPmVals) : null;

  function pctDiff(recent, norm) {
    if (recent === null || norm === null || norm === 0) return null;
    return (recent - norm) / Math.abs(norm) * 100;
  }

  return {
    latestMonth: MONTH_ABBR[Number(latestMonth)-1],
    am: { recent: recentAm, norm: normAm, pct: pctDiff(recentAm, normAm) },
    pm: { recent: recentPm, norm: normPm, pct: pctDiff(recentPm, normPm) },
    normYears: [...new Set(priorSameMonth.map(r=>r.key.slice(0,4)))].length
  };
}

// Plain-language operational action signals derived from the latest day + context.
function actionSignals(shape, context) {
  const signals = [];
  if (!shape || !shape.valid.length) return signals;

  // Peak window signals — one per AM/PM window found
  if (shape.peakWindows && shape.peakWindows.length) {
    shape.peakWindows.forEach(pw => {
      const eveningPeak = pw.from >= 13;
      signals.push({
        tone: 'opportunity',
        icon: '▲',
        text: `${eveningPeak?'Evening':'Morning'} peak window HE${String(pw.from).padStart(2,'0')}–HE${String(pw.to).padStart(2,'0')} (up to ${formatPrice(pw.maxPrice)}) on ${shape.key}${eveningPeak ? ' — hold water for these hours if timing is flexible.' : '.'}`
      });
    });
  }

  // Negative price signal
  if (shape.negativeHours.length) {
    const hrs = shape.negativeHours.map(h=>'HE'+String(h).padStart(2,'0')).join(', ');
    signals.push({
      tone: 'caution',
      icon: '▼',
      text: `${shape.negativeHours.length} negative-price hour(s) on ${shape.key} (${hrs}) — generating costs money in these hours; minimize or defer output if operationally possible.`
    });
  }

  // Spread / flexibility value signal
  if (shape.stats) {
    const spread = shape.stats.max - shape.stats.min;
    if (spread > 40) {
      signals.push({
        tone: 'opportunity',
        icon: '◆',
        text: `Wide intraday spread (${formatPrice(spread)}) on ${shape.key} — concentrating output in the best hours is worth notably more than running flat.`
      });
    } else if (spread < 12) {
      signals.push({
        tone: 'neutral',
        icon: '—',
        text: `Narrow intraday spread (${formatPrice(spread)}) on ${shape.key} — little to gain from shaping release timing; flat operation captures nearly the same value.`
      });
    }
  }

  // Seasonal context signals — AM and PM assessed separately
  if (context) {
    [['am','Morning'],['pm','Evening']].forEach(([key,label]) => {
      const c = context[key];
      if (c && c.pct !== null && Math.abs(c.pct) >= 10) {
        const above = c.pct >= 0;
        signals.push({
          tone: above ? 'opportunity' : 'caution',
          icon: above ? '▲' : '▼',
          text: `${label} prices are ${c.pct>=0?'+':''}${c.pct.toFixed(0)}% vs the typical ${context.latestMonth} ${label.toLowerCase()} peak (prior years) — ${above ? 'a favorable period for drawdown if water and constraints allow.' : 'a weaker-than-usual period; consider conserving water for a richer window if flexibility exists.'}`
        });
      }
    });
  }

  if (!signals.length) {
    signals.push({ tone:'neutral', icon:'—', text:'No strong directional signals from the latest stored day.' });
  }
  return signals;
}


// ===== analysis-regimes.jsx =====
// analysis-regimes.jsx
// Regime detection (K-means on price-shape features) and price-duration/CVaR tail-risk analysis.
// Depends on parsing.jsx and analysis-core.jsx. Load AFTER those two files.

// ---- Regime detection (K-means on price-shape features) ----
// No weather/solar data exists in this app's schema, so feature set is limited to price-shape proxies derived
// from HE01-25 only. Regimes are labeled from their discovered centroid shape, not assumed weather causes.
function dayFeatures(r) {
  const vals = HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice);
  if (vals.length < 20) return null; // require a mostly-complete day for stable features
  const avg = average(vals);
  const peak = Math.max(...vals);
  const offpeak = Math.min(...vals);
  const variance = vals.reduce((a,b)=>a+Math.pow(b-avg,2),0)/vals.length;
  const std = Math.sqrt(variance);
  const spread = peak - offpeak;
  const get = h => r.hours['HE'+String(h).padStart(2,'0')];
  const middayVals = [11,12,13,14].map(get).filter(validPrice);
  const middaySlump = middayVals.length ? average(middayVals) - avg : null;
  const eveBefore = [15,16].map(get).filter(validPrice);
  const eveAfter = [17,18,19].map(get).filter(validPrice);
  const eveningRamp = (eveBefore.length && eveAfter.length) ? average(eveAfter)-average(eveBefore) : null;
  const peakHourIdx = HE_COLS.slice(0,24).findIndex(h=>r.hours[h]===peak)+1;
  const dow = new Date(r.key+'T12:00:00Z').getUTCDay();
  const isWeekend = dow===0||dow===6;
  if (middaySlump===null || eveningRamp===null) return null;
  return {key:r.key, avg, peak, offpeak, std, spread, middaySlump, eveningRamp, peakHourIdx, isWeekend};
}

function zscoreMatrix(matrix) {
  const nFeat = matrix[0].length;
  const means = Array(nFeat).fill(0), stds = Array(nFeat).fill(0);
  matrix.forEach(row => row.forEach((v,i) => means[i]+=v));
  means.forEach((m,i)=>means[i]=m/matrix.length);
  matrix.forEach(row => row.forEach((v,i) => stds[i]+=(v-means[i])**2));
  stds.forEach((s,i)=>stds[i]=Math.sqrt(s/matrix.length)||1);
  return matrix.map(row => row.map((v,i)=>(v-means[i])/stds[i]));
}

function kmeans(data, k, iterations=100, seed=42) {
  let rngState = seed;
  const rng = () => { rngState = (rngState*1103515245+12345)&0x7fffffff; return rngState/0x7fffffff; };
  const n = data.length;
  const centroids = [data[Math.floor(rng()*n)]];
  while (centroids.length < k) {
    const dists = data.map(p => Math.min(...centroids.map(c => p.reduce((s,v,i)=>s+(v-c[i])**2,0))));
    const sum = dists.reduce((a,b)=>a+b,0);
    let r = rng()*sum, idx=0;
    if (sum===0) { idx = Math.floor(rng()*n); }
    else { for (;idx<n;idx++){ r-=dists[idx]; if(r<=0)break; } }
    centroids.push(data[Math.min(idx,n-1)]);
  }
  let assign = new Array(n).fill(0);
  for (let it=0; it<iterations; it++) {
    let changed = false;
    for (let i=0;i<n;i++) {
      let best=0, bestD=Infinity;
      for (let c=0;c<k;c++) {
        const d = data[i].reduce((s,v,j)=>s+(v-centroids[c][j])**2,0);
        if (d<bestD){bestD=d;best=c;}
      }
      if (assign[i]!==best){assign[i]=best;changed=true;}
    }
    const newC = Array.from({length:k},()=>Array(data[0].length).fill(0));
    const counts = Array(k).fill(0);
    for (let i=0;i<n;i++){ counts[assign[i]]++; data[i].forEach((v,j)=>newC[assign[i]][j]+=v); }
    for (let c=0;c<k;c++) if(counts[c]>0) newC[c]=newC[c].map(v=>v/counts[c]); else newC[c]=centroids[c];
    centroids.forEach((c,i)=>centroids[i]=newC[i]);
    if (!changed && it>0) break;
  }
  const inertia = data.reduce((s,p,i)=>s+p.reduce((ss,v,j)=>ss+(v-centroids[assign[i]][j])**2,0),0);
  return {assign, centroids, inertia};
}

const REGIME_FEATURE_NAMES = ['avg','peak','offpeak','std','spread','middaySlump','eveningRamp','peakHourIdx'];

function regimeLabel(c) {
  const [avg,peak,offpeak,std,spread,middaySlump,eveningRamp,peakHourIdx] = c;
  const parts = [];
  if (middaySlump < -15) parts.push('Midday dip');
  if (eveningRamp > 15) parts.push('Sharp evening ramp');
  if (peakHourIdx <= 10) parts.push('Morning-peaking');
  else if (peakHourIdx >= 17 && peakHourIdx <= 20) parts.push('Evening-peaking');
  if (spread > 60) parts.push('High spread');
  else if (spread < 20) parts.push('Flat/low-volatility');
  if (!parts.length) parts.push('Typical day');
  return parts.slice(0,3).join(' · ');
}

function runRegimeDetection(records, k) {
  const feats = records.map(dayFeatures).filter(Boolean);
  if (feats.length < k*3) return null;
  const matrix = feats.map(f=>REGIME_FEATURE_NAMES.map(n=>f[n]));
  const z = zscoreMatrix(matrix);
  const {assign, inertia} = kmeans(z, k);
  const clusters = Array.from({length:k},(_,c)=>{
    const idxs = assign.map((a,i)=>a===c?i:-1).filter(i=>i>=0);
    const members = idxs.map(i=>feats[i]);
    const centroidRaw = REGIME_FEATURE_NAMES.map(n=>average(members.map(m=>m[n])));
    const weekendShare = members.filter(m=>m.isWeekend).length/Math.max(1,members.length);
    return {id:c, n:members.length, centroid:centroidRaw, label:regimeLabel(centroidRaw), members, weekendShare,
      avgPrice:average(members.map(m=>m.avg)), avgPeak:average(members.map(m=>m.peak)), avgSpread:average(members.map(m=>m.spread))};
  }).sort((a,b)=>b.n-a.n);
  return {clusters, inertia, totalDays:feats.length};
}

function elbowSeries(records, maxK) {
  const feats = records.map(dayFeatures).filter(Boolean);
  if (feats.length < 6) return [];
  const matrix = feats.map(f=>REGIME_FEATURE_NAMES.map(n=>f[n]));
  const z = zscoreMatrix(matrix);
  const out = [];
  for (let k=2;k<=maxK;k++) {
    if (feats.length < k*3) break;
    const {inertia} = kmeans(z,k);
    out.push({k, inertia});
  }
  return out;
}

// ---- Price-duration curves & tail risk (CVaR) ----
function priceDurationAnalysis(prices, percentiles) {
  const sorted = [...prices].filter(validPrice).sort((a,b)=>b-a);
  const n = sorted.length;
  if (!n) return null;
  const pctValues = percentiles.map(p => {
    const idx = Math.min(n-1, Math.floor((1-p/100)*n));
    return {p, value: sorted[idx]};
  });
  const cvar = percentiles.map(p => {
    const threshold = pctValues.find(x=>x.p===p).value;
    const tail = sorted.filter(v=>v>=threshold);
    return {p, threshold, cvar: average(tail), count:tail.length, pctOfHours: tail.length/n*100};
  });
  const targetPoints = 220;
  const step = Math.max(1, Math.floor(n/targetPoints));
  const curve = [];
  for (let i=0;i<n;i+=step) curve.push({pctHours:i/n*100, price:sorted[i]});
  if (curve[curve.length-1].pctHours < 99.5) curve.push({pctHours:100, price:sorted[n-1]});
  return {n, pctValues, cvar, curve};
}

function seasonHours(records, seasonMonths) {
  const inSeason = r => seasonMonths.includes(Number(r.key.slice(5,7)));
  return records.filter(inSeason).flatMap(r=>HE_COLS.slice(0,24).map(h=>r.hours[h])).filter(validPrice);
}

// ---- Dataset-wide exploration statistics ----
// Add this block anywhere in analysis-regimes.jsx (e.g. above SEASON_DEFS, or at end of file).
// Reconstructed from call sites in charts.jsx / ask.jsx / report.jsx — field names match exactly.

function allHourlyPrices(records) {
  return records.flatMap(r => HE_COLS.slice(0,24).map(h => r.hours[h])).filter(validPrice);
}

function datasetSummary(records) {
  const totalDays = records.length;
  const allPrices = allHourlyPrices(records);
  const totalHours = allPrices.length;
  const overallAvg = average(allPrices);
  const overallStd = overallAvg===null ? null : Math.sqrt(average(allPrices.map(v=>(v-overallAvg)**2)));

  const byMonth = new Map();
  records.forEach(r => {
    const key = MONTH_ABBR[Number(r.key.slice(5,7))-1];
    const vals = HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(...vals);
  });
  const monthDays = new Map();
  records.forEach(r => {
    const key = MONTH_ABBR[Number(r.key.slice(5,7))-1];
    monthDays.set(key, (monthDays.get(key)||0)+1);
  });
  const monthRank = [...byMonth.entries()]
    .map(([label, vals]) => ({label, avg: average(vals), n: monthDays.get(label)||0}))
    .filter(m => m.avg !== null)
    .sort((a,b)=>b.avg-a.avg);

  const byYear = new Map();
  const yearDays = new Map();
  records.forEach(r => {
    const key = r.key.slice(0,4);
    const vals = HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice);
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push(...vals);
    yearDays.set(key, (yearDays.get(key)||0)+1);
  });
  const yearRank = [...byYear.entries()]
    .map(([label, vals]) => ({label, avg: average(vals), n: yearDays.get(label)||0}))
    .filter(y => y.avg !== null)
    .sort((a,b)=>b.avg-a.avg);

  const DOW_LABELS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const byDow = new Map();
  const dowDays = new Map();
  records.forEach(r => {
    const dow = new Date(r.key+'T12:00:00Z').getUTCDay();
    const label = DOW_LABELS[dow];
    const vals = HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice);
    if (!byDow.has(label)) byDow.set(label, []);
    byDow.get(label).push(...vals);
    dowDays.set(label, (dowDays.get(label)||0)+1);
  });
  const dowRank = [...byDow.entries()]
    .map(([label, vals]) => ({label, avg: average(vals), n: dowDays.get(label)||0}))
    .filter(d => d.avg !== null)
    .sort((a,b)=>b.avg-a.avg);

  return { totalDays, totalHours, overallAvg, overallStd, monthRank, yearRank, dowRank };
}

function dailyAverageSeries(records) {
  const sorted = [...records].sort((a,b)=>a.key.localeCompare(b.key));
  const points = sorted.map(r => {
    const vals = HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice);
    return { date: r.key, avg: vals.length ? average(vals) : null };
  }).filter(p => p.avg !== null);
  points.forEach((p,i) => {
    const window = points.slice(Math.max(0,i-6), i+1);
    p.rollingAvg = average(window.map(x=>x.avg));
  });
  return points;
}

function dailyVolatility(records) {
  const sorted = [...records].sort((a,b)=>a.key.localeCompare(b.key));
  const points = sorted.map(r => {
    const vals = HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice);
    if (vals.length < 2) return null;
    const avg = average(vals);
    const std = Math.sqrt(average(vals.map(v=>(v-avg)**2)));
    return { date: r.key, std };
  }).filter(Boolean);
  points.forEach((p,i) => {
    const window = points.slice(Math.max(0,i-6), i+1);
    p.rollingStd = average(window.map(x=>x.std));
  });
  return points;
}

function monthlyBoxStats(records) {
  const byMonth = new Map();
  records.forEach(r => {
    const key = r.key.slice(0,7);
    const vals = HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(...vals);
  });
  return [...byMonth.entries()]
    .sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([month, vals]) => ({month, vals}))
    .filter(m => m.vals.length);
}

function hourOfDayAverage(records) {
  return HE_COLS.slice(0,24).map((h,i) => {
    const vals = records.map(r=>r.hours[h]).filter(validPrice);
    return { hour: i+1, avg: vals.length ? average(vals) : null, n: vals.length };
  });
}

function monthHourHeatmap(records) {
  const byMonth = new Map();
  records.forEach(r => {
    const key = r.key.slice(0,7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(r);
  });
  const months = [...byMonth.keys()].sort();
  const matrix = months.map(month => {
    const rs = byMonth.get(month);
    return HE_COLS.slice(0,24).map(h => {
      const vals = rs.map(r=>r.hours[h]).filter(validPrice);
      return vals.length ? average(vals) : null;
    });
  });
  return { months, matrix };
}

const SEASON_DEFS = [
  {key:'winter',label:'Winter (Dec–Feb)',months:[12,1,2]},
  {key:'spring',label:'Spring (Mar–May)',months:[3,4,5]},
  {key:'summer',label:'Summer (Jun–Aug)',months:[6,7,8]},
  {key:'fall',label:'Fall (Sep–Nov)',months:[9,10,11]},
];


// ===== charts.jsx =====
// charts.jsx
// All chart components (Plotly wrapper + every chart type used across the app) plus
// a few chart-adjacent interactive panels (OpportunityCalendar, HourDetail, PeriodPicker,
// SummaryStatsPanel, LatestDayCurve). Depends on parsing.jsx and analysis-core.jsx.
// Load AFTER those two files, BEFORE analysis-negative.jsx and analysis-ask.jsx.

// Shared Plotly wrapper: handles missing-library fallback, theme colors, and resize once for every chart.
function PlotlyChart({traces, layout, config, onPointClick, fallback, height, style}) {
  const ref = useRef(null);
  const [missing, setMissing] = useState(typeof window.Plotly === 'undefined');
  const clickHandler = useRef(onPointClick);
  clickHandler.current = onPointClick;
  useEffect(() => {
    if (typeof window.Plotly === 'undefined') { setMissing(true); return; }
    if (!ref.current) return;
    const isLight = document.querySelector('.theme-light') !== null;
    const fg = isLight ? '#182b3c' : '#eaf3f7';
    const grid = isLight ? '#dce4ed' : '#34404e';
    const mergedLayout = {
      autosize: true,
      height: height || 360,
      margin: {l:56,r:16,t:10,b:44},
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: {color: fg, size: 12},
      hovermode: 'closest',
      hoverlabel: {bgcolor: isLight?'#172c3b':'#1c2430', bordercolor: isLight?'#dce4ed':'#3a4556', font:{color: isLight?'#f8fafc':'#eaf3f7', size:12}},
      ...layout,
      xaxis: {gridcolor: grid, zeroline:false, ...(layout&&layout.xaxis)},
      yaxis: {gridcolor: grid, zeroline:false, ...(layout&&layout.yaxis)}
    };
    const mergedConfig = {responsive:true, displaylogo:false, modeBarButtonsToRemove:['lasso2d','select2d'], scrollZoom:true, ...config};
    let failed = false;
    try {
      window.Plotly.react(ref.current, traces, mergedLayout, mergedConfig);
    } catch (e) {
      console.error('Plotly render failed:', e);
      failed = true;
      setMissing(true);
    }
    if (!failed && clickHandler.current) {
      const handler = (evt) => {
        const p = evt.points && evt.points[0];
        if (!p) return;
        clickHandler.current(p.customdata !== undefined ? p.customdata : {x:p.x,y:p.y,curveNumber:p.curveNumber,pointIndex:p.pointIndex});
      };
      ref.current.on('plotly_click', handler);
      return () => { try { ref.current && ref.current.removeAllListeners && ref.current.removeAllListeners('plotly_click'); } catch(e){} };
    }
  }, [traces, layout, config, height]);
  if (missing) return fallback || <p className="insight-note">Interactive charting library failed to load (likely no internet access, or a local file issue). Static fallback not available for this chart.</p>;
  return <div ref={ref} style={{width:'100%', ...style}}/>;
}

function SimplePriceDurationChart({curves}) {
  const width=880,height=320,pad={l:56,r:16,t:14,b:32};
  const all=curves.flatMap(c=>c.points.map(p=>p.price)).filter(validPrice);
  if(!all.length) return null;
  let lo=Math.min(0,...all), hi=Math.max(...all);
  const x=v=>pad.l+(width-pad.l-pad.r)*v/100;
  const y=v=>height-pad.b-(v-lo)/(hi-lo||1)*(height-pad.t-pad.b);
  return <><div className="chart-legend">{curves.map(c=><span key={c.name} style={{color:c.color}}>● {c.name}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price duration curves" style={{width:'100%',height:'auto'}}>
      {[0,0.25,0.5,0.75,1].map(t=>{const v=lo+(hi-lo)*t;return <g key={t}><line x1={pad.l} y1={y(v)} x2={width-pad.r} y2={y(v)} stroke="#34404e"/><text x="3" y={y(v)+4} fill="#b6c4d0">${v.toFixed(0)}</text></g>})}
      {[0,25,50,75,100].map(p=><text key={p} x={x(p)} y={height-10} textAnchor="middle" fill="#b6c4d0" fontSize="11">{p}%</text>)}
      {curves.map(c=><polyline key={c.name} fill="none" stroke={c.color} strokeWidth="2.5" points={c.points.map(p=>`${x(p.pctHours)},${y(p.price)}`).join(' ')}/>)}
      <text x={width/2} y={height-2} textAnchor="middle" fill="#8199a9" fontSize="11">% of hours price was at or above this level</text>
    </svg></>;
}

function PriceDurationChart({curves}) {
  const all=curves.flatMap(c=>c.points.map(p=>p.price)).filter(validPrice);
  if (!all.length) return <p className="insight-note">Not enough price history for a duration curve.</p>;
  const traces = curves.map(c => ({
    type:'scatter', mode:'lines', x: c.points.map(p=>p.pctHours), y: c.points.map(p=>p.price),
    name: c.name, line: {color: c.color, width: 2.5},
    hovertemplate: '%{x:.1f}% of hours ≥ $%{y:.2f}<extra>'+c.name+'</extra>'
  }));
  const layout = {
    height: 420,
    xaxis: {title:'% of hours at or above this price', rangeslider:{visible:true, thickness:0.08}},
    yaxis: {title:'$/MWh'},
    legend: {orientation:'h', y:1.12}
  };
  return <div className="chart-panel">
    <strong>Price-duration curves</strong>
    <PlotlyChart traces={traces} layout={layout} height={420} fallback={
      <div className="msg warn" style={{marginTop:10}}>Interactive charting library failed to load. Showing a static fallback instead.<SimplePriceDurationChart curves={curves}/></div>
    }/>
    <p className="insight-note">Each curve sorts that season's hourly prices from highest to lowest. Scroll or pinch to zoom, drag to pan, use the range slider below the axis, or double-click to reset. A steep left edge means extreme prices occur but rarely; a flat curve means prices stay consistently close to average.</p>
  </div>;
}

function DailyBarChart({days}) {
  const vals=days.map(r=>{const st=computeStats(r.hours);return st?st.avg:null;});
  const points=days.map((r,i)=>({date:r.key,value:vals[i]})).filter(p=>validPrice(p.value));
  if(!points.length)return <div className="empty">No daily averages available</div>;
  const traces=[{
    type:'bar', x:points.map(p=>p.date), y:points.map(p=>p.value),
    marker:{color:points.map(p=>p.value>=0?'#35c4ae':'#ed8b7c')},
    hovertemplate:'%{x}<br>$%{y:.2f}/MWh<extra></extra>'
  }];
  const layout={height:300, yaxis:{title:'$/MWh'}, xaxis:{tickangle:-35}};
  return <PlotlyChart traces={traces} layout={layout} height={300}/>;
}

function HourlyBoxPlot({records,days,month,label}){
 const included = month!==undefined ? records.filter(r=>Number(r.key.slice(5,7))===month+1) : (()=>{const sorted=[...records].sort((a,b)=>b.key.localeCompare(a.key));const cutoff=sorted.length?addDaysToIso(sorted[0].key,-days+1):'';return sorted.filter(r=>r.key>=cutoff);})();
 const hourData=HE_COLS.slice(0,24).map((h,i)=>({h,i,vals:included.map(r=>r.hours[h]).filter(validPrice)})).filter(d=>d.vals.length);
 if(!hourData.length)return <p>No hourly data in this period.</p>;
 const traces=hourData.map(d=>({
   type:'box', name:String(d.i+1), y:d.vals, x: d.vals.map(()=>String(d.i+1)),
   marker:{color:'#3b82b6'}, line:{color:'#64748b'}, boxmean:false,
   hovertemplate:'HE'+String(d.i+1).padStart(2,'0')+'<br>$%{y:.2f}<extra></extra>'
 }));
 const layout={height:340, showlegend:false, xaxis:{title:'Hour ending', type:'category', categoryorder:'array', categoryarray:hourData.map(d=>String(d.i+1))}, yaxis:{title:'$/MWh'}};
 return <div className="chart-panel"><strong>{label||('Hourly price box plots ('+included.length+' stored days)')}</strong><PlotlyChart traces={traces} layout={layout} height={340}/><p className="insight-note">Box = 25th–75th percentile, line = median, whiskers = min/max, dots beyond whiskers are outliers. Hover for exact values. Zoom and pan are enabled.</p></div>
}

function OpportunityCalendar({rows,month,onDay}){
  const filtered=rows.filter(r=>Number(r.date.slice(5,7))===month+1);
  const cells=Array.from({length:new Date(Date.UTC(2024,month+1,0)).getUTCDate()},(_,i)=>{const day=i+1,rs=filtered.filter(r=>Number(r.date.slice(8,10))===day);return {day,n:rs.length,am:average(rs.map(r=>r.am.price)),pm:average(rs.map(r=>r.pm.price)),premium:average(rs.map(r=>r.pm.price-r.am.price)),pmWins:rs.filter(r=>r.pm.price>r.am.price).length,rs};});
  return <div className="op-calendar"><p className="insight-note">Each cell represents the same calendar day across every stored year (for example, July 15 across 2023–2026). Values are averages of daily PM peak minus AM peak; green indicates an evening premium. Click a day to see its underlying observations.</p><div className="month-day-grid">{cells.map(c=><button key={c.day} className={'month-day '+(!c.n?'no-data':c.premium>=0?'pm-win':'am-win')} onClick={()=>onDay(c)} title={c.n?`Day ${c.day}: PM premium ${formatPrice(c.premium)}; AM ${formatPrice(c.am)}; PM ${formatPrice(c.pm)}; ${c.n} observations`:'No complete observations'}><b>{c.day}</b><strong>{c.n?formatPrice(c.premium):'—'}</strong><small>{c.n?`${c.pmWins}/${c.n} PM wins`:'No data'}</small></button>)}</div></div>;
}

function HourDetail({records,hour,threshold,onClose}){
 const he='HE'+String(hour).padStart(2,'0'),rows=[...records].filter(r=>validPrice(r.hours[he])).sort((a,b)=>b.key.localeCompare(a.key));
 const recent=rows.slice(0,30),mean=average(recent.map(r=>r.hours[he])),wins=recent.filter(r=>r.hours[he]>threshold).length;
 return <div className="card focus-detail"><div className="panel-heading"><h3>{he} · Hourly release-planning detail</h3><button onClick={onClose}>Close</button></div><div className="metric-pills"><span>30-observation average: <b>{formatPrice(mean)}</b></span><span>Above ${threshold}: <b>{recent.length?Math.round(wins/recent.length*100):0}%</b></span><span>Valid observations: <b>{recent.length}</b></span></div><p className="insight-note">Historical pricing opportunity only; compare against other hours and facility operating constraints. No generation volume assumed.</p><div className="detail-table"><table><thead><tr><th>Operating date</th><th>{he} price</th></tr></thead><tbody>{recent.slice(0,20).map(r=><tr key={r.key}><td>{r.key}</td><td>{formatPrice(r.hours[he])}</td></tr>)}</tbody></table></div></div>;
}

function ProbabilityChart({records,threshold,days,onHour}){
  const latest=[...records].sort((a,b)=>b.key.localeCompare(a.key))[0];const cutoff=latest?addDaysToIso(latest.key,-days+1):'';
  const selected=records.filter(r=>r.key>=cutoff);
  const stats=Array.from({length:24},(_,i)=>{const hour='HE'+String(i+1).padStart(2,'0');const prices=selected.map(r=>r.hours[hour]).filter(validPrice);const above=prices.filter(v=>v>threshold).length;return {hour,i:i+1,n:prices.length,above,pct:prices.length?above/prices.length*100:null};});
  const traces=[{
    type:'bar', x:stats.map(s=>s.i), y:stats.map(s=>s.pct||0),
    marker:{color:'#158c78'}, customdata:stats.map(s=>s.i),
    hovertemplate:'HE%{x}<br>%{y:.1f}%% above $'+threshold+'<extra></extra>'
  }];
  const layout={height:360, yaxis:{title:'% of days above threshold', range:[0,100]}, xaxis:{title:'Hour ending', dtick:1}};
  return <div className="chart-panel"><strong>Hourly probability of exceeding ${threshold}/MWh</strong><PlotlyChart traces={traces} layout={layout} height={360} onPointClick={(hourIdx)=>onHour(hourIdx)}/><p className="insight-note">Denominator is the number of stored days with a valid price for that hour in the selected calendar window ({selected.length} stored days). Strictly greater than threshold; missing hours excluded. Click a bar for hourly detail.</p></div>;
}

function MigrationChart({rows,windowDays,onWeek}){
  const latest=rows.length?rows[rows.length-1].date:'';const cutoff=latest?addDaysToIso(latest,-windowDays+1):'';
  const selected=rows.filter(r=>r.date>=cutoff);
  const weekly=new Map();selected.forEach(r=>{const d=new Date(r.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-d.getUTCDay());const k=d.toISOString().slice(0,10);if(!weekly.has(k))weekly.set(k,[]);weekly.get(k).push(r);});
  const median=arr=>{const s=[...arr].sort((a,b)=>a-b);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
  const points=[...weekly].sort((a,b)=>a[0].localeCompare(b[0])).map(([week,rs])=>{
    const amHours=rs.map(r=>r.am.hour), pmHours=rs.map(r=>r.pm.hour);
    const amMargin=average(rs.map(r=>r.am.margin).filter(m=>m!==null));
    const pmMargin=average(rs.map(r=>r.pm.margin).filter(m=>m!==null));
    return {week,n:rs.length,amMedian:median(amHours),amMin:Math.min(...amHours),amMax:Math.max(...amHours),pmMedian:median(pmHours),pmMin:Math.min(...pmHours),pmMax:Math.max(...pmHours),amMargin,pmMargin};
  });
  const weeks=points.map(p=>p.week);
  const FLAT_THRESHOLD=3; // $/MWh margin below which a "peak" is a weak plateau, not a sharp spike
  const amColors=points.map(p=>p.amMargin!==null&&p.amMargin<FLAT_THRESHOLD?'#7a95ac':'#1479bd');
  const pmColors=points.map(p=>p.pmMargin!==null&&p.pmMargin<FLAT_THRESHOLD?'#d9b183':'#e08724');
  const traces=[
    {type:'scatter', mode:'lines', x:weeks, y:points.map(p=>p.amMin), line:{width:0}, showlegend:false, hoverinfo:'skip'},
    {type:'scatter', mode:'lines', x:weeks, y:points.map(p=>p.amMax), line:{width:0}, fill:'tonexty', fillcolor:'rgba(20,121,189,0.15)', showlegend:false, hoverinfo:'skip'},
    {type:'scatter', mode:'lines+markers', name:'AM median (HE01–12)', x:weeks, y:points.map(p=>p.amMedian), line:{color:'#1479bd',width:3}, marker:{color:amColors,size:8}, customdata:points.map(p=>p.week),
      hovertemplate:'Week of %{x}<br>AM median peak HE%{y}<br>Avg margin over 2nd-best hour: $%{customdata2:.2f}<extra></extra>',
      customdata2:points.map(p=>p.amMargin)},
    {type:'scatter', mode:'lines', x:weeks, y:points.map(p=>p.pmMin), line:{width:0}, showlegend:false, hoverinfo:'skip'},
    {type:'scatter', mode:'lines', x:weeks, y:points.map(p=>p.pmMax), line:{width:0}, fill:'tonexty', fillcolor:'rgba(224,135,36,0.15)', showlegend:false, hoverinfo:'skip'},
    {type:'scatter', mode:'lines+markers', name:'PM median (HE13–24)', x:weeks, y:points.map(p=>p.pmMedian), line:{color:'#e08724',width:3}, marker:{color:pmColors,size:8}, customdata:points.map(p=>p.week),
      hovertemplate:'Week of %{x}<br>PM median peak HE%{y}<br>Avg margin over 2nd-best hour: $%{customdata2:.2f}<extra></extra>',
      customdata2:points.map(p=>p.pmMargin)}
  ];
  const layout={height:380, yaxis:{title:'Peak hour (HE)'}, xaxis:{title:'Week beginning'}};
  return <div className="chart-panel"><strong>Peak-hour migration — weekly median peak hour, with observed range</strong><PlotlyChart traces={traces} layout={layout} height={380} onPointClick={(week)=>onWeek(week)}/><p className="insight-note">The line is the median hour-of-day that prices peaked across days in that week; the shaded band shows the full min–max range observed that week. <b>Faded/grey markers</b> mark weeks where the "peak" hour barely beat the next-highest hour (average margin under ${FLAT_THRESHOLD}/MWh) — a flat plateau rather than a sharp spike, so the exact peak hour is close to arbitrary that week. Each day's peak is the first hour with the maximum price in its window; this is descriptive history, not a forecast. {points.length} weeks shown. Click a point for that week's underlying days.</p></div>;
}

function PriceLineChart({series,title,monthMode,minN,showCounts}){
  const all=series.flatMap(s=>s.points.map(p=>p.value)).filter(validPrice);
  if(!all.length)return <p className="insight-note">Not enough complete price history for this chart.</p>;
  const traces=series.map(s=>{
    const lowMask=s.points.map(p=>minN?((p.n||0)<minN):false);
    return {
      type:'scatter', mode:'lines+markers', name:s.name,
      x: monthMode ? s.points.map(p=>MONTH_ABBR[p.x]) : s.points.map(p=>p.x),
      y: s.points.map(p=>p.value),
      line:{color:s.color, width:2.5},
      marker:{color:s.color, size:s.points.map((p,i)=>lowMask[i]?5:6), opacity:s.points.map((p,i)=>lowMask[i]?0.55:1)},
      customdata: s.points.map(p=>({n:p.n, x:p.x})),
      hovertemplate: '%{x}<br>$%{y:.2f}'+(s.points.some(p=>p.n!==undefined)?'<br>%{customdata.n} day(s)':'')+'<extra>'+s.name+'</extra>'
    };
  });
  const layout={height:300, yaxis:{title:'$/MWh'}, xaxis: monthMode?{title:'Month', categoryorder:'array', categoryarray:MONTH_ABBR}:{title:'Period'}};
  if(showCounts){
    const countTrace={type:'bar', name:'Sample days', x: monthMode?series[0].points.map(p=>MONTH_ABBR[p.x]):series[0].points.map(p=>p.x), y: series[0].points.map(p=>p.n||0), marker:{color:'#4a5a6b'}, opacity:0.5, yaxis:'y2', hovertemplate:'%{x}<br>%{y} day(s)<extra>Sample size</extra>'};
    traces.push(countTrace);
    layout.yaxis2={overlaying:'y', side:'right', title:'Sample days', showgrid:false};
  }
  return <div className="chart-panel"><strong>{title}</strong>{minN?<div className="chart-legend"><span style={{color:'#8a97a6'}}>Smaller/faded points: fewer than {minN} days</span></div>:null}<PlotlyChart traces={traces} layout={layout} height={300}/></div>;
}

function RollingAmPmChart({points}) {
  if (!points.length) return <p className="insight-note">Not enough data for a rolling trend.</p>;
  const traces = [
    {type:'scatter', mode:'lines', name:'AM peak', x:points.map(p=>p.date), y:points.map(p=>p.am), line:{color:'#1479bd', width:2.5}, hovertemplate:'%{x}<br>AM $%{y:.2f}<extra></extra>'},
    {type:'scatter', mode:'lines', name:'PM peak', x:points.map(p=>p.date), y:points.map(p=>p.pm), line:{color:'#e08724', width:2.5}, hovertemplate:'%{x}<br>PM $%{y:.2f}<extra></extra>'}
  ];
  const layout = {height:340, margin:{l:56,r:16,t:30,b:90}, xaxis:{title:'Date', tickangle:-45}, yaxis:{title:'$/MWh'}, legend:{orientation:'h', y:1.12}};
  return <div className="chart-panel">
    <strong>Rolling AM / PM peak trend</strong>
    <PlotlyChart traces={traces} layout={layout} height={340}/>
    <p className="insight-note">Each point is the rolling-window average of that day's AM (HE01-12) and PM (HE13-24) peak price. Window size is set above.</p>
  </div>;
}

function LineChart(props) {
  const series = props.series;
  const traces = series.map((s,i) => {
    const pts = s.points.filter(p => p.y !== null && p.y !== undefined && !isNaN(p.y));
    return {
      type:'scatter', mode:'lines', name: s.label || ('Series '+(i+1)),
      x: pts.map(p=>'HE'+String(p.x+1).padStart(2,'0')), y: pts.map(p=>p.y),
      line:{color:s.color, width: s.width||2},
      hovertemplate:'%{x}<br>$%{y:.2f}<extra>'+(s.label||'')+'</extra>'
    };
  });
  const layout = {height:300, yaxis:{title:'$/MWh'}, xaxis:{title:'Hour ending'}, showlegend: series.some(s=>s.label)};
  return <PlotlyChart traces={traces} layout={layout} height={300}/>;
}

function PriceHistogramChart({records}) {
  const prices=allHourlyPrices(records);
  if(!prices.length)return <div className="empty">No data.</div>;
  const traces=[{type:'histogram', x:prices, marker:{color:'#5b8dee'}, hovertemplate:'$%{x}<br>%{y} hour(s)<extra></extra>'}];
  const layout={height:340, xaxis:{title:'Price ($/MWh)'}, yaxis:{title:'Frequency (hours)'}};
  return <div className="chart-panel"><strong>Price distribution — all hours</strong><PlotlyChart traces={traces} layout={layout} height={340}/><p className="insight-note">Distribution of every valid hourly price in the selected period ({prices.length.toLocaleString()} observations). A long right tail means occasional high-price spikes against a lower typical baseline.</p></div>;
}

function MonthlyBoxChart({records}) {
  const data=monthlyBoxStats(records);
  if(!data.length)return <div className="empty">No data.</div>;
  const traces=[{type:'box', x:data.flatMap(d=>d.vals.map(()=>d.month)), y:data.flatMap(d=>d.vals), marker:{color:'#5b8dee'}, line:{color:'#3b5a8a'}, boxpoints:false}];
  const layout={height:360, xaxis:{title:'Month', tickangle:-45, type:'category'}, yaxis:{title:'Price ($/MWh)'}};
  return <div className="chart-panel"><strong>Monthly price distribution</strong><PlotlyChart traces={traces} layout={layout} height={360}/><p className="insight-note">Each box summarizes all hourly prices in that calendar month (25th–75th percentile, median, whiskers to min/max). Outlier points are hidden to keep the typical range readable — use the price-duration/CVaR view in Regime & Risk for extreme-value detail.</p></div>;
}

function HourOfDayChart({records}) {
  const data=hourOfDayAverage(records).filter(d=>d.n>0);
  if(!data.length)return <div className="empty">No data.</div>;
  const traces=[{type:'scatter', mode:'lines+markers', x:data.map(d=>d.hour), y:data.map(d=>d.avg), line:{color:'#5b8dee',width:2.5}, marker:{size:7}, hovertemplate:'HE%{x}<br>$%{y:.2f} average<extra></extra>'}];
  const layout={height:340, xaxis:{title:'Hour ending', dtick:1}, yaxis:{title:'Average price ($/MWh)'}};
  return <div className="chart-panel"><strong>Average price by hour of day</strong><PlotlyChart traces={traces} layout={layout} height={340}/><p className="insight-note">Average of each hour ending (HE1–HE24) across every day in the selected period. Shows the typical daily shape — midday dip, evening peak, etc. — independent of any single day's noise.</p></div>;
}

function MonthHourHeatmapChart({records}) {
  const {months,matrix}=monthHourHeatmap(records);
  if(!months.length)return <div className="empty">No data.</div>;
  const traces=[{type:'heatmap', x:HE_COLS.slice(0,24).map((_,i)=>i+1), y:months, z:matrix, colorscale:'Viridis', hovertemplate:'%{y}, HE%{x}<br>$%{z:.2f}<extra></extra>', colorbar:{title:'$/MWh'}}];
  const layout={height:Math.max(340, months.length*16+80), xaxis:{title:'Hour ending', dtick:1}, yaxis:{title:'Month', automargin:true}};
  return <div className="chart-panel"><strong>Mean price by month and hour</strong><PlotlyChart traces={traces} layout={layout} height={layout.height}/><p className="insight-note">Each cell is the average price for that calendar month and hour-of-day across all included years. Useful for spotting seasonal shifts in when the daily peak occurs.</p></div>;
}

function VolatilityChart({records}) {
  const data=dailyVolatility(records);
  if(!data.length)return <div className="empty">No data.</div>;
  const traces=[
    {type:'scatter', mode:'lines', name:'Daily std dev', x:data.map(d=>d.date), y:data.map(d=>d.std), line:{color:'#f0c674',width:1}, hovertemplate:'%{x}<br>$%{y:.2f}<extra>Daily</extra>'},
    {type:'scatter', mode:'lines', name:'7-day rolling mean', x:data.map(d=>d.date), y:data.map(d=>d.rollingStd), line:{color:'#e05d44',width:2.5}, hovertemplate:'%{x}<br>$%{y:.2f}<extra>7-day mean</extra>'}
  ];
  const layout={height:340, xaxis:{title:'Date'}, yaxis:{title:'Std dev of hourly price ($/MWh)'}, legend:{orientation:'h',y:1.12}};
  return <div className="chart-panel"><strong>Daily volatility (standard deviation of hourly prices)</strong><PlotlyChart traces={traces} layout={layout} height={340}/><p className="insight-note">Standard deviation of that day's 24 hourly prices — higher means a more extreme spread between cheap and expensive hours that day, not necessarily a higher average price.</p></div>;
}

function DailyAverageWithMeanChart({records}) {
  const data=dailyAverageSeries(records);
  if(!data.length)return <div className="empty">No data.</div>;
  const traces=[
    {type:'scatter', mode:'lines', name:'Daily average price', x:data.map(d=>d.date), y:data.map(d=>d.avg), line:{color:'#8899ee',width:1}, hovertemplate:'%{x}<br>$%{y:.2f}<extra>Daily</extra>'},
    {type:'scatter', mode:'lines', name:'7-day rolling mean', x:data.map(d=>d.date), y:data.map(d=>d.rollingAvg), line:{color:'#d6318e',width:2.5}, hovertemplate:'%{x}<br>$%{y:.2f}<extra>7-day mean</extra>'}
  ];
  const layout={height:340, xaxis:{title:'Date'}, yaxis:{title:'Price ($/MWh)'}, legend:{orientation:'h',y:1.12}};
  return <div className="chart-panel"><strong>Daily average price with 7-day mean</strong><PlotlyChart traces={traces} layout={layout} height={340}/><p className="insight-note">Daily average price (thin line) with a 7-day rolling mean overlay (thick line) to smooth day-to-day noise and show the underlying trend.</p></div>;
}

function SummaryStatsPanel({records}) {
  const s=useMemo(()=>datasetSummary(records),[records]);
  if(!s.totalDays)return <div className="empty">No data.</div>;
  return <div className="card">
    <h3>Dataset summary</h3>
    <div className="stat-grid">
      <div className="stat"><div className="label">Days in selection</div><div className="val">{s.totalDays.toLocaleString()}</div></div>
      <div className="stat"><div className="label">Hourly observations</div><div className="val">{s.totalHours.toLocaleString()}</div></div>
      <div className="stat"><div className="label">Overall average</div><div className="val">{formatPrice(s.overallAvg)}</div></div>
      <div className="stat"><div className="label">Overall std dev</div><div className="val">{formatPrice(s.overallStd)}</div></div>
    </div>
    <div className="opportunity-columns">
      <div><h3>By month (highest to lowest avg)</h3>{s.monthRank.map((m,i)=><div className="audit-line" key={m.label}><b>{i+1}. {m.label}</b><span>{formatPrice(m.avg)} · {m.n} days</span></div>)}</div>
      <div><h3>By year (highest to lowest avg)</h3>{s.yearRank.map((y,i)=><div className="audit-line" key={y.label}><b>{i+1}. {y.label}</b><span>{formatPrice(y.avg)} · {y.n} days</span></div>)}</div>
      <div><h3>By day of week (highest to lowest avg)</h3>{s.dowRank.map((d,i)=><div className="audit-line" key={d.label}><b>{i+1}. {d.label}</b><span>{formatPrice(d.avg)} · {d.n} days</span></div>)}</div>
    </div>
    <p className="insight-note">Rankings are based on each day's average price (mean of HE01–HE24), averaged within each group. Groups with few days (e.g. a partial year) may be less representative.</p>
  </div>;
}

function LatestDayCurve({shape}) {
  if (!shape || !shape.valid.length) return <div className="empty">No hourly prices available for the latest stored day.</div>;
  const peakSet = new Set((shape.peakWindows||[]).flatMap(pw=>pw.hours));

  // Rank every valid hour by price, highest = rank 1. Hours with no price get no rank.
  const ranked = [...shape.valid].sort((a,b)=>b.price-a.price);
  const rankByHe = {};
  ranked.forEach((x,i) => { rankByHe[x.he] = i+1; });

  const colors = shape.hours.map(x => {
    if (!validPrice(x.price)) return '#c9d4de';
    if (x.price < 0) return '#e05d44';
    if (peakSet.has(x.he)) return '#0d7a65';
    return '#7fd4c5';
  });

  const traces = [{
    type:'bar',
    x: shape.hours.map(x=>x.he),
    y: shape.hours.map(x=>validPrice(x.price)?x.price:null),
    marker:{color:colors},
    text: shape.hours.map(x => rankByHe[x.he] ? ('#'+rankByHe[x.he]) : ''),
    textposition:'outside',
    textfont:{size:11, color:'#5c7183'},
    cliponaxis:false,
    hovertemplate: shape.hours.map(x => validPrice(x.price)
      ? ('HE%{x}<br>$%{y:.2f}/MWh<br>Rank #'+rankByHe[x.he]+' of '+shape.valid.length+' hours<extra></extra>')
      : 'HE%{x}<br>No price<extra></extra>'
    )
  }];
  const layout = {
    height:360, margin:{l:56,r:16,t:30,b:44},
    xaxis:{title:'Hour ending', dtick:1},
    yaxis:{title:'$/MWh'}
  };
  return <>
    <PlotlyChart traces={traces} layout={layout} height={360}/>
    <p className="insight-note">Numbers above each bar show that hour's price rank for the day — #1 is the single highest-priced hour, counting down from there.</p>
  </>;
}


// ===== analysis-negative.jsx =====
// analysis-negative.jsx
// Negative price tracker: analysis functions + full panel UI.
// Depends on parsing.jsx, analysis-core.jsx, and charts.jsx (PlotlyChart).
// Load AFTER those files (specifically after charts.jsx, since NegativePriceChart/
// NegativePriceTrendChart use PlotlyChart).

function negativePriceAnalysis(records) {
  const rows = [];
  records.forEach(r => {
    HE_COLS.slice(0,24).forEach((h, i) => {
      const v = r.hours[h];
      if (validPrice(v) && v < 0) {
        rows.push({ date: r.key, hour: i+1, he: h, price: v });
      }
    });
  });
  rows.sort((a,b) => a.price - b.price); // most negative first

  const totalHoursChecked = records.reduce((sum, r) => sum + HE_COLS.slice(0,24).filter(h => validPrice(r.hours[h])).length, 0);
  const daysWithNegative = new Set(rows.map(r => r.date)).size;

  // Monthly trend — count AND magnitude (most negative price that month)
  const byMonth = new Map();
  rows.forEach(r => {
    const key = r.date.slice(0,7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(r);
  });
  const monthly = [...byMonth.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([month, rs]) => ({
    month, count: rs.length, avgPrice: average(rs.map(r=>r.price)), worstPrice: Math.min(...rs.map(r=>r.price))
  }));

  return {
    rows,
    totalEvents: rows.length,
    totalHoursChecked,
    pctNegative: totalHoursChecked ? (rows.length/totalHoursChecked*100) : 0,
    daysWithNegative,
    worstEvent: rows[0] || null,
    avgNegativePrice: average(rows.map(r=>r.price)),
    monthly
  };
}

// Hour-of-day clustering for a specific, already-period-filtered set of records
function negativeByHour(records) {
  const rows = [];
  records.forEach(r => {
    HE_COLS.slice(0,24).forEach((h, i) => {
      const v = r.hours[h];
      if (validPrice(v) && v < 0) rows.push({hour:i+1, price:v});
    });
  });
  return Array.from({length:24}, (_,i) => ({
    hour: i+1,
    count: rows.filter(r => r.hour === i+1).length
  }));
}

function NegativePriceChart({byHour, periodLabel}) {
  const hasData = byHour.some(h => h.count > 0);
  if (!hasData) return <p className="insight-note">No negative-price hours in this selection ({periodLabel}).</p>;
  const traces = [{
    type:'bar', x: byHour.map(h=>h.hour), y: byHour.map(h=>h.count),
    marker:{color:'#e05d44'},
    hovertemplate:'HE%{x}<br>%{y} negative-price event(s)<extra></extra>'
  }];
  const layout = {height:300, xaxis:{title:'Hour ending', dtick:1}, yaxis:{title:'Count of negative-price hours'}};
  return <div className="chart-panel">
    <strong>Negative-price events by hour of day — {periodLabel}</strong>
    <PlotlyChart traces={traces} layout={layout} height={300}/>
    <p className="insight-note">Clustering around midday hours (roughly HE10–HE15) typically reflects solar oversupply ("duck curve") — hours when generating is least valuable, and curtailable output should be held back if operationally possible.</p>
  </div>;
}

function NegativePriceTrendChart({monthly}) {
  if (!monthly.length) return <p className="insight-note">No negative-price events recorded.</p>;
  const traces = [
    {type:'bar', name:'Event count', x: monthly.map(m=>m.month), y: monthly.map(m=>m.count),
     marker:{color:'#e05d44'},
     hovertemplate:'%{x}<br>%{y} event(s)<extra>Count</extra>'},
    {type:'scatter', mode:'lines+markers', name:'Worst price that month', x: monthly.map(m=>m.month), y: monthly.map(m=>m.worstPrice),
     yaxis:'y2', line:{color:'#ffb347', width:3}, marker:{size:8, color:'#ffb347'},
     hovertemplate:'%{x}<br>Worst: $%{y:.2f}<extra>Magnitude</extra>'}
  ];
  const layout = {
    height:340, margin:{l:60,r:90,t:10,b:70},
    xaxis:{title:'Month', tickangle:-45},
    yaxis:{title:'Negative-price hours (count)'},
    yaxis2:{title:{text:'Most negative price ($/MWh)', standoff:20}, overlaying:'y', side:'right', showgrid:false, automargin:true},
    legend:{orientation:'h', y:1.15}
  };
  return <div className="chart-panel">
    <strong>Negative-price events over time — frequency and magnitude</strong>
    <PlotlyChart traces={traces} layout={layout} height={340}/>
    <p className="insight-note">Bars show how often negative prices occurred each month; the line shows how severe the worst single hour was that month. Rising bars with a flat line means more frequent but similarly-mild events; a line dropping further below zero means individual events are getting more extreme, independent of frequency. Rising frequency over time commonly tracks growing solar penetration on the grid, not a MEAD-specific trend. This is historical count, not a forecast.</p>
  </div>;
}

function NegativePricePanel({records}) {
  const neg = useMemo(() => negativePriceAnalysis(records), [records]);
  const years = useMemo(() => [...new Set(records.map(r => r.key.slice(0,4)))].sort((a,b)=>b-a), [records]);

  // Separate period filter just for the hour-of-day chart: 'all' | specific year | 'month:N' (all years)
  const [hourChartPeriod, setHourChartPeriod] = useState('all');
  const hourChartRecords = useMemo(() => {
    if (hourChartPeriod === 'all') return records;
    if (hourChartPeriod.startsWith('month:')) {
      const m = Number(hourChartPeriod.split(':')[1]);
      return records.filter(r => Number(r.key.slice(5,7)) === m);
    }
    return records.filter(r => r.key.slice(0,4) === hourChartPeriod);
  }, [records, hourChartPeriod]);
  const hourChartData = useMemo(() => negativeByHour(hourChartRecords), [hourChartRecords]);
  const hourChartLabel = hourChartPeriod === 'all' ? 'all years'
    : hourChartPeriod.startsWith('month:') ? MONTH_ABBR[Number(hourChartPeriod.split(':')[1])-1] + ' (all years)'
    : hourChartPeriod;

  // Year filter for the events table
  const [tableYear, setTableYear] = useState('all');
  const filteredRows = useMemo(() => {
    if (tableYear === 'all') return neg.rows;
    return neg.rows.filter(r => r.date.slice(0,4) === tableYear);
  }, [neg.rows, tableYear]);

  if (!records.length) return <div className="empty">No data.</div>;
  return <div className="card">
    <div className="section-heading">
      <div>
        <h2>Negative price tracker</h2>
        <p>Hours where CAISO's day-ahead price went below $0/MWh — periods when generating has a direct cost rather than revenue, typically from regional oversupply (often solar).</p>
      </div>
    </div>
    <div className="stat-grid">
      <div className="stat"><div className="label">Negative-price events</div><div className="val">{neg.totalEvents.toLocaleString()}</div><small>{neg.pctNegative.toFixed(2)}% of {neg.totalHoursChecked.toLocaleString()} checked hours</small></div>
      <div className="stat"><div className="label">Days affected</div><div className="val">{neg.daysWithNegative.toLocaleString()}</div><small>of {records.length.toLocaleString()} stored days</small></div>
      <div className="stat"><div className="label">Average negative price</div><div className="val">{neg.avgNegativePrice!==null?formatPrice(neg.avgNegativePrice):'—'}</div><small>Mean of all negative hours</small></div>
      <div className="stat"><div className="label">Worst single event</div><div className="val">{neg.worstEvent?formatPrice(neg.worstEvent.price):'—'}</div><small>{neg.worstEvent?neg.worstEvent.date+' · '+neg.worstEvent.he:'None recorded'}</small></div>
    </div>

    {neg.totalEvents === 0 ? (
      <p className="insight-note">No negative-price hours found in the stored data. This is common for nodes/periods without significant local oversupply conditions.</p>
    ) : (
      <>
        <div className="row">
          <label>Hour-of-day chart period
            <select value={hourChartPeriod} onChange={e=>setHourChartPeriod(e.target.value)}>
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
              <optgroup label="Specific month, all years">
                {MONTH_ABBR.map((m,i) => <option key={i} value={'month:'+(i+1)}>{m}</option>)}
              </optgroup>
            </select>
          </label>
        </div>
        <NegativePriceChart byHour={hourChartData} periodLabel={hourChartLabel}/>

        <NegativePriceTrendChart monthly={neg.monthly}/>

        <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
          <h3 style={{margin:0}}>All negative-price events (most severe first)</h3>
          <label>Year
            <select value={tableYear} onChange={e=>setTableYear(e.target.value)}>
              <option value="all">All years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>
        <div className="scroll" style={{maxHeight:300, marginTop:10}}>
          <table>
            <thead><tr><th>Date</th><th>Hour</th><th>Price</th></tr></thead>
            <tbody>
              {filteredRows.slice(0,200).map((r) => (
                <tr key={r.date+r.he}>
                  <td>{r.date}</td>
                  <td>{r.he}</td>
                  <td className="spike" style={{color:'#e05d44'}}>{formatPrice(r.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredRows.length > 200 && <p className="insight-note">Showing the 200 most severe events of {filteredRows.length} total in this selection. Export full history from the History tab for complete data.</p>}
        {filteredRows.length === 0 && <p className="insight-note">No negative-price events in {tableYear}.</p>}
      </>
    )}
    <p className="insight-note">A curtailable hydro resource can avoid negative-price hours entirely if water/scheduling constraints allow deferring generation to a different hour — worth cross-referencing against the price-duration and regime views for alternative timing.</p>
  </div>;
}


// ===== ask.jsx =====
// ask.jsx — "Ask" tab: one-click smart questions with mini-charts, stacked answers.
// Load AFTER parsing.jsx, analysis-core.jsx, analysis-regimes.jsx, analysis-negative.jsx
// (questions call functions from all three).
//
// REVAMP HISTORY:
// - Removed q2 (lowest month), q5 (lowest DOW), q7 (lowest hour), q9 (all-time low) as
//   separate questions — folded into the sentence of the paired question that remains.
// - Added "Manager Insights" category: q32-q35.
// - Per-category AM/PM grid: q1 (month), q3 (year), q4 (day of week), q16 (YoY), q17
//   (month YoY), q19 (quarter), q21 (season) now show a small AM/PM bar-pair for EVERY
//   category value, not just the winning one — replaces the earlier single-breakdown
//   AmPmSplitNote for these questions.
// - q8 (all-time high/low) now also shows a by-year high/low table.

// ---- Shared mini-chart renderers ----

function MiniRankBar({items, maxItems, color}) {
  const shown = maxItems ? items.slice(0, maxItems) : items;
  const maxV = Math.max(...shown.map(i => Math.abs(i.value || 0)), 1);
  return <div style={{marginTop:10}}>
    {shown.map((item, i) => (
      <div key={i} style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
        <span style={{width:70, fontSize:11, color:'#5c7183', flexShrink:0}}>{item.label}</span>
        <div style={{flex:1, background:'#e2ece8', borderRadius:5, height:16, overflow:'hidden'}}>
          <div style={{width:(Math.abs(item.value)/maxV*100)+'%', height:'100%', background:color||'#35c4ae', borderRadius:5}}></div>
        </div>
        <span style={{width:70, fontSize:12, fontWeight:600, color:'#16332c', textAlign:'right', flexShrink:0}}>{formatPrice(item.value)}</span>
      </div>
    ))}
  </div>;
}

function MiniLineTrend({points, color}) {
  const valid = points.filter(p => p.y !== null && p.y !== undefined && !isNaN(p.y));
  if (valid.length < 2) return null;
  const width = 400, height = 70, pad = 6;
  const ys = valid.map(p=>p.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const x = i => pad + (width-2*pad) * i/(valid.length-1);
  const y = v => height-pad - (hi>lo ? (v-lo)/(hi-lo) : 0.5) * (height-2*pad);
  const path = valid.map((p,i) => (i===0?'M':'L') + x(i) + ',' + y(p.y)).join(' ');
  return <svg viewBox={'0 0 '+width+' '+height} style={{width:'100%', height:70, marginTop:10}}>
    <path d={path} fill="none" stroke={color||'#35c4ae'} strokeWidth="2.5"/>
  </svg>;
}

// Two-series version of MiniLineTrend — used wherever a question wants AM and PM
// shown as overlaid sparklines instead of just one, with a small color-coded legend.
function MiniTwoLineTrend({seriesA, seriesB, labelA, labelB, colorA, colorB}) {
  const validA = seriesA.filter(p => p.y !== null && p.y !== undefined && !isNaN(p.y));
  const validB = seriesB.filter(p => p.y !== null && p.y !== undefined && !isNaN(p.y));
  if (validA.length < 2 && validB.length < 2) return null;
  const width = 400, height = 80, pad = 6;
  const allYs = [...validA, ...validB].map(p=>p.y);
  const lo = Math.min(...allYs), hi = Math.max(...allYs);
  const maxLen = Math.max(validA.length, validB.length, 1);
  const x = i => pad + (width-2*pad) * i/(maxLen-1||1);
  const y = v => height-pad - (hi>lo ? (v-lo)/(hi-lo) : 0.5) * (height-2*pad);
  const pathFor = valid => valid.map((p,i) => (i===0?'M':'L') + x(i) + ',' + y(p.y)).join(' ');
  return <div style={{marginTop:10}}>
    <svg viewBox={'0 0 '+width+' '+height} style={{width:'100%', height:80}}>
      {validA.length>=2 && <path d={pathFor(validA)} fill="none" stroke={colorA||'#35c4ae'} strokeWidth="2.5"/>}
      {validB.length>=2 && <path d={pathFor(validB)} fill="none" stroke={colorB||'#3877aa'} strokeWidth="2.5"/>}
    </svg>
    <div style={{display:'flex', gap:16, marginTop:6}}>
      <span style={{display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#5c7183'}}><span style={{width:10,height:10,borderRadius:2,background:colorA||'#35c4ae',display:'inline-block'}}/>{labelA}</span>
      <span style={{display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#5c7183'}}><span style={{width:10,height:10,borderRadius:2,background:colorB||'#3877aa',display:'inline-block'}}/>{labelB}</span>
    </div>
  </div>;
}

function MiniStat({value, sub, color}) {
  return <div style={{marginTop:10, display:'flex', alignItems:'baseline', gap:10}}>
    <span style={{fontSize:28, fontWeight:700, color: color||'#0d7a65'}}>{value}</span>
    {sub && <span style={{fontSize:12, color:'#5c7183'}}>{sub}</span>}
  </div>;
}

function MiniCompareBars({a, b}) {
  const maxV = Math.max(Math.abs(a.value||0), Math.abs(b.value||0), 1);
  return <div style={{marginTop:10}}>
    {[a,b].map((item,i) => (
      <div key={i} style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
        <span style={{width:90, fontSize:12, color:'#5c7183', flexShrink:0}}>{item.label}</span>
        <div style={{flex:1, background:'#e2ece8', borderRadius:5, height:18, overflow:'hidden'}}>
          <div style={{width:(Math.abs(item.value)/maxV*100)+'%', height:'100%', background: i===0?'#35c4ae':'#3877aa', borderRadius:5}}></div>
        </div>
        <span style={{width:80, fontSize:13, fontWeight:600, textAlign:'right', flexShrink:0}}>{item.display}</span>
      </div>
    ))}
  </div>;
}

// Single small AM/PM bar-pair, sized to sit in a grid cell (used by AmPmGrid below).
function MiniAmPmCell({label, am, pm}) {
  const maxV = Math.max(Math.abs(am||0), Math.abs(pm||0), 1);
  return <div style={{border:'1px solid #d8e6e1', borderRadius:9, padding:'10px 12px', background:'#fafdfc'}}>
    <div style={{fontSize:11.5, fontWeight:700, color:'#2b3e50', marginBottom:8}}>{label}</div>
    {[['AM', am, '#35c4ae'], ['PM', pm, '#3877aa']].map(([lbl, val, color]) => (
      <div key={lbl} style={{display:'flex', alignItems:'center', gap:8, marginBottom:5}}>
        <span style={{width:22, fontSize:10.5, color:'#7a95ac', flexShrink:0}}>{lbl}</span>
        <div style={{flex:1, background:'#e6efec', borderRadius:4, height:12, overflow:'hidden'}}>
          <div style={{width:(val===null?0:Math.abs(val)/maxV*100)+'%', height:'100%', background:color, borderRadius:4}}/>
        </div>
        <span style={{width:52, fontSize:11, fontWeight:600, color:'#16332c', textAlign:'right', flexShrink:0}}>{val===null?'—':formatPrice(val)}</span>
      </div>
    ))}
  </div>;
}

// Grid of per-category AM/PM pairs — e.g. one cell per month, per year, or per day-of-week.
// items: [{label, am, pm}]
function AmPmGrid({items, title}) {
  const valid = items.filter(it => it.am !== null || it.pm !== null);
  if (!valid.length) return null;
  return <div style={{marginTop:14, paddingTop:12, borderTop:'1px dashed #cfe0da'}}>
    <div style={{fontSize:10.5, color:'#7a95ac', fontWeight:700, textTransform:'uppercase', letterSpacing:0.4, marginBottom:8}}>{title || 'AM vs PM by category'}</div>
    <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:8}}>
      {valid.map(it => <MiniAmPmCell key={it.label} label={it.label} am={it.am} pm={it.pm}/>)}
    </div>
  </div>;
}

// Helper: average of AM-window (HE01-12) and PM-window (HE13-24) hourly prices for a given record set.
function amPmAverages(records) {
  const am = average(records.flatMap(r => HE_COLS.slice(0,12).map(h=>r.hours[h])).filter(validPrice));
  const pm = average(records.flatMap(r => HE_COLS.slice(12,24).map(h=>r.hours[h])).filter(validPrice));
  return {am, pm};
}

const DOW_LABELS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ---- Question definitions ----

function buildAskQuestions() {
  return [
    // ===== Price Level & Ranking =====
    {
      id:'q1',
      category:'Price Level & Ranking',
      text:'Which month tends to have the highest (and lowest) prices?',
      compute(records) {
        const s = datasetSummary(records);
        if (!s.monthRank.length) return {sentence:'Not enough data to rank months.'};
        const top = s.monthRank[0], bottom = s.monthRank[s.monthRank.length-1];
        const perMonth = MONTH_ABBR.map(label => {
          const rs = records.filter(r => MONTH_ABBR[Number(r.key.slice(5,7))-1] === label);
          const {am, pm} = amPmAverages(rs);
          return {label, am, pm};
        });
        return {
          sentence: <><b>{top.label}</b> has the highest average price historically, at <b>{formatPrice(top.avg)}</b> (based on {top.n} stored days). <b>{bottom.label}</b> is lowest, at <b>{formatPrice(bottom.avg)}</b>.</>,
          render: () => <>
            <MiniRankBar items={s.monthRank.map(m=>({label:m.label, value:m.avg}))} maxItems={12}/>
            <AmPmGrid items={perMonth} title="AM vs PM by month"/>
          </>
        };
      }
    },
    {
      id:'q3',
      category:'Price Level & Ranking',
      text:'Which year had the highest average price?',
      compute(records) {
        const s = datasetSummary(records);
        if (!s.yearRank.length) return {sentence:'Not enough data across multiple years.'};
        const top = s.yearRank[0];
        const perYear = s.yearRank.map(y => {
          const rs = records.filter(r => r.key.slice(0,4) === y.label);
          const {am, pm} = amPmAverages(rs);
          return {label:y.label, am, pm};
        });
        return {
          sentence: <><b>{top.label}</b> had the highest average price at <b>{formatPrice(top.avg)}</b>, across {top.n} stored days.</>,
          render: () => <>
            <MiniRankBar items={s.yearRank.map(y=>({label:y.label, value:y.avg}))} maxItems={8}/>
            <AmPmGrid items={perYear} title="AM vs PM by year"/>
          </>
        };
      }
    },
    {
      id:'q4',
      category:'Price Level & Ranking',
      text:'Which day of week is typically most (and least) expensive?',
      compute(records) {
        const s = datasetSummary(records);
        if (!s.dowRank.length) return {sentence:'Not enough data.'};
        const top = s.dowRank[0], bottom = s.dowRank[s.dowRank.length-1];
        const perDow = DOW_LABELS.map(label => {
          const rs = records.filter(r => DOW_LABELS[new Date(r.key+'T12:00:00Z').getUTCDay()] === label);
          const {am, pm} = amPmAverages(rs);
          return {label, am, pm};
        });
        return {
          sentence: <><b>{top.label}</b> is typically the most expensive day of the week, averaging <b>{formatPrice(top.avg)}</b> ({top.n} days). <b>{bottom.label}</b> is cheapest, at <b>{formatPrice(bottom.avg)}</b>.</>,
          render: () => <>
            <MiniRankBar items={s.dowRank.map(d=>({label:d.label, value:d.avg}))} maxItems={7}/>
            <AmPmGrid items={perDow} title="AM vs PM by day of week"/>
          </>
        };
      }
    },
    {
      id:'q6',
      category:'Price Level & Ranking',
      text:'What hour has the highest (and lowest) average price?',
      compute(records) {
        const data = hourOfDayAverage(records).filter(d=>d.n>0);
        if (!data.length) return {sentence:'Not enough data.'};
        const top = [...data].sort((a,b)=>b.avg-a.avg)[0];
        const bottom = [...data].sort((a,b)=>a.avg-b.avg)[0];
        return {
          sentence: <><b>HE{String(top.hour).padStart(2,'0')}</b> has the highest average price at <b>{formatPrice(top.avg)}</b>, across {top.n} stored days. <b>HE{String(bottom.hour).padStart(2,'0')}</b> is lowest, at <b>{formatPrice(bottom.avg)}</b>.</>,
          render: () => <MiniLineTrend points={data.map(d=>({x:d.hour, y:d.avg}))}/>
        };
      }
    },
    {
      id:'q8',
      category:'Price Level & Ranking',
      text:"What's the all-time highest and lowest price, and when?",
      compute(records) {
        const extrema = records.flatMap(r=>HE_COLS.filter(h=>validPrice(r.hours[h])).map(h=>({date:r.key,hour:h,price:r.hours[h]})));
        if (!extrema.length) return {sentence:'No data.'};
        const max = extrema.reduce((a,b)=>b.price>a.price?b:a);
        const min = extrema.reduce((a,b)=>b.price<a.price?b:a);
        const years = [...new Set(extrema.map(x=>x.date.slice(0,4)))].sort();
        const byYear = years.map(y => {
          const rs = extrema.filter(x=>x.date.slice(0,4)===y);
          const yMax = rs.reduce((a,b)=>b.price>a.price?b:a);
          const yMin = rs.reduce((a,b)=>b.price<a.price?b:a);
          return {year:y, max:yMax, min:yMin};
        });
        return {
          sentence: <>Highest: <b>{formatPrice(max.price)}</b> on <b>{max.date}</b> at <b>{max.hour}</b>. Lowest: <b>{formatPrice(min.price)}</b> on <b>{min.date}</b> at <b>{min.hour}</b>.</>,
          render: () => <>
            <div style={{display:'flex', gap:24}}>
              <MiniStat value={formatPrice(max.price)} sub={max.date+' · '+max.hour} color="#e05d44"/>
              <MiniStat value={formatPrice(min.price)} sub={min.date+' · '+min.hour} color={min.price<0?'#e05d44':'#3877aa'}/>
            </div>
            <div style={{marginTop:14, paddingTop:12, borderTop:'1px dashed #cfe0da'}}>
              <div style={{fontSize:10.5, color:'#7a95ac', fontWeight:700, textTransform:'uppercase', letterSpacing:0.4, marginBottom:8}}>Highest / lowest by year</div>
              <div className="scroll" style={{maxHeight:220}}>
                <table>
                  <thead><tr><th>Year</th><th>Highest</th><th>Lowest</th></tr></thead>
                  <tbody>
                    {byYear.map(y => <tr key={y.year}>
                      <td>{y.year}</td>
                      <td>{formatPrice(y.max.price)} <span style={{color:'#8da0b3', fontSize:11}}>({y.max.date} {y.max.hour})</span></td>
                      <td>{formatPrice(y.min.price)} <span style={{color:'#8da0b3', fontSize:11}}>({y.min.date} {y.min.hour})</span></td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        };
      }
    },

    // ===== Peak Timing (AM vs PM) =====
    {
      id:'q10',
      category:'Peak Timing (AM vs PM)',
      text:'Does morning or evening tend to have higher prices?',
      compute(records) {
        const rows = completePeakRows(records);
        if (!rows.length) return {sentence:'Not enough complete AM/PM days.'};
        const am = average(rows.map(r=>r.am)), pm = average(rows.map(r=>r.pm));
        const winner = pm>=am ? 'Evening' : 'Morning';
        return {
          sentence: <><b>{winner}</b> tends to have higher peak prices — morning averages <b>{formatPrice(am)}</b>, evening averages <b>{formatPrice(pm)}</b>, based on {rows.length} complete days.</>,
          render: () => <MiniCompareBars a={{label:'Morning (AM)', value:am, display:formatPrice(am)}} b={{label:'Evening (PM)', value:pm, display:formatPrice(pm)}}/>
        };
      }
    },
    {
      id:'q11',
      category:'Peak Timing (AM vs PM)',
      text:"What's the typical evening price premium over morning?",
      compute(records) {
        const rows = completePeakRows(records);
        if (!rows.length) return {sentence:'Not enough complete AM/PM days.'};
        const diff = average(rows.map(r=>r.pm-r.am));
        return {
          sentence: <>Evening (PM) prices average <b>{formatPrice(diff)}</b> {diff>=0?'above':'below'} morning (AM) prices, based on {rows.length} complete days.</>,
          render: () => <MiniStat value={formatPrice(diff)} sub={diff>=0?'PM premium':'AM premium'} color={diff>=0?'#0d7a65':'#3877aa'}/>
        };
      }
    },
    {
      id:'q12',
      category:'Peak Timing (AM vs PM)',
      text:'Is the peak-pricing hour shifting earlier or later over time?',
      compute(records) {
        const rows = completePeakRows(records);
        if (rows.length < 60) return {sentence:'Not enough history (need at least 60 complete days) to assess a shift.'};
        const first30 = rows.slice(0,30), last30 = rows.slice(-30);
        const amHourFor = r => { const rec = records.find(x=>x.key===r.date); if(!rec) return null; let best=1,bv=-Infinity; for(let h=1;h<=12;h++){const v=rec.hours['HE'+String(h).padStart(2,'0')]; if(validPrice(v)&&v>bv){bv=v;best=h;}} return best; };
        const firstAvgHour = average(first30.map(amHourFor).filter(v=>v!==null));
        const lastAvgHour = average(last30.map(amHourFor).filter(v=>v!==null));
        if (firstAvgHour===null || lastAvgHour===null) return {sentence:'Not enough data to compute peak-hour shift.'};
        const delta = lastAvgHour - firstAvgHour;
        return {
          sentence: <>The morning peak hour has moved <b>{Math.abs(delta).toFixed(1)} hour(s) {delta>0?'later':delta<0?'earlier':'— no change'}</b> comparing the earliest 30 to the most recent 30 complete days (HE{firstAvgHour.toFixed(1)} → HE{lastAvgHour.toFixed(1)}).</>,
          render: () => <MiniCompareBars a={{label:'Earliest 30 days', value:firstAvgHour, display:'HE'+firstAvgHour.toFixed(1)}} b={{label:'Recent 30 days', value:lastAvgHour, display:'HE'+lastAvgHour.toFixed(1)}}/>
        };
      }
    },
    {
      id:'q13',
      category:'Peak Timing (AM vs PM)',
      text:'How sharp is the typical morning peak vs. a flat plateau?',
      compute(records) {
        const opp = opportunity(records, 365, 10);
        if (opp.avgAmPremium===null) return {sentence:'Not enough data.'};
        const sharp = opp.avgAmPremium >= 10;
        return {
          sentence: <>The morning peak averages <b>{formatPrice(opp.avgAmPremium)}</b> above the median of the other AM hours — {sharp ? <b>a fairly sharp, decisive spike</b> : <b>a relatively flat plateau</b>}, meaning the exact peak hour is {sharp?'usually clear-cut':'often close to arbitrary'}.</>,
          render: () => <MiniStat value={formatPrice(opp.avgAmPremium)} sub="avg AM peak premium" color={sharp?'#0d7a65':'#9c8a4a'}/>
        };
      }
    },
    {
      id:'q14',
      category:'Peak Timing (AM vs PM)',
      text:'How sharp is the typical evening peak?',
      compute(records) {
        const opp = opportunity(records, 365, 10);
        if (opp.avgPmPremium===null) return {sentence:'Not enough data.'};
        const sharp = opp.avgPmPremium >= 10;
        return {
          sentence: <>The evening peak averages <b>{formatPrice(opp.avgPmPremium)}</b> above the median of the other PM hours — {sharp ? <b>a fairly sharp, decisive spike</b> : <b>a relatively flat plateau</b>}.</>,
          render: () => <MiniStat value={formatPrice(opp.avgPmPremium)} sub="avg PM peak premium" color={sharp?'#0d7a65':'#9c8a4a'}/>
        };
      }
    },

    // ===== Trends & Comparisons =====
    {
      id:'q15',
      category:'Trends & Comparisons',
      text:'Are prices trending up or down recently?',
      compute(records) {
        const t = trendInsights(records, 12);
        if (!t.change) return {sentence:'Not enough recent history (need at least 7 comparable days in each of the last two 30-day windows).'};
        const amDir = t.change.am >= 0 ? 'up' : 'down';
        const pmDir = t.change.pm >= 0 ? 'up' : 'down';
        const recent = t.rolling.slice(-60);
        return {
          sentence: <>Morning peaks are trending <b>{amDir}</b> (<b>{formatPrice(t.change.am)}</b> change) and evening peaks are trending <b>{pmDir}</b> (<b>{formatPrice(t.change.pm)}</b> change), comparing the most recent 30 days to the preceding 30 days.</>,
          render: () => <MiniTwoLineTrend
            seriesA={recent.map((r,i)=>({x:i, y:r.am}))}
            seriesB={recent.map((r,i)=>({x:i, y:r.pm}))}
            labelA="AM" labelB="PM"
            colorA="#35c4ae" colorB="#3877aa"
          />
        };
      }
    },
    {
      id:'q16',
      category:'Trends & Comparisons',
      text:'How does this year compare to last year?',
      compute(records) {
        const years = [...new Set(records.map(r=>r.key.slice(0,4)))].sort();
        if (years.length < 2) return {sentence:'Need at least two years of stored data to compare.'};
        const thisYear = years[years.length-1], lastYear = years[years.length-2];
        const avgFor = y => { const rs = records.filter(r=>r.key.slice(0,4)===y); const s = datasetSummary(rs); return s.overallAvg; };
        const a = avgFor(lastYear), b = avgFor(thisYear);
        if (a===null||b===null) return {sentence:'Not enough data in one of the years.'};
        const pairGrid = [lastYear, thisYear].map(y => {
          const {am, pm} = amPmAverages(records.filter(r=>r.key.slice(0,4)===y));
          return {label:y, am, pm};
        });
        return {
          sentence: <><b>{thisYear}</b> is averaging <b>{formatPrice(b)}</b> vs <b>{formatPrice(a)}</b> in <b>{lastYear}</b> — a {b>=a?'increase':'decrease'} of <b>{formatPrice(Math.abs(b-a))}</b>.</>,
          render: () => <>
            <MiniCompareBars a={{label:lastYear, value:a, display:formatPrice(a)}} b={{label:thisYear, value:b, display:formatPrice(b)}}/>
            <AmPmGrid items={pairGrid} title="AM vs PM, each year"/>
          </>
        };
      }
    },
    {
      id:'q17',
      category:'Trends & Comparisons',
      text:'How does this month compare to the same month last year?',
      compute(records) {
        if (!records.length) return {sentence:'No data.'};
        const latest = [...records].sort((a,b)=>b.key.localeCompare(a.key))[0];
        const month = latest.key.slice(5,7), thisYear = latest.key.slice(0,4), lastYear = String(Number(thisYear)-1);
        const recordsFor = (y) => records.filter(r=>r.key.slice(0,4)===y && r.key.slice(5,7)===month);
        const avgFor = (y) => { const rs = recordsFor(y); return rs.length ? datasetSummary(rs).overallAvg : null; };
        const a = avgFor(lastYear), b = avgFor(thisYear);
        if (a===null||b===null) return {sentence:'Not enough data for this month in both years.'};
        const monthName = MONTH_ABBR[Number(month)-1];
        const pairGrid = [[lastYear, monthName+' '+lastYear], [thisYear, monthName+' '+thisYear]].map(([y,label]) => {
          const {am, pm} = amPmAverages(recordsFor(y));
          return {label, am, pm};
        });
        return {
          sentence: <><b>{monthName} {thisYear}</b> averaged <b>{formatPrice(b)}</b> vs <b>{formatPrice(a)}</b> in <b>{monthName} {lastYear}</b>.</>,
          render: () => <>
            <MiniCompareBars a={{label:monthName+' '+lastYear, value:a, display:formatPrice(a)}} b={{label:monthName+' '+thisYear, value:b, display:formatPrice(b)}}/>
            <AmPmGrid items={pairGrid} title={monthName+' — AM vs PM, each year'}/>
          </>
        };
      }
    },
    {
      id:'q18',
      category:'Trends & Comparisons',
      text:'Is price volatility increasing or decreasing?',
      compute(records) {
        const vol = dailyVolatility(records);
        if (vol.length < 14) return {sentence:'Not enough data to assess a volatility trend.'};
        const first = average(vol.slice(0,7).map(v=>v.std)), last = average(vol.slice(-7).map(v=>v.std));
        const dir = last >= first ? 'increasing' : 'decreasing';
        return {
          sentence: <>Daily price volatility is <b>{dir}</b> — the earliest week in the stored range averaged <b>{formatPrice(first)}</b> std dev, the most recent week averages <b>{formatPrice(last)}</b>.</>,
          render: () => <MiniLineTrend points={vol.map((v,i)=>({x:i, y:v.rollingStd}))} color="#f0c674"/>
        };
      }
    },
    {
      id:'q19',
      category:'Trends & Comparisons',
      text:'How does this quarter compare to the previous quarter?',
      compute(records) {
        if (!records.length) return {sentence:'No data.'};
        const latest = [...records].sort((a,b)=>b.key.localeCompare(a.key))[0];
        const qOf = m => Math.floor((Number(m)-1)/3);
        const latestQ = qOf(latest.key.slice(5,7)), latestY = Number(latest.key.slice(0,4));
        let prevQ = latestQ-1, prevY = latestY;
        if (prevQ<0){prevQ=3;prevY--;}
        const inQuarter = (r, q, y) => Number(r.key.slice(0,4))===y && qOf(r.key.slice(5,7))===q;
        const curRows = records.filter(r=>inQuarter(r,latestQ,latestY));
        const prevRows = records.filter(r=>inQuarter(r,prevQ,prevY));
        const a = prevRows.length?datasetSummary(prevRows).overallAvg:null, b = curRows.length?datasetSummary(curRows).overallAvg:null;
        if (a===null||b===null) return {sentence:'Not enough data in one of the quarters.'};
        const qLabel = q => 'Q'+(q+1);
        const pairGrid = [
          {label:qLabel(prevQ)+' '+prevY, recs:prevRows},
          {label:qLabel(latestQ)+' '+latestY, recs:curRows}
        ].map(({label,recs}) => {
          const {am, pm} = amPmAverages(recs);
          return {label, am, pm};
        });
        return {
          sentence: <><b>{qLabel(latestQ)} {latestY}</b> is averaging <b>{formatPrice(b)}</b> vs <b>{formatPrice(a)}</b> in <b>{qLabel(prevQ)} {prevY}</b>.</>,
          render: () => <>
            <MiniCompareBars a={{label:qLabel(prevQ)+' '+prevY, value:a, display:formatPrice(a)}} b={{label:qLabel(latestQ)+' '+latestY, value:b, display:formatPrice(b)}}/>
            <AmPmGrid items={pairGrid} title="AM vs PM, each quarter"/>
          </>
        };
      }
    },

    // ===== Weekday/Weekend & Seasonal =====
    {
      id:'q20',
      category:'Weekday/Weekend & Seasonal',
      text:'Are weekdays or weekends more expensive?',
      compute(records) {
        const s = seasonalSummary(records, 24);
        if (s.weekday.am===null && s.weekend.am===null) return {sentence:'Not enough data.'};
        const wdAvg = average([s.weekday.am, s.weekday.pm].filter(v=>v!==null));
        const weAvg = average([s.weekend.am, s.weekend.pm].filter(v=>v!==null));
        const winner = wdAvg >= weAvg ? 'Weekdays' : 'Weekends';
        return {
          sentence: <><b>{winner}</b> tend to be more expensive — weekdays average around <b>{formatPrice(wdAvg)}</b>, weekends around <b>{formatPrice(weAvg)}</b> (peak-hour basis, last 24 months).</>,
          render: () => <MiniCompareBars a={{label:'Weekdays', value:wdAvg, display:formatPrice(wdAvg)}} b={{label:'Weekends', value:weAvg, display:formatPrice(weAvg)}}/>
        };
      }
    },
    {
      id:'q21',
      category:'Weekday/Weekend & Seasonal',
      text:'Which season has the highest prices?',
      compute(records) {
        const results = SEASON_DEFS.map(s => ({label:s.label.split(' ')[0], months:s.months, avg: average(seasonHours(records, s.months))}));
        const valid = results.filter(r=>r.avg!==null);
        if (!valid.length) return {sentence:'Not enough data.'};
        const sorted = [...valid].sort((a,b)=>b.avg-a.avg);
        const top = sorted[0];
        const perSeason = SEASON_DEFS.map(s => {
          const rs = records.filter(r => s.months.includes(Number(r.key.slice(5,7))));
          const {am, pm} = amPmAverages(rs);
          return {label:s.label.split(' ')[0], am, pm};
        });
        return {
          sentence: <><b>{top.label}</b> has the highest average hourly price at <b>{formatPrice(top.avg)}</b>.</>,
          render: () => <>
            <MiniRankBar items={sorted.map(r=>({label:r.label, value:r.avg}))} color="#f2b56d"/>
            <AmPmGrid items={perSeason} title="AM vs PM by season"/>
          </>
        };
      }
    },
    {
      id:'q22',
      category:'Weekday/Weekend & Seasonal',
      text:'Which season has the most price volatility?',
      compute(records) {
        const results = SEASON_DEFS.map(s => {
          const vals = seasonHours(records, s.months);
          if (vals.length < 10) return {label:s.label.split(' ')[0], std:null};
          const avg = average(vals);
          const std = Math.sqrt(average(vals.map(v=>(v-avg)**2)));
          return {label:s.label.split(' ')[0], std};
        });
        const valid = results.filter(r=>r.std!==null);
        if (!valid.length) return {sentence:'Not enough data.'};
        const sorted = [...valid].sort((a,b)=>b.std-a.std);
        const top = sorted[0];
        return {
          sentence: <><b>{top.label}</b> shows the most price volatility, with a standard deviation of <b>{formatPrice(top.std)}</b> across all hourly observations.</>,
          render: () => <MiniRankBar items={sorted.map(r=>({label:r.label, value:r.std}))} color="#e05d44"/>
        };
      }
    },
    {
      id:'q23',
      category:'Weekday/Weekend & Seasonal',
      text:'How do holidays compare to ordinary days?',
      compute(records) {
        const h = holidayAnalysis(records, 24);
        const holiday = h.groups.find(g=>g.key==='actual'||g.key==='observed');
        const weekday = h.groups.find(g=>g.key==='weekday');
        if (!holiday || !weekday || holiday.days===0) return {sentence:'Not enough holiday data in the stored range.'};
        const holAvg = average([holiday.am, holiday.pm].filter(v=>v!==null));
        const wdAvg = average([weekday.am, weekday.pm].filter(v=>v!==null));
        return {
          sentence: <>Holidays average <b>{formatPrice(holAvg)}</b> vs <b>{formatPrice(wdAvg)}</b> on ordinary weekdays — holidays are typically <b>{holAvg<wdAvg?'cheaper':'more expensive'}</b>, based on {holiday.days} holiday observations.</>,
          render: () => <MiniCompareBars a={{label:'Ordinary weekday', value:wdAvg, display:formatPrice(wdAvg)}} b={{label:'Holiday', value:holAvg, display:formatPrice(holAvg)}}/>
        };
      }
    },

    // ===== Risk & Extremes =====
    {
      id:'q24',
      category:'Risk & Extremes',
      text:'How many negative-price hours have there been, and is that increasing?',
      compute(records) {
        const neg = negativePriceAnalysis(records);
        if (neg.totalEvents===0) return {sentence:'No negative-price hours found in the stored data.'};
        const half = Math.floor(neg.monthly.length/2);
        const firstHalf = average(neg.monthly.slice(0,half).map(m=>m.count));
        const secondHalf = average(neg.monthly.slice(half).map(m=>m.count));
        const trending = neg.monthly.length>=4 ? (secondHalf>firstHalf?'increasing':'stable or decreasing') : 'not enough history to assess a trend';
        return {
          sentence: <>There have been <b>{neg.totalEvents}</b> negative-price hours across <b>{neg.daysWithNegative}</b> days ({neg.pctNegative.toFixed(2)}% of checked hours). The frequency appears to be <b>{trending}</b> over the stored period.</>,
          render: () => <MiniLineTrend points={neg.monthly.map((m,i)=>({x:i, y:m.count}))} color="#e05d44"/>
        };
      }
    },
    {
      id:'q25',
      category:'Risk & Extremes',
      text:"What's the most extreme 1% of hours look like?",
      compute(records) {
        const prices = allHourlyPrices(records);
        const pd = priceDurationAnalysis(prices, [99]);
        if (!pd) return {sentence:'Not enough data.'};
        const p99 = pd.cvar[0];
        return {
          sentence: <>The top 1% of hours (prices at or above <b>{formatPrice(p99.threshold)}</b>) average <b>{formatPrice(p99.cvar)}</b> — that's {p99.count} hours out of {pd.n.toLocaleString()} total.</>,
          render: () => <MiniStat value={formatPrice(p99.cvar)} sub={p99.count+' hours above '+formatPrice(p99.threshold)} color="#e05d44"/>
        };
      }
    },
    {
      id:'q26',
      category:'Risk & Extremes',
      text:'How many hours exceeded $100/MWh this year?',
      compute(records) {
        if (!records.length) return {sentence:'No data.'};
        const latestYear = [...records].sort((a,b)=>b.key.localeCompare(a.key))[0].key.slice(0,4);
        const rs = records.filter(r=>r.key.slice(0,4)===latestYear);
        const prices = allHourlyPrices(rs);
        const above = prices.filter(v=>v>100).length;
        const pct = prices.length ? (above/prices.length*100) : 0;
        return {
          sentence: <>In <b>{latestYear}</b>, <b>{above}</b> hours exceeded $100/MWh out of {prices.length.toLocaleString()} checked hours (<b>{pct.toFixed(2)}%</b>).</>,
          render: () => <MiniStat value={above.toLocaleString()} sub={pct.toFixed(2)+'% of hours in '+latestYear} color="#e05d44"/>
        };
      }
    },
    {
      id:'q27',
      category:'Risk & Extremes',
      text:'What percentage of hours are "normal" vs. "spike" pricing?',
      compute(records) {
        const prices = allHourlyPrices(records);
        if (!prices.length) return {sentence:'No data.'};
        const avg = average(prices);
        const std = Math.sqrt(average(prices.map(v=>(v-avg)**2)));
        const threshold = avg + 2*std;
        const spikes = prices.filter(v=>v>threshold).length;
        const pct = spikes/prices.length*100;
        return {
          sentence: <>Using a spike definition of more than 2 standard deviations above the mean (<b>{formatPrice(threshold)}</b>), <b>{pct.toFixed(2)}%</b> of hours qualify as spikes ({spikes.toLocaleString()} of {prices.length.toLocaleString()}); the rest are "normal" range.</>,
          render: () => <MiniStat value={pct.toFixed(2)+'%'} sub="spike hours (>2σ above mean)" color="#e05d44"/>
        };
      }
    },

    // ===== Regimes & Patterns =====
    // q28 ("What are the typical day types in this data?") removed — regime detection
    // paused app-wide (Regime & Risk tab hidden) pending redesign. See q34 removal note below.
    {
      id:'q29',
      category:'Regimes & Patterns',
      text:'Is the evening ramp getting steeper over time?',
      compute(records) {
        const feats = records.map(dayFeatures).filter(Boolean).sort((a,b)=>a.key.localeCompare(b.key));
        if (feats.length < 60) return {sentence:'Not enough complete days to assess a trend (need at least 60).'};
        const first30 = average(feats.slice(0,30).map(f=>f.eveningRamp));
        const last30 = average(feats.slice(-30).map(f=>f.eveningRamp));
        const dir = last30 >= first30 ? 'steeper' : 'flatter';
        return {
          sentence: <>The evening ramp (price jump from HE15-16 into HE17-19) is getting <b>{dir}</b> — it averaged <b>{formatPrice(first30)}</b> in the earliest 30 days vs <b>{formatPrice(last30)}</b> in the most recent 30.</>,
          render: () => <MiniCompareBars a={{label:'Earliest 30 days', value:first30, display:formatPrice(first30)}} b={{label:'Recent 30 days', value:last30, display:formatPrice(last30)}}/>
        };
      }
    },

    // ===== Data Health =====
    {
      id:'q30',
      category:'Data Health',
      text:'How complete is the stored dataset — any gaps?',
      compute(records) {
        const audit = dayAudit(records);
        if (!records.length) return {sentence:'No data stored yet.'};
        const complete = audit.checked - audit.missingDays.length - audit.incomplete.length;
        const pct = audit.checked ? (complete/audit.checked*100) : 0;
        return {
          sentence: <>Of <b>{audit.checked}</b> calendar days in the stored range, <b>{complete}</b> are fully complete (<b>{pct.toFixed(1)}%</b>). <b>{audit.missingDays.length}</b> days are entirely missing, and <b>{audit.incomplete.length}</b> have at least one missing hour.</>,
          render: () => <MiniStat value={pct.toFixed(1)+'%'} sub={complete+' of '+audit.checked+' days complete'} color={pct>95?'#0d7a65':'#9c8a4a'}/>
        };
      }
    },
    {
      id:'q31',
      category:'Data Health',
      text:'How many days of history do I have, and what date range?',
      compute(records) {
        if (!records.length) return {sentence:'No data stored yet.'};
        const sorted = [...records].sort((a,b)=>a.key.localeCompare(b.key));
        return {
          sentence: <>You have <b>{records.length.toLocaleString()}</b> stored days, spanning <b>{sorted[0].key}</b> to <b>{sorted[sorted.length-1].key}</b>.</>,
          render: () => <MiniStat value={records.length.toLocaleString()} sub={sorted[0].key+' → '+sorted[sorted.length-1].key} color="#3877aa"/>
        };
      }
    },

    // ===== Operational Insights =====
    {
      id:'q32',
      category:'Operational Insights',
      text:'How much more could I earn concentrating generation in the best hours vs. running flat?',
      compute(records) {
        const sorted = [...records].sort((a,b)=>b.key.localeCompare(a.key));
        const recent = sorted.slice(0, 90);
        const N = 8; // best hours/day assumed concentratable — matches Release Comparison default elsewhere in the app
        const perDay = recent.map(r => {
          const vals = HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice);
          if (vals.length < 24) return null;
          const flatAvg = average(vals);
          const bestN = [...vals].sort((a,b)=>b-a).slice(0,N);
          const bestAvg = average(bestN);
          return {flatAvg, bestAvg};
        }).filter(Boolean);
        if (!perDay.length) return {sentence:'Not enough complete days (need all 24 hours) in the last 90 days to compute this.'};
        const flat = average(perDay.map(d=>d.flatAvg));
        const best = average(perDay.map(d=>d.bestAvg));
        const upliftPct = flat ? (best-flat)/Math.abs(flat)*100 : null;
        return {
          sentence: <>Concentrating generation in the best <b>{N}</b> hours/day (vs. running flat across all 24) would have captured <b>{formatPrice(best)}</b>/MWh on average vs <b>{formatPrice(flat)}</b>/MWh flat — an uplift of <b>{upliftPct!==null?upliftPct.toFixed(1)+'%':'—'}</b>, based on the last {perDay.length} complete days. Assumes full flexibility to shift all output into those hours; actual uplift depends on water/ramp constraints.</>,
          render: () => <MiniCompareBars a={{label:'Flat (24hr avg)', value:flat, display:formatPrice(flat)}} b={{label:'Best '+N+' hrs/day', value:best, display:formatPrice(best)}}/>
        };
      }
    },
    {
      id:'q33',
      category:'Operational Insights',
      text:"What's the longest stretch of consecutive negative-price hours?",
      compute(records) {
        const sorted = [...records].sort((a,b)=>a.key.localeCompare(b.key));
        const hourly = [];
        sorted.forEach(r => {
          HE_COLS.slice(0,24).forEach((h,i) => {
            const v = r.hours[h];
            if (validPrice(v)) hourly.push({date:r.key, he:i+1, price:v});
          });
        });
        let longest = {len:0}, current = {len:0, start:null};
        hourly.forEach((pt) => {
          if (pt.price < 0) {
            if (current.len === 0) current.start = pt;
            current.len++;
            current.end = pt;
            if (current.len > longest.len) longest = {...current};
          } else {
            current = {len:0, start:null};
          }
        });
        if (longest.len === 0) return {sentence:'No negative-price hours found — no streak to report.'};
        return {
          sentence: <>The longest run of consecutive negative-price hours was <b>{longest.len}</b> hour(s), from <b>{longest.start.date} {longest.start.he===24?'HE24':'HE'+String(longest.start.he).padStart(2,'0')}</b> to <b>{longest.end.date} HE{String(longest.end.he).padStart(2,'0')}</b>.</>,
          render: () => <MiniStat value={longest.len+' hrs'} sub={longest.start.date+' → '+longest.end.date} color="#e05d44"/>
        };
      }
    },
    {
      id:'q35',
      category:'Operational Insights',
      text:'What has the evening peak typically looked like in this month historically?',
      compute(records) {
        if (!records.length) return {sentence:'No data.'};
        const latest = [...records].sort((a,b)=>b.key.localeCompare(a.key))[0];
        const nextMonthDate = new Date(Date.UTC(Number(latest.key.slice(0,4)), Number(latest.key.slice(5,7)), 1));
        const nextMonth = nextMonthDate.getUTCMonth()+1;
        const monthName = MONTH_ABBR[nextMonth-1];
        const priorYearsRows = completePeakRows(records.filter(r => Number(r.key.slice(5,7)) === nextMonth));
        if (!priorYearsRows.length) return {sentence:`Not enough historical ${monthName} data (need complete AM/PM days) to build a seasonal reference.`};
        const pmAvg = average(priorYearsRows.map(r=>r.pm));
        const amAvg = average(priorYearsRows.map(r=>r.am));
        const years = [...new Set(priorYearsRows.map(r=>r.date.slice(0,4)))];
        return {
          sentence: <>Based on {priorYearsRows.length} historical <b>{monthName}</b> day(s) across {years.length} year(s), the typical evening peak has averaged <b>{formatPrice(pmAvg)}</b> (morning peak <b>{formatPrice(amAvg)}</b>). This is a historical seasonal reference, not a forecast — it does not account for this year's specific conditions.</>,
          render: () => <MiniCompareBars a={{label:'Typical AM peak', value:amAvg, display:formatPrice(amAvg)}} b={{label:'Typical PM peak', value:pmAvg, display:formatPrice(pmAvg)}}/>
        };
      }
    }
    // q34 ("Which day-type (regime) is most valuable on average?") removed from the list —
    // paused pending a redesign. The metric it reported (highest-average-price regime cluster)
    // doesn't account for capturability, operational constraints, or regime stability across
    // different date ranges, so it read as a stronger recommendation than the underlying stat
    // supports. Revisit alongside the planned "shaping uplift + operational constraints" feature.
  ];
}

const ASK_CATEGORIES = [
  'Price Level & Ranking',
  'Peak Timing (AM vs PM)',
  'Trends & Comparisons',
  'Weekday/Weekend & Seasonal',
  'Risk & Extremes',
  'Regimes & Patterns',
  'Data Health',
  'Operational Insights'
];

function AskPanel({records}) {
  const questions = useMemo(() => buildAskQuestions(), []);
  const [openCategories, setOpenCategories] = useState(() => new Set([ASK_CATEGORIES[0]]));
  const [answers, setAnswers] = useState([]);

  const toggleCategory = (cat) => {
    setOpenCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const askQuestion = (q) => {
    setAnswers(prev => {
      const alreadyAnswered = prev.some(a => a.id === q.id);
      if (alreadyAnswered) {
        return prev.filter(a => a.id !== q.id);
      }
      let result;
      try {
        result = q.compute(records);
      } catch (e) {
        result = { sentence: 'Could not compute an answer (' + e.message + ').' };
      }
      return [...prev, { id: q.id, text: q.text, result }];
    });
  };

  const closeAnswer = (id) => {
    setAnswers(prev => prev.filter(a => a.id !== id));
  };

  const AnswerCard = ({a}) => (
    <div className="answer-card" style={{
      background:'linear-gradient(155deg,#f0f9f7,#e7f4f3)',
      border:'1px solid #b6e0d8',
      borderRadius:12,
      padding:'16px 18px',
      marginTop:12
    }}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
        <div style={{fontSize:11, color:'#4a8a7e', fontWeight:700, textTransform:'uppercase', letterSpacing:0.4}}>{a.text}</div>
        <button className="ghost" style={{padding:'3px 8px', fontSize:11}} onClick={()=>closeAnswer(a.id)}>✕ close</button>
      </div>
      <div style={{fontSize:15, color:'#16332c', lineHeight:1.5, marginTop:8}}>{a.result.sentence}</div>
      {a.result.render && a.result.render()}
    </div>
  );

  if (!records.length) {
    return <div className="card"><div className="empty">No data yet — download or import prices first.</div></div>;
  }

  return <div>
    <div className="card">
      <div className="section-heading">
        <div>
          <h2>Ask</h2>
          <p>Click a question for an instant answer based on your stored price history. Click again to close it. Multiple answers can stay open at once within each category.</p>
        </div>
      </div>

      {ASK_CATEGORIES.map(cat => {
        const catQuestions = questions.filter(q => q.category === cat);
        const isOpen = openCategories.has(cat);
        const catAnswers = answers.filter(a => catQuestions.some(q => q.id === a.id));
        return <div key={cat} className="card" style={{marginTop:12, padding:0, overflow:'hidden'}}>
          <div
            onClick={() => toggleCategory(cat)}
            style={{padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer'}}
          >
            <h3 style={{margin:0, fontSize:15}}>{cat}</h3>
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <span style={{fontSize:11, color:'#8da0b3', background:'#eef2f6', padding:'3px 9px', borderRadius:20}}>{catQuestions.length} questions</span>
              <span style={{fontSize:13, color:'#8da0b3', transform: isOpen?'rotate(90deg)':'none', display:'inline-block', transition:'transform 0.15s'}}>▸</span>
            </div>
          </div>
          {isOpen && (
            <div style={{padding:'0 18px 18px'}}>
              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:10}}>
                {catQuestions.map(q => {
                  const isAnswered = answers.some(a => a.id === q.id);
                  return (
                    <button
                      key={q.id}
                      style={{
                        textAlign:'left',
                        fontWeight: isAnswered ? 600 : 500,
                        background: isAnswered ? '#e3f2ff' : '#f7fafc',
                        color: isAnswered ? '#123b63' : '#2b3e50',
                        border: isAnswered ? '1px solid #3877aa' : '1px solid #dce4ed',
                        padding: '13px 15px',
                        borderRadius: 10
                      }}
                      onClick={() => askQuestion(q)}
                    >
                      {q.text}
                    </button>
                  );
                })}
              </div>
              {catAnswers.map(a => <AnswerCard key={a.id} a={a}/>)}
            </div>
          )}
        </div>;
      })}
    </div>
  </div>;
}


// ===== report.jsx =====
// report.jsx — Report generator: period picker, section checklist, Markdown + HTML export.
// Load AFTER parsing.jsx, analysis-core.jsx, analysis-regimes.jsx, analysis-negative.jsx.

function reportPeriodToRange(period, records) {
  if (!period || period.mode === 'all') {
    if (!records.length) return null;
    const sorted = [...records].sort((a,b)=>a.key.localeCompare(b.key));
    return { start: sorted[0].key, end: sorted[sorted.length-1].key, label: 'All available data' };
  }
  if (period.mode === 'year') {
    return { start: period.year+'-01-01', end: period.year+'-12-31', label: String(period.year) };
  }
  if (period.mode === 'fiscal') {
    const y = period.startYear;
    return { start: y+'-10-01', end: (y+1)+'-09-30', label: 'FY'+(y+1)+' (Oct '+y+' – Sep '+(y+1)+')' };
  }
  if (period.mode === 'custom') {
    return { start: period.start, end: period.end, label: period.start+' to '+period.end };
  }
  return null;
}

function filterRecordsForReport(records, period) {
  const range = reportPeriodToRange(period, records);
  if (!range) return { records: [], range: null };
  const filtered = records.filter(r => r.key >= range.start && r.key <= range.end);
  return { records: filtered, range };
}

function buildReportSections() {
  return [
    {
      id: 'overview', label: 'Dataset overview', group: 'Summary',
      build(records) {
        if (!records.length) return { summary: 'No data in this period.' };
        const s = datasetSummary(records);
        const sorted = [...records].sort((a,b)=>a.key.localeCompare(b.key));
        return {
          summary: `This report covers ${records.length} stored operating day(s), from ${sorted[0].key} to ${sorted[sorted.length-1].key}.`,
          stats: [
            { label: 'Days in period', value: records.length.toLocaleString() },
            { label: 'Hourly observations', value: s.totalHours.toLocaleString() },
            { label: 'Overall average price', value: formatPrice(s.overallAvg) },
            { label: 'Overall std dev', value: formatPrice(s.overallStd) }
          ]
        };
      }
    },
    {
      id: 'price-ranking', label: 'Price ranking (month / year / day of week)', group: 'Summary',
      build(records) {
        if (!records.length) return { summary: 'No data in this period.' };
        const s = datasetSummary(records);
        return {
          summary: `Highest-priced month: ${s.monthRank[0]?.label || '—'} (${formatPrice(s.monthRank[0]?.avg)}). Highest-priced day of week: ${s.dowRank[0]?.label || '—'} (${formatPrice(s.dowRank[0]?.avg)}).`,
          table: {
            headers: ['Month', 'Avg price', 'Days'],
            rows: s.monthRank.map(m => [m.label, formatPrice(m.avg), String(m.n)])
          }
        };
      }
    },
    {
      id: 'am-pm', label: 'Morning vs evening peaks', group: 'Peak Timing',
      build(records) {
        const rows = completePeakRows(records);
        if (!rows.length) return { summary: 'Not enough complete AM/PM days in this period.' };
        const am = average(rows.map(r=>r.am)), pm = average(rows.map(r=>r.pm));
        return {
          summary: `Based on ${rows.length} complete days: morning peaks average ${formatPrice(am)}, evening peaks average ${formatPrice(pm)}. ${pm>=am?'Evening':'Morning'} is typically higher by ${formatPrice(Math.abs(pm-am))}.`,
          stats: [
            { label: 'AM peak average', value: formatPrice(am) },
            { label: 'PM peak average', value: formatPrice(pm) },
            { label: 'PM advantage', value: formatPrice(pm-am) },
            { label: 'Complete days', value: String(rows.length) }
          ]
        };
      }
    },
    {
      id: 'seasonal', label: 'Seasonal patterns (weekday/weekend, holidays)', group: 'Seasonal',
      build(records) {
        if (!records.length) return { summary: 'No data in this period.' };
        const monthsSpan = 36; // wide enough to cover any report period's lookback needs
        const s = seasonalSummary(records, monthsSpan);
        const h = holidayAnalysis(records, monthsSpan);
        const holidayGroup = h.groups.find(g=>g.key==='actual'||g.key==='observed');
        return {
          summary: `Weekdays average ${formatPrice(average([s.weekday.am,s.weekday.pm].filter(v=>v!==null)))}; weekends average ${formatPrice(average([s.weekend.am,s.weekend.pm].filter(v=>v!==null)))}.${holidayGroup&&holidayGroup.days?' Holidays ('+holidayGroup.days+' observed) average '+formatPrice(average([holidayGroup.am,holidayGroup.pm].filter(v=>v!==null)))+'.':''}`,
          table: {
            headers: ['Group', 'Days', 'AM avg', 'PM avg'],
            rows: [
              ['Weekday', String(s.weekday.days), formatPrice(s.weekday.am), formatPrice(s.weekday.pm)],
              ['Weekend', String(s.weekend.days), formatPrice(s.weekend.am), formatPrice(s.weekend.pm)]
            ]
          }
        };
      }
    },
    {
      id: 'trends', label: 'Recent trend (up/down movement)', group: 'Trends',
      build(records) {
        const t = trendInsights(records, 12);
        if (!t.change) return { summary: 'Not enough recent comparable days in this period to assess a trend.' };
        return {
          summary: `Morning peaks changed by ${formatPrice(t.change.am)} and evening peaks by ${formatPrice(t.change.pm)}, comparing the most recent 30 comparable days to the preceding 30.`,
          stats: [
            { label: 'AM change', value: formatPrice(t.change.am) },
            { label: 'PM change', value: formatPrice(t.change.pm) },
            { label: 'PM advantage change', value: formatPrice(t.change.diff) }
          ]
        };
      }
    },
    {
      id: 'negative-prices', label: 'Negative price events', group: 'Risk',
      build(records) {
        const neg = negativePriceAnalysis(records);
        if (neg.totalEvents === 0) return { summary: 'No negative-price hours recorded in this period.' };
        return {
          summary: `${neg.totalEvents} negative-price hour(s) across ${neg.daysWithNegative} day(s) (${neg.pctNegative.toFixed(2)}% of checked hours). Worst event: ${formatPrice(neg.worstEvent?.price)} on ${neg.worstEvent?.date} at ${neg.worstEvent?.he}.`,
          stats: [
            { label: 'Total events', value: String(neg.totalEvents) },
            { label: 'Days affected', value: String(neg.daysWithNegative) },
            { label: 'Average negative price', value: formatPrice(neg.avgNegativePrice) },
            { label: 'Worst event', value: neg.worstEvent ? formatPrice(neg.worstEvent.price)+' ('+neg.worstEvent.date+')' : '—' }
          ],
          table: {
            headers: ['Month', 'Event count', 'Worst price'],
            rows: neg.monthly.map(m => [m.month, String(m.count), formatPrice(m.worstPrice)])
          }
        };
      }
    },
    {
      id: 'risk-tail', label: 'Tail risk (price-duration / CVaR)', group: 'Risk',
      build(records) {
        const prices = allHourlyPrices(records);
        const pd = priceDurationAnalysis(prices, [50,75,90,95,99]);
        if (!pd) return { summary: 'Not enough data in this period.' };
        return {
          summary: `Across ${pd.n.toLocaleString()} hourly observations, the top 1% of hours (≥${formatPrice(pd.cvar.find(c=>c.p===99)?.threshold)}) average ${formatPrice(pd.cvar.find(c=>c.p===99)?.cvar)}.`,
          table: {
            headers: ['Percentile', 'Threshold', 'Hours at/above', 'CVaR'],
            rows: pd.cvar.map(c => ['P'+c.p, formatPrice(c.threshold), String(c.count), formatPrice(c.cvar)])
          }
        };
      }
    },
    {
      id: 'regimes', label: 'Day-type regimes', group: 'Patterns',
      build(records) {
        const result = runRegimeDetection(records, 5);
        if (!result) return { summary: 'Not enough complete days in this period to detect regimes.' };
        return {
          summary: `${result.clusters.length} day-type regimes identified across ${result.totalDays} complete days. Most common: "${result.clusters[0].label}" (${Math.round(result.clusters[0].n/result.totalDays*100)}% of days).`,
          table: {
            headers: ['Regime', 'Days', '% of total', 'Avg price', 'Avg peak'],
            rows: result.clusters.map(c => [c.label, String(c.n), Math.round(c.n/result.totalDays*100)+'%', formatPrice(c.avgPrice), formatPrice(c.avgPeak)])
          }
        };
      }
    },
    {
      id: 'data-quality', label: 'Data completeness', group: 'Data Quality',
      build(records) {
        const audit = dayAudit(records);
        if (!records.length) return { summary: 'No data in this period.' };
        const complete = audit.checked - audit.missingDays.length - audit.incomplete.length;
        const pct = audit.checked ? (complete/audit.checked*100) : 0;
        return {
          summary: `${complete} of ${audit.checked} calendar days (${pct.toFixed(1)}%) are fully complete. ${audit.missingDays.length} day(s) missing entirely; ${audit.incomplete.length} day(s) have at least one missing hour.`,
          stats: [
            { label: 'Days checked', value: String(audit.checked) },
            { label: 'Complete days', value: `${complete} (${pct.toFixed(1)}%)` },
            { label: 'Missing days', value: String(audit.missingDays.length) },
            { label: 'Incomplete days', value: String(audit.incomplete.length) }
          ]
        };
      }
    }
  ];
}

const REPORT_SECTION_GROUPS = ['Summary', 'Peak Timing', 'Seasonal', 'Trends', 'Risk', 'Patterns', 'Data Quality'];

function renderReportMarkdown(rangeLabel, sectionResults) {
  const lines = [];
  lines.push('# MEAD Day-Ahead Price Report');
  lines.push('');
  lines.push(`**Period:** ${rangeLabel}`);
  lines.push(`**Generated:** ${new Date().toLocaleString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  sectionResults.forEach(sec => {
    lines.push(`## ${sec.label}`);
    lines.push('');
    if (sec.data.summary) {
      lines.push(sec.data.summary);
      lines.push('');
    }
    if (sec.data.stats && sec.data.stats.length) {
      sec.data.stats.forEach(s => lines.push(`- **${s.label}:** ${s.value}`));
      lines.push('');
    }
    if (sec.data.table && sec.data.table.rows.length) {
      const { headers, rows } = sec.data.table;
      lines.push('| ' + headers.join(' | ') + ' |');
      lines.push('| ' + headers.map(()=>'---').join(' | ') + ' |');
      rows.forEach(r => lines.push('| ' + r.join(' | ') + ' |'));
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  });

  lines.push('_This report reflects historical CAISO day-ahead price data only. It does not account for water availability, reservoir elevation, environmental flow requirements, ramp limits, or unit availability._');
  return lines.join('\n');
}

function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], {type: mime || 'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderReportHtml(rangeLabel, sectionResults) {
  const sectionsHtml = sectionResults.map(sec => {
    let html = `<h2>${escapeHtml(sec.label)}</h2>`;
    if (sec.data.summary) {
      html += `<p class="summary">${escapeHtml(sec.data.summary)}</p>`;
    }
    if (sec.data.stats && sec.data.stats.length) {
      html += '<ul class="stats">';
      sec.data.stats.forEach(s => {
        html += `<li><strong>${escapeHtml(s.label)}:</strong> ${escapeHtml(s.value)}</li>`;
      });
      html += '</ul>';
    }
    if (sec.data.table && sec.data.table.rows.length) {
      const { headers, rows } = sec.data.table;
      html += '<table><thead><tr>';
      headers.forEach(h => html += `<th>${escapeHtml(h)}</th>`);
      html += '</tr></thead><tbody>';
      rows.forEach(r => {
        html += '<tr>' + r.map(cell => `<td>${escapeHtml(cell)}</td>`).join('') + '</tr>';
      });
      html += '</tbody></table>';
    }
    return html;
  }).join('<hr/>');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>MEAD Day-Ahead Price Report — ${escapeHtml(rangeLabel)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 24px; color: #182b3c; line-height: 1.6; }
  h1 { font-size: 26px; margin-bottom: 4px; }
  .meta { color: #526578; font-size: 13px; margin-bottom: 28px; }
  .meta strong { color: #182b3c; }
  h2 { font-size: 19px; margin-top: 32px; margin-bottom: 10px; color: #14695d; border-bottom: 2px solid #e1e8ef; padding-bottom: 6px; }
  p.summary { font-size: 14px; margin: 0 0 12px; }
  ul.stats { list-style: none; padding: 0; margin: 0 0 16px; }
  ul.stats li { padding: 6px 0; border-bottom: 1px solid #f0f4f8; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0 20px; font-size: 13px; }
  th, td { border: 1px solid #dce4ed; padding: 7px 10px; text-align: left; }
  th { background: #f7fafc; font-weight: 600; }
  tr:nth-child(even) td { background: #fafbfc; }
  hr { border: none; border-top: 1px solid #e1e8ef; margin: 28px 0; }
  .footer { margin-top: 36px; font-size: 11px; color: #8da0b3; font-style: italic; }
  @media print {
    body { margin: 0; max-width: none; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>MEAD Day-Ahead Price Report</h1>
  <div class="meta"><strong>Period:</strong> ${escapeHtml(rangeLabel)} &nbsp;·&nbsp; <strong>Generated:</strong> ${escapeHtml(new Date().toLocaleString())}</div>
  ${sectionsHtml}
  <div class="footer">This report reflects historical CAISO day-ahead price data only. It does not account for water availability, reservoir elevation, environmental flow requirements, ramp limits, or unit availability.</div>
</body>
</html>`;
}

function ReportPanel({records}) {
  const [reportMode, setReportMode] = useState('summary');
  const sections = useMemo(() => buildReportSections(), []);
  const years = useMemo(() => [...new Set(records.map(r=>r.key.slice(0,4)))].sort((a,b)=>b-a), [records]);

  const [periodMode, setPeriodMode] = useState('all');
  const [periodYear, setPeriodYear] = useState(() => years[0] || new Date().getFullYear());
  const [fiscalStartYear, setFiscalStartYear] = useState(() => Number(years[0] || new Date().getFullYear()) - 1);
  const [customStart, setCustomStart] = useState(() => records.length ? [...records].sort((a,b)=>a.key.localeCompare(b.key))[0].key : '');
  const [customEnd, setCustomEnd] = useState(() => records.length ? [...records].sort((a,b)=>b.key.localeCompare(a.key))[0].key : '');

  const [selectedIds, setSelectedIds] = useState(() => new Set(sections.map(s=>s.id)));
  const [generating, setGenerating] = useState(false);
  const [generatedMarkdown, setGeneratedMarkdown] = useState(null);
  const [lastSectionResults, setLastSectionResults] = useState(null);
  const [rangeLabel, setRangeLabel] = useState('');

  const period = useMemo(() => {
    if (periodMode === 'all') return { mode: 'all' };
    if (periodMode === 'year') return { mode: 'year', year: periodYear };
    if (periodMode === 'fiscal') return { mode: 'fiscal', startYear: fiscalStartYear };
    if (periodMode === 'custom') return { mode: 'custom', start: customStart, end: customEnd };
    return { mode: 'all' };
  }, [periodMode, periodYear, fiscalStartYear, customStart, customEnd]);

  const toggleSection = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleGroup = (group, allOn) => {
    const groupIds = sections.filter(s=>s.group===group).map(s=>s.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      groupIds.forEach(id => allOn ? next.add(id) : next.delete(id));
      return next;
    });
  };

  const generate = () => {
    setGenerating(true);
    try {
      const { records: filtered, range } = filterRecordsForReport(records, period);
      if (!range) {
        setGeneratedMarkdown('No data available for the selected period.');
        setLastSectionResults(null);
        setRangeLabel('');
        setGenerating(false);
        return;
      }
      const chosen = sections.filter(s => selectedIds.has(s.id));
      const sectionResults = chosen.map(s => {
        let data;
        try { data = s.build(filtered); }
        catch (e) { data = { summary: 'Could not generate this section (' + e.message + ').' }; }
        return { label: s.label, data };
      });
      const md = renderReportMarkdown(range.label, sectionResults);
      setGeneratedMarkdown(md);
      setLastSectionResults(sectionResults);
      setRangeLabel(range.label);
    } catch (e) {
      setGeneratedMarkdown('Report generation failed: ' + e.message);
      setLastSectionResults(null);
    }
    setGenerating(false);
  };

  const exportMarkdown = () => {
    if (!generatedMarkdown) return;
    const filename = 'mead-price-report-' + (rangeLabel||'report').replace(/[^a-z0-9]+/gi,'-').toLowerCase() + '.md';
    downloadTextFile(filename, generatedMarkdown, 'text/markdown');
  };

  const exportHtml = () => {
    if (!lastSectionResults) return;
    const html = renderReportHtml(rangeLabel, lastSectionResults);
    const filename = 'mead-price-report-' + (rangeLabel||'report').replace(/[^a-z0-9]+/gi,'-').toLowerCase() + '.html';
    downloadTextFile(filename, html, 'text/html');
  };

if (!records.length) {
    return <div className="card"><div className="empty">No data yet — download or import prices first.</div></div>;
  }

  const modeToggle = <div className="card" style={{padding:16}}>
    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
      <div
        onClick={()=>setReportMode('summary')}
        style={{
          cursor:'pointer', padding:'16px 18px', borderRadius:10,
          border: reportMode==='summary' ? '2px solid #35c4ae' : '2px solid #dce4ed',
          background: reportMode==='summary' ? '#eafaf7' : '#f7fafc',
          display:'flex', alignItems:'flex-start', gap:12
        }}
      >
        <div style={{
          width:20, height:20, borderRadius:'50%', flexShrink:0, marginTop:2,
          border: reportMode==='summary' ? '6px solid #35c4ae' : '2px solid #b7c3cf',
          background:'#fff'
        }}/>
        <div>
          <div style={{fontWeight:700, fontSize:15, color:'#16332c'}}>Summary report</div>
          <div style={{fontSize:12.5, color:'#5c7183', marginTop:2}}>9 curated sections · Markdown + HTML export</div>
        </div>
      </div>
      <div
        onClick={()=>setReportMode('full')}
        style={{
          cursor:'pointer', padding:'16px 18px', borderRadius:10,
          border: reportMode==='full' ? '2px solid #35c4ae' : '2px solid #dce4ed',
          background: reportMode==='full' ? '#eafaf7' : '#f7fafc',
          display:'flex', alignItems:'flex-start', gap:12
        }}
      >
        <div style={{
          width:20, height:20, borderRadius:'50%', flexShrink:0, marginTop:2,
          border: reportMode==='full' ? '6px solid #35c4ae' : '2px solid #b7c3cf',
          background:'#fff'
        }}/>
        <div>
          <div style={{fontWeight:700, fontSize:15, color:'#16332c'}}>Full report</div>
          <div style={{fontSize:12.5, color:'#5c7183', marginTop:2}}>Selected analyses with charts · HTML export only</div>
        </div>
      </div>
    </div>
  </div>;

  if (reportMode === 'full') {
    return <div>{modeToggle}<FullReportPanel records={records}/></div>;
  }

  return <div>
    {modeToggle}
    <div className="card">
      <div className="section-heading">
        <div>
          <h2>Generate report</h2>
          <p>Choose a period and the sections to include, then generate. Word export is coming in a later update — Markdown and HTML (printable to PDF from any browser) are available now.</p>
        </div>
      </div>

      <h3>Period</h3>
      <div className="row">
        <label>
          <select value={periodMode} onChange={e=>setPeriodMode(e.target.value)}>
            <option value="all">All available data</option>
            <option value="year">Specific calendar year</option>
            <option value="fiscal">Fiscal year (Oct–Sep)</option>
            <option value="custom">Custom date range</option>
          </select>
        </label>
        {periodMode === 'year' && (
          <label>Year
            <select value={periodYear} onChange={e=>setPeriodYear(e.target.value)}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        )}
        {periodMode === 'fiscal' && (
          <label>Fiscal year
            <select value={fiscalStartYear} onChange={e=>setFiscalStartYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={Number(y)-1}>FY{y} (Oct {Number(y)-1} – Sep {y})</option>)}
            </select>
          </label>
        )}
        {periodMode === 'custom' && (
          <>
            <label>From <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}/></label>
            <label>To <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}/></label>
          </>
        )}
      </div>

      <h3>Sections to include</h3>
      {REPORT_SECTION_GROUPS.map(group => {
        const groupSections = sections.filter(s=>s.group===group);
        if (!groupSections.length) return null;
        const allOn = groupSections.every(s=>selectedIds.has(s.id));
        return <div key={group} style={{marginBottom:14}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
            <strong style={{fontSize:13}}>{group}</strong>
            <button className="ghost" style={{padding:'3px 10px', fontSize:11}} onClick={()=>toggleGroup(group, !allOn)}>
              {allOn ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:8}}>
            {groupSections.map(s => (
              <label key={s.id} style={{display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer'}}>
                <input type="checkbox" checked={selectedIds.has(s.id)} onChange={()=>toggleSection(s.id)}/>
                {s.label}
              </label>
            ))}
          </div>
        </div>;
      })}

      <div className="row" style={{marginTop:16}}>
        <button onClick={generate} disabled={generating || selectedIds.size===0}>
          {generating ? 'Generating...' : 'Generate report'}
        </button>
        {selectedIds.size===0 && <span style={{fontSize:12, color:'#8da0b3'}}>Select at least one section.</span>}
      </div>
    </div>

    {generatedMarkdown && (
      <div className="card">
        <div className="row" style={{justifyContent:'space-between'}}>
          <h3 style={{margin:0}}>Preview — {rangeLabel}</h3>
          <div className="row" style={{marginBottom:0}}>
            <button onClick={exportMarkdown}>↓ Download Markdown</button>
            <button onClick={exportHtml}>↓ Download HTML (print to PDF from browser)</button>
            <button className="ghost" disabled title="Coming in a later update">Download Word</button>
          </div>
        </div>

        <div className="scroll" style={{maxHeight:500, marginTop:12}}>
          <pre style={{whiteSpace:'pre-wrap', fontFamily:'inherit', fontSize:13, lineHeight:1.6, background:'#f7fafc', padding:16, borderRadius:8, border:'1px solid #e1e8ef'}}>
            {generatedMarkdown}
          </pre>
        </div>
      </div>
    )}
  </div>;
}


// ===== report-full.jsx =====
// report-full.jsx — Selected day-ahead analyses and charts captured as images.
// Load AFTER report.jsx, BEFORE app.jsx (needs ReportPanel's period helpers + all analysis fns).
// HTML-only export (image embedding bloats Markdown). Recomputes everything fresh for the
// report's own period selection — does NOT reuse whatever the live tabs currently show.

const FULL_REPORT_CHART_WIDTH = 860;

// ---- Chart image capture ----
function CaptureChart({id, traces, layout, height, onCaptured}) {
  const ref = useRef(null);
  const captured = useRef(false);
  useEffect(() => {
    if (captured.current) return;
    if (typeof window.Plotly === 'undefined' || !ref.current) {
      onCaptured(id, null);
      captured.current = true;
      return;
    }
    const mergedLayout = {
      autosize: false,
      width: FULL_REPORT_CHART_WIDTH,
      height: height || 320,
      margin: {l:56,r:16,t:30,b:44},
      paper_bgcolor:'#ffffff',
      plot_bgcolor:'#ffffff',
      font:{color:'#182b3c', size:12},
      ...layout,
      xaxis:{gridcolor:'#dce4ed', zeroline:false, ...(layout&&layout.xaxis)},
      yaxis:{gridcolor:'#dce4ed', zeroline:false, ...(layout&&layout.yaxis)}
    };
    window.Plotly.newPlot(ref.current, traces, mergedLayout, {staticPlot:true})
      .then(() => window.Plotly.toImage(ref.current, {format:'png', width:FULL_REPORT_CHART_WIDTH, height:height||320}))
      .then(url => { captured.current = true; onCaptured(id, url); })
      .catch(e => { console.error('Chart capture failed for', id, e); captured.current = true; onCaptured(id, null); });
  }, []);
  return <div ref={ref} style={{width:FULL_REPORT_CHART_WIDTH, height:height||320}}/>;
}

// ---- Chart specs ----
function buildFullReportChartSpecs(filtered) {
  const specs = [];
  const sortedF = [...filtered].sort((a,b)=>b.key.localeCompare(a.key));

  // ---- Price Level & Ranking (mirrors Ask q1, q4) ----
  const summary = datasetSummary(filtered);
  if (summary.monthRank.length) {
    specs.push({id:'rank-month', height:300, layout:{margin:{l:56,r:16,t:20,b:50}, yaxis:{title:'$/MWh'}, xaxis:{title:'Month'}}, traces:[{
      type:'bar', x:summary.monthRank.map(m=>m.label), y:summary.monthRank.map(m=>m.avg), marker:{color:'#35c4ae'}
    }]});
  }
  if (summary.dowRank.length) {
    specs.push({id:'rank-dow', height:300, layout:{margin:{l:56,r:16,t:20,b:70}, yaxis:{title:'$/MWh'}, xaxis:{title:'Day of week', tickangle:-30}}, traces:[{
      type:'bar', x:summary.dowRank.map(d=>d.label), y:summary.dowRank.map(d=>d.avg), marker:{color:'#3877aa'}
    }]});
  }

  // ---- AM vs PM comparison (mirrors Ask q10) ----
  const peakRows = completePeakRows(filtered);
  if (peakRows.length) {
    const am = average(peakRows.map(r=>r.am)), pm = average(peakRows.map(r=>r.pm));
    specs.push({id:'am-vs-pm', height:220, layout:{margin:{l:90,r:40,t:20,b:40}, xaxis:{title:'$/MWh'}}, traces:[{
      type:'bar', orientation:'h', y:['Morning (AM)','Evening (PM)'], x:[am,pm], marker:{color:['#35c4ae','#3877aa']}
    }]});
  }

  // ---- Seasonal: rolling AM/PM (fixed 30-day window for report) ----
  const rolling = rollingAnalysis(filtered, 30);
  if (rolling.points.length) {
    specs.push({id:'seasonal-rolling', height:360, layout:{margin:{l:56,r:16,t:30,b:90}, yaxis:{title:'$/MWh'}, xaxis:{title:'Date', tickangle:-45, type:'category'}}, traces:[
      {type:'scatter', mode:'lines', name:'AM peak', x:rolling.points.map(p=>p.date), y:rolling.points.map(p=>p.am), line:{color:'#1479bd'}},
      {type:'scatter', mode:'lines', name:'PM peak', x:rolling.points.map(p=>p.date), y:rolling.points.map(p=>p.pm), line:{color:'#e08724'}}
    ]});
  }

  // ---- Seasonal: monthly box plot (last 365 calendar days in filtered set) ----
  const boxCutoff = sortedF.length ? addDaysToIso(sortedF[0].key, -364) : '';
  const boxRecords = filtered.filter(r=>r.key>=boxCutoff);
  const hourData = HE_COLS.slice(0,24).map((h,i)=>({h,i,vals:boxRecords.map(r=>r.hours[h]).filter(validPrice)})).filter(d=>d.vals.length);
  if (hourData.length) {
    specs.push({id:'seasonal-boxplot', height:320, layout:{margin:{l:56,r:16,t:20,b:44}, showlegend:false, xaxis:{title:'Hour ending', type:'category'}, yaxis:{title:'$/MWh'}}, traces: hourData.map(d=>({
      type:'box', name:String(d.i+1), y:d.vals, marker:{color:'#3b82b6'}, line:{color:'#64748b'}
    }))});
  }

  // ---- Opportunity Visuals: migration (fixed 180 days) ----
  const oppRows = opportunityRows(filtered);
  if (oppRows.length) {
    const migLatest = oppRows[oppRows.length-1].date;
    const migCutoff = addDaysToIso(migLatest, -179);
    const migSel = oppRows.filter(r=>r.date>=migCutoff);
    const weekly = new Map();
    migSel.forEach(r=>{const d=new Date(r.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-d.getUTCDay());const k=d.toISOString().slice(0,10);if(!weekly.has(k))weekly.set(k,[]);weekly.get(k).push(r);});
    const median = a=>{const s=[...a].sort((x,y)=>x-y),n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
    const points = [...weekly].sort((a,b)=>a[0].localeCompare(b[0])).map(([week,rs])=>({week, amMedian: median(rs.map(r=>r.am.hour)), pmMedian: median(rs.map(r=>r.pm.hour))}));
    if (points.length) {
      specs.push({id:'visuals-migration', height:340, layout:{margin:{l:56,r:16,t:30,b:70}, yaxis:{title:'Peak hour (HE)'}, xaxis:{title:'Week beginning', tickangle:-45}}, traces:[
        {type:'scatter', mode:'lines+markers', name:'AM median', x:points.map(p=>p.week), y:points.map(p=>p.amMedian), line:{color:'#1479bd'}},
        {type:'scatter', mode:'lines+markers', name:'PM median', x:points.map(p=>p.week), y:points.map(p=>p.pmMedian), line:{color:'#e08724'}}
      ]});
    }
  }

  // ---- Negative Prices: by-hour + monthly trend ----
  const negByHour = negativeByHour(filtered);
  if (negByHour.some(h=>h.count>0)) {
    specs.push({id:'negative-byhour', height:300, layout:{margin:{l:56,r:16,t:20,b:44}, yaxis:{title:'Count'}, xaxis:{title:'Hour ending', dtick:1}}, traces:[{
      type:'bar', x:negByHour.map(h=>h.hour), y:negByHour.map(h=>h.count), marker:{color:'#e05d44'}
    }]});
  }
  const negAnalysis = negativePriceAnalysis(filtered);
  if (negAnalysis.monthly.length) {
    specs.push({id:'negative-trend', height:340, layout:{margin:{l:56,r:16,t:20,b:90}, yaxis:{title:'Events'}, xaxis:{title:'Month', tickangle:-45}}, traces:[{
      type:'bar', x:negAnalysis.monthly.map(m=>m.month), y:negAnalysis.monthly.map(m=>m.count), marker:{color:'#e05d44'}
    }]});
  }

  // ---- Explore: 6 charts ----
  const dailyAvg = dailyAverageSeries(filtered);
  if (dailyAvg.length) specs.push({id:'explore-daily-avg', height:340, layout:{margin:{l:56,r:16,t:20,b:90}, yaxis:{title:'$/MWh'}, xaxis:{title:'Date', type:'category', tickangle:-45}}, traces:[
    {type:'scatter', mode:'lines', name:'Daily', x:dailyAvg.map(d=>d.date), y:dailyAvg.map(d=>d.avg), line:{color:'#8899ee', width:1}},
    {type:'scatter', mode:'lines', name:'7-day mean', x:dailyAvg.map(d=>d.date), y:dailyAvg.map(d=>d.rollingAvg), line:{color:'#d6318e', width:2.5}}
  ]});

  const dailyVol = dailyVolatility(filtered);
  if (dailyVol.length) specs.push({id:'explore-volatility', height:340, layout:{margin:{l:56,r:16,t:20,b:90}, yaxis:{title:'Std dev'}, xaxis:{title:'Date', type:'category', tickangle:-45}}, traces:[
    {type:'scatter', mode:'lines', name:'Daily std', x:dailyVol.map(d=>d.date), y:dailyVol.map(d=>d.std), line:{color:'#f0c674', width:1}},
    {type:'scatter', mode:'lines', name:'7-day mean', x:dailyVol.map(d=>d.date), y:dailyVol.map(d=>d.rollingStd), line:{color:'#e05d44', width:2.5}}
  ]});

  const allPrices = allHourlyPrices(filtered);
  if (allPrices.length) specs.push({id:'explore-histogram', height:300, layout:{margin:{l:56,r:16,t:20,b:44}, xaxis:{title:'Price'}, yaxis:{title:'Frequency'}}, traces:[{
    type:'histogram', x:allPrices, marker:{color:'#5b8dee'}
  }]});

  const boxStats = monthlyBoxStats(filtered);
  if (boxStats.length) specs.push({id:'explore-monthly-box', height:340, layout:{margin:{l:56,r:16,t:20,b:70}, showlegend:false, xaxis:{title:'Month', type:'category', tickangle:-45}, yaxis:{title:'$/MWh'}}, traces:[{
    type:'box', x:boxStats.flatMap(d=>d.vals.map(()=>d.month)), y:boxStats.flatMap(d=>d.vals), marker:{color:'#5b8dee'}, boxpoints:false
  }]});

  const hourAvg = hourOfDayAverage(filtered).filter(d=>d.n>0);
  if (hourAvg.length) specs.push({id:'explore-hour-of-day', height:300, layout:{margin:{l:56,r:16,t:20,b:44}, xaxis:{title:'Hour ending', dtick:1}, yaxis:{title:'Avg $/MWh'}}, traces:[{
    type:'scatter', mode:'lines+markers', x:hourAvg.map(d=>d.hour), y:hourAvg.map(d=>d.avg), line:{color:'#5b8dee', width:2.5}
  }]});

  const heat = monthHourHeatmap(filtered);
  if (heat.months.length) specs.push({id:'explore-heatmap', height:Math.max(300, heat.months.length*16+80), layout:{margin:{l:70,r:16,t:20,b:44}, xaxis:{title:'Hour ending', dtick:1}, yaxis:{title:'Month'}}, traces:[{
    type:'heatmap', x:HE_COLS.slice(0,24).map((_,i)=>i+1), y:heat.months, z:heat.matrix, colorscale:'Viridis'
  }]});

  return specs;
}

// ---- Non-chart section builders ----
function buildFullReportSections(filtered) {
  const sections = [];
  const summary = datasetSummary(filtered);

  // Dataset overview + extremes (mirrors Ask q8, q9) — no chart needed, just the facts
  const extrema = filtered.flatMap(r=>HE_COLS.filter(h=>validPrice(r.hours[h])).map(h=>({date:r.key,hour:h,price:r.hours[h]})));
  const maxRec = extrema.length ? extrema.reduce((a,b)=>b.price>a.price?b:a) : null;
  const minRec = extrema.length ? extrema.reduce((a,b)=>b.price<a.price?b:a) : null;
  sections.push({id:'overview', label:'Dataset overview & extremes', group:'Summary',
    html:`<p>${summary.totalDays} days · ${summary.totalHours.toLocaleString()} hourly observations · overall avg ${formatPrice(summary.overallAvg)} · std dev ${formatPrice(summary.overallStd)}</p>
      <p>All-time high: <b>${maxRec?formatPrice(maxRec.price):'—'}</b> ${maxRec?('on '+maxRec.date+' at '+maxRec.hour):''} &nbsp;·&nbsp; All-time low: <b>${minRec?formatPrice(minRec.price):'—'}</b> ${minRec?('on '+minRec.date+' at '+minRec.hour):''}</p>`,
    chartIds: []
  });

  // Price ranking (mirrors Ask q1, q4)
  sections.push({id:'price-ranking', label:'Price ranking — month & day of week', group:'Summary',
    html:`<p>Highest-priced month: <b>${summary.monthRank[0]?.label||'—'}</b> (${formatPrice(summary.monthRank[0]?.avg)}). Highest-priced day of week: <b>${summary.dowRank[0]?.label||'—'}</b> (${formatPrice(summary.dowRank[0]?.avg)}).</p>`,
    chartIds: ['rank-month','rank-dow']
  });

  // AM vs PM (mirrors Ask q10)
  const peakRows = completePeakRows(filtered);
  const amAvg = peakRows.length ? average(peakRows.map(r=>r.am)) : null;
  const pmAvg = peakRows.length ? average(peakRows.map(r=>r.pm)) : null;
  sections.push({id:'am-vs-pm', label:'Does morning or evening tend to have higher prices?', group:'Summary',
    html: peakRows.length
      ? `<p><b>${pmAvg>=amAvg?'Evening':'Morning'}</b> tends to have higher peak prices — morning averages ${formatPrice(amAvg)}, evening averages ${formatPrice(pmAvg)}, based on ${peakRows.length} complete days.</p>`
      : `<p>Not enough complete AM/PM days in this period.</p>`,
    chartIds: ['am-vs-pm']
  });

  // Price Analysis (opportunity premiums)
  const peaks = peakAnalysis(filtered, 30);
  const opp = opportunity(filtered, 365, 10);
  sections.push({id:'price-analysis', label:'Price analysis — AM/PM opportunity', group:'Price Analysis',
    html:`<p>Morning peak avg: <b>${formatPrice(peaks.amAvg)}</b> · Evening peak avg: <b>${formatPrice(peaks.pmAvg)}</b></p>
      <p>Average AM peak premium: <b>${formatPrice(opp.avgAmPremium)}</b> · Average PM peak premium: <b>${formatPrice(opp.avgPmPremium)}</b></p>`,
    chartIds: []
  });

  // Seasonal
  const seasonal = seasonalSummary(filtered, 36);
  const holiday = holidayAnalysis(filtered, 36);
  sections.push({id:'seasonal', label:'Seasonal patterns', group:'Seasonal',
    html:`<table><thead><tr><th>Group</th><th>Days</th><th>AM</th><th>PM</th></tr></thead><tbody>
      <tr><td>Weekday</td><td>${seasonal.weekday.days}</td><td>${formatPrice(seasonal.weekday.am)}</td><td>${formatPrice(seasonal.weekday.pm)}</td></tr>
      <tr><td>Weekend</td><td>${seasonal.weekend.days}</td><td>${formatPrice(seasonal.weekend.am)}</td><td>${formatPrice(seasonal.weekend.pm)}</td></tr>
      </tbody></table>
      <table><thead><tr><th>Day type</th><th>Days</th><th>AM</th><th>PM</th></tr></thead><tbody>
      ${holiday.groups.map(g=>`<tr><td>${{weekday:'Ordinary weekday',weekend:'Ordinary weekend',actual:'Actual holiday',observed:'Observed holiday'}[g.key]}</td><td>${g.days}</td><td>${formatPrice(g.am)}</td><td>${formatPrice(g.pm)}</td></tr>`).join('')}
      </tbody></table>
      <p class="insight-note">Box plot: hourly price distribution over the most recent 365 calendar days in this period.</p>`,
    chartIds: ['seasonal-rolling','seasonal-boxplot']
  });

  // Opportunity Visuals
  sections.push({id:'visuals', label:'Opportunity visuals — peak-hour migration', group:'Opportunity Visuals',
    html:`<p>Weekly median AM/PM peak hour over the last 180 days of this period — shows whether the peak hour is drifting earlier or later.</p>`,
    chartIds: ['visuals-migration']
  });

  // Negative Prices
  const neg = negativePriceAnalysis(filtered);
  sections.push({id:'negative', label:'Negative price events', group:'Negative Prices',
    html: neg.totalEvents
      ? `<p>${neg.totalEvents} events across ${neg.daysWithNegative} days (${neg.pctNegative.toFixed(2)}%). Worst: ${formatPrice(neg.worstEvent?.price)} on ${neg.worstEvent?.date} at ${neg.worstEvent?.he}.</p>`
      : `<p>No negative-price hours in this period.</p>`,
    chartIds: ['negative-byhour','negative-trend']
  });

  // Explore
  sections.push({id:'explore', label:'Explore & dataset statistics', group:'Explore',
    html:`<p>${summary.totalDays} days · ${summary.totalHours.toLocaleString()} hourly observations · overall avg ${formatPrice(summary.overallAvg)} · std dev ${formatPrice(summary.overallStd)}</p>`,
    chartIds: ['explore-daily-avg','explore-volatility','explore-histogram','explore-monthly-box','explore-hour-of-day','explore-heatmap']
  });

  // Data Quality
  const audit = dayAudit(filtered);
  const complete = audit.checked - audit.missingDays.length - audit.incomplete.length;
  sections.push({id:'quality', label:'Data completeness', group:'Data Quality',
    html:`<p>${complete} of ${audit.checked} calendar days complete (${audit.checked?(complete/audit.checked*100).toFixed(1):'0'}%). ${audit.missingDays.length} missing entirely, ${audit.incomplete.length} partially incomplete.</p>`,
    chartIds: []
  });

  return sections;
}

function renderFullReportHtml(rangeLabel, sections, images) {
  const body = sections.map(sec => {
    const imgs = sec.chartIds.map(id => images[id]
      ? `<img src="${images[id]}" style="max-width:100%;border:1px solid #e1e8ef;border-radius:6px;margin:10px 0;"/>`
      : ''
    ).join('');
    return `<h2>${escapeHtml(sec.label)}</h2>${sec.html}${imgs}`;
  }).join('<hr/>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>MEAD Full Report — ${escapeHtml(rangeLabel)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:920px;margin:40px auto;padding:0 24px;color:#182b3c;line-height:1.6;}
  h1{font-size:26px;margin-bottom:4px;} h2{font-size:19px;margin-top:32px;color:#14695d;border-bottom:2px solid #e1e8ef;padding-bottom:6px;}
  table{border-collapse:collapse;width:100%;margin:12px 0 20px;font-size:13px;} th,td{border:1px solid #dce4ed;padding:7px 10px;text-align:left;} th{background:#f7fafc;}
  hr{border:none;border-top:1px solid #e1e8ef;margin:28px 0;}
  .insight-note{font-size:12px;color:#8da0b3;font-style:italic;}
  @media print{body{margin:0;max-width:none;} h2{page-break-after:avoid;} img{page-break-inside:avoid;}}
</style></head><body>
<h1>MEAD Day-Ahead Price Report — Full</h1>
<div style="color:#526578;font-size:13px;margin-bottom:28px;"><b>Period:</b> ${escapeHtml(rangeLabel)} &nbsp;·&nbsp; <b>Generated:</b> ${escapeHtml(new Date().toLocaleString())}</div>
${body}
<div style="margin-top:36px;font-size:11px;color:#8da0b3;font-style:italic;">This report reflects historical CAISO day-ahead price data only. It does not account for water availability, reservoir elevation, environmental flow requirements, ramp limits, or unit availability.</div>
</body></html>`;
}

// ---- Full report generation panel ----
function FullReportPanel({records}) {
  const years = useMemo(() => [...new Set(records.map(r=>r.key.slice(0,4)))].sort((a,b)=>b-a), [records]);
  const [periodMode, setPeriodMode] = useState('all');
  const [periodYear, setPeriodYear] = useState(() => years[0] || new Date().getFullYear());
  const [fiscalStartYear, setFiscalStartYear] = useState(() => Number(years[0] || new Date().getFullYear()) - 1);
  const [customStart, setCustomStart] = useState(() => records.length ? [...records].sort((a,b)=>a.key.localeCompare(b.key))[0].key : '');
  const [customEnd, setCustomEnd] = useState(() => records.length ? [...records].sort((a,b)=>b.key.localeCompare(a.key))[0].key : '');

  const [generating, setGenerating] = useState(false);
  const [chartSpecs, setChartSpecs] = useState(null);
  const [captured, setCaptured] = useState({});
  const [resultHtml, setResultHtml] = useState(null);
  const [rangeLabel, setRangeLabel] = useState('');
  const pendingSectionsRef = useRef(null);
  const pendingRangeRef = useRef(null);

  const period = useMemo(() => {
    if (periodMode === 'all') return { mode: 'all' };
    if (periodMode === 'year') return { mode: 'year', year: periodYear };
    if (periodMode === 'fiscal') return { mode: 'fiscal', startYear: fiscalStartYear };
    if (periodMode === 'custom') return { mode: 'custom', start: customStart, end: customEnd };
    return { mode: 'all' };
  }, [periodMode, periodYear, fiscalStartYear, customStart, customEnd]);

  const startGenerate = () => {
    const { records: filtered, range } = filterRecordsForReport(records, period);
    if (!range || !filtered.length) {
      setResultHtml('<p>No data available for the selected period.</p>');
      return;
    }
    setGenerating(true);
    setCaptured({});
    setResultHtml(null);
    const specs = buildFullReportChartSpecs(filtered);
    const sections = buildFullReportSections(filtered);
    pendingSectionsRef.current = sections;
    pendingRangeRef.current = range.label;
    if (!specs.length) {
      const html = renderFullReportHtml(range.label, sections, {});
      setResultHtml(html);
      setRangeLabel(range.label);
      setGenerating(false);
      return;
    }
    setChartSpecs(specs);
  };

  const onChartCaptured = (id, url) => {
    setCaptured(prev => {
      const next = {...prev, [id]: url};
      if (chartSpecs && Object.keys(next).length >= chartSpecs.length) {
        const html = renderFullReportHtml(pendingRangeRef.current, pendingSectionsRef.current, next);
        setResultHtml(html);
        setRangeLabel(pendingRangeRef.current);
        setGenerating(false);
        setChartSpecs(null);
      }
      return next;
    });
  };

  const exportHtml = () => {
    if (!resultHtml) return;
    const filename = 'mead-full-report-' + (rangeLabel||'report').replace(/[^a-z0-9]+/gi,'-').toLowerCase() + '.html';
    downloadTextFile(filename, resultHtml, 'text/html');
  };

  const doneCount = Object.keys(captured).length;
  const totalCount = chartSpecs ? chartSpecs.length : 0;

  if (!records.length) return <div className="card"><div className="empty">No data yet.</div></div>;

  return <div>
    <div className="card">
      <h2>Full report (selected analyses with charts)</h2>
      <p>Includes selected day-ahead price analyses, tables, and charts for the chosen period. HTML export only (use your browser's print dialog to save as PDF). Seasonal patterns and descriptive statistics are recomputed for the selected period rather than copied from the live tabs.</p>
      <h3>Period</h3>
      <div className="row">
        <label><select value={periodMode} onChange={e=>setPeriodMode(e.target.value)} disabled={generating}>
          <option value="all">All available data</option>
          <option value="year">Specific calendar year</option>
          <option value="fiscal">Fiscal year (Oct–Sep)</option>
          <option value="custom">Custom date range</option>
        </select></label>
        {periodMode==='year' && <label>Year <select value={periodYear} onChange={e=>setPeriodYear(e.target.value)} disabled={generating}>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></label>}
        {periodMode==='fiscal' && <label>Fiscal year <select value={fiscalStartYear} onChange={e=>setFiscalStartYear(Number(e.target.value))} disabled={generating}>{years.map(y=><option key={y} value={Number(y)-1}>FY{y} (Oct {Number(y)-1} – Sep {y})</option>)}</select></label>}
        {periodMode==='custom' && <>
          <label>From <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)} disabled={generating}/></label>
          <label>To <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)} disabled={generating}/></label>
        </>}
      </div>
      <div className="row" style={{marginTop:16}}>
        <button onClick={startGenerate} disabled={generating}>{generating ? 'Generating...' : 'Generate full report'}</button>
      </div>
      {generating && <div style={{marginTop:12}}>
        <p style={{fontSize:13, color:'#8da0b3'}}>Rendering charts: {doneCount} of {totalCount}</p>
        <div style={{background:'#e1e8ef', borderRadius:6, height:8, overflow:'hidden'}}>
          <div style={{background:'#35c4ae', height:'100%', width:(totalCount?doneCount/totalCount*100:0)+'%', transition:'width 0.2s'}}/>
        </div>
      </div>}
    </div>

    {chartSpecs && <div style={{position:'absolute', left:'-9999px', top:0}}>
      {chartSpecs.map(spec => (
        <CaptureChart key={spec.id} id={spec.id} traces={spec.traces} layout={spec.layout} height={spec.height} onCaptured={onChartCaptured}/>
      ))}
    </div>}

    {resultHtml && <div className="card">
      <div className="row" style={{justifyContent:'space-between'}}>
        <h3 style={{margin:0}}>Preview — {rangeLabel}</h3>
        <button onClick={exportHtml}>↓ Download HTML (print to PDF)</button>
      </div>
      <div className="scroll" style={{maxHeight:500, marginTop:12, border:'1px solid #e1e8ef', borderRadius:8}}>
        <iframe srcDoc={resultHtml} style={{width:'100%', height:500, border:'none'}} title="Full report preview"/>
      </div>
    </div>}
  </div>;
}


// ===== app shell =====
// app.jsx — the App shell: state, tabs, effects, and the full render tree.
// Bundled app shell follows its analysis, chart, and report definitions.



function PeriodPicker({records, period, onChange}) {
  const years = useMemo(()=>[...new Set(records.map(r=>r.key.slice(0,4)))].sort((a,b)=>b-a), [records]);
  const mode = period ? period.mode : 'all';
  return <div className="row">
    <label>View <select value={mode} onChange={e=>{
      const m=e.target.value;
      if(m==='all') onChange({mode:'all'});
      else if(m==='year') onChange({mode:'year', year:Number(years[0]||new Date().getFullYear())});
      else if(m==='month') onChange({mode:'month', month:1});
      else if(m==='range') onChange({mode:'range', start:records.length?records[0].key:'', end:records.length?records[records.length-1].key:''});
    }}>
      <option value="all">All data</option>
      <option value="year">Specific year</option>
      <option value="month">Specific month (all years)</option>
      <option value="range">Custom date range</option>
    </select></label>
    {mode==='year' && <label>Year <select value={period.year} onChange={e=>onChange({mode:'year', year:Number(e.target.value)})}>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></label>}
    {mode==='month' && <label>Month <select value={period.month} onChange={e=>onChange({mode:'month', month:Number(e.target.value)})}>{MONTH_ABBR.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></label>}
    {mode==='range' && <>
      <label>From <input type="date" value={period.start} onChange={e=>onChange({...period, start:e.target.value})}/></label>
      <label>To <input type="date" value={period.end} onChange={e=>onChange({...period, end:e.target.value})}/></label>
    </>}
  </div>;
}


function App() {
  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState('dashboard');
  const [msg, setMsg] = useState(null);
  const [selectedDates, setSelectedDates] = useState([]);
  const [spikeThreshold, setSpikeThreshold] = useState(100);
  const [expandedRow, setExpandedRow] = useState(null);
  const [trendWindow, setTrendWindow] = useState(30);
  const [amPremium, setAmPremium] = useState(10);
  const [seasonMonths, setSeasonMonths] = useState(12);
  const [matrixDate, setMatrixDate] = useState('');
  const [theme,setTheme]=useState('light');
  const [detail,setDetail]=useState(null);
  const [selectedMonth,setSelectedMonth]=useState(null);
  const [boxPeriod,setBoxPeriod]=useState('7');
  const [opMonth,setOpMonth]=useState(6);
  const [selectedCalendarDay,setSelectedCalendarDay]=useState(null);
  const [selectedWeek,setSelectedWeek]=useState(null);
  const [focusHour,setFocusHour]=useState(null);
  const [overviewDays,setOverviewDays]=useState(14);
  const [highValueDays,setHighValueDays]=useState(14);
  const [probThreshold,setProbThreshold]=useState(75);
  const [probDays,setProbDays]=useState(30);
  const [migrationDays,setMigrationDays]=useState(180);
  const [rollingWindow,setRollingWindow]=useState(30);
  const [regimeK,setRegimeK]=useState(5);
  const [selectedRegime,setSelectedRegime]=useState(null);
  const [showElbow,setShowElbow]=useState(false);
  const [spikePercentiles]=useState([50,75,90,95,99]);
  const [regimePeriod,setRegimePeriod]=useState({mode:'all'});
  const [explorePeriod,setExplorePeriod]=useState({mode:'all'});

  const recordsMap = useMemo(function() {
    const m = {};
    records.forEach(function(r) { m[r.key] = r; });
    return m;
  }, [records]);

  const dayShape = useMemo(() => latestDayShape(records), [records]);
  const seasonalCtx = useMemo(() => seasonalContext(records), [records]);
  const signals = useMemo(() => actionSignals(dayShape, seasonalCtx), [dayShape, seasonalCtx]);

  useEffect(function() {
    let cancelled = false;
    (async function() {
      try {
        const response = await fetch('./data/days.json', {cache:'no-store'});
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const payload = await response.json();
        if (!payload || !Array.isArray(payload.records)) throw new Error('Unexpected price-data format');
        if (!cancelled) setRecords(payload.records);
      } catch (e) {
        if (!cancelled) setMsg({type:'err', text:'Unable to load published price data: ' + e.message});
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return function() { cancelled = true; };
  }, []);

  const sortedList = useMemo(function() {
    const copy = records.slice();
    copy.sort(function(a,b) { return b.key.localeCompare(a.key); });
    return copy;
  }, [records]);

  const globalStats = useMemo(function() {
    const all = records.map(function(r) { return computeStats(r.hours); }).filter(Boolean);
    const extrema=records.flatMap(r=>HE_COLS.filter(h=>validPrice(r.hours[h])).map(h=>({date:r.key,hour:h,price:r.hours[h]})));
    const maxRecord=extrema.reduce((a,b)=>!a||b.price>a.price?b:a,null);
    const minRecord=extrema.reduce((a,b)=>!a||b.price<a.price?b:a,null);
    if (all.length === 0) return null;
    return {
      avgAll: all.reduce(function(a,b) { return a+b.avg; }, 0) / all.length,
      maxAll: maxRecord.price, maxRecord,
      minAll: minRecord.price, minRecord,
      days: all.length
    };
  }, [records]);

  const spikeDays = useMemo(function() {
    return records.filter(function(r) {
      return HE_COLS.some(function(h) {
        const v = r.hours[h];
        return v !== null && v !== undefined && v > spikeThreshold;
      });
    }).map(function(r) { return r.key; });
  }, [records, spikeThreshold]);

  const opportunityData = useMemo(()=>opportunityRows(records),[records]);
  const availableMonths = useMemo(()=>[...new Set(records.map(r=>r.key.slice(0,7)))].sort(),[records]);
  const seasonal = useMemo(()=>seasonalSummary(records,seasonMonths),[records,seasonMonths]);
  const trends = useMemo(()=>trendInsights(records,seasonMonths),[records,seasonMonths]);
  const holidayStats = useMemo(()=>holidayAnalysis(records,seasonMonths),[records,seasonMonths]);
  const rolling = useMemo(()=>rollingAnalysis(records,rollingWindow),[records,rollingWindow]);
  const yoy = useMemo(()=>yearMonthSeries(records),[records]);
  const matrixRecord = useMemo(()=>records.find(r=>r.key===matrixDate)||[...records].sort((a,b)=>b.key.localeCompare(a.key))[0]||null,[records,matrixDate]);
  const audit = useMemo(()=>dayAudit(records),[records]);
  const peaks = useMemo(()=>peakAnalysis(records,trendWindow),[records,trendWindow]);
  const outlook = useMemo(()=>tomorrowOutlook(records),[records]);
  const opp = useMemo(()=>opportunity(records,trendWindow,amPremium),[records,trendWindow,amPremium]);
  const releaseDays = useMemo(()=>[...records].sort((a,b)=>b.key.localeCompare(a.key)),[records]);
  const regimeFiltered = useMemo(()=>filterByPeriod(records,regimePeriod),[records,regimePeriod]);
  const regimeResult = useMemo(()=>runRegimeDetection(regimeFiltered,regimeK),[regimeFiltered,regimeK]);
  const elbow = useMemo(()=>showElbow?elbowSeries(regimeFiltered,9):[],[regimeFiltered,showElbow]);
  const seasonCurves = useMemo(()=>{
    const palette={winter:'#65b8fa',spring:'#8de39c',summer:'#f2b56d',fall:'#e38da8'};
    return SEASON_DEFS.map(s=>{
      const hours=seasonHours(regimeFiltered,s.months);
      const pd=priceDurationAnalysis(hours,spikePercentiles);
      return pd?{name:s.label,key:s.key,color:palette[s.key],points:pd.curve,stats:pd}:null;
    }).filter(Boolean);
  },[regimeFiltered,spikePercentiles]);
  const exploreFiltered = useMemo(()=>filterByPeriod(records,explorePeriod),[records,explorePeriod]);

  // ============================================================ 
  // RIVERWARE 8-DAY CLIPBOARD COPY
  // Add this function near your other handler functions in app.jsx,
  // and add the button in the History tab JSX (see instructions below).
  // ============================================================

  // Copies the latest stored operating day's HE01-HE24 prices, repeated across 8 rows,
  // directly to the clipboard as tab-separated values — pastes straight into RiverWare
  // (or Excel) as a proper 8-row x 24-column grid, no intermediate file needed.
  // Each row is currently identical (today's actual prices as the "extend current trend"
  // assumption); rows can later be made day-specific without changing this copy mechanism.
  async function copyRiverWareTemplate(records, setMsg) {
    if (!records.length) {
      if (setMsg) setMsg({type:'err', text:'No data to copy.'});
      return;
    }
    const sorted = [...records].sort((a,b) => b.key.localeCompare(a.key));
    const latest = sorted[0];

    const headers = HE_COLS.slice(0, 24); // HE01..HE24, no HE25
    const rowValues = headers.map(h => {
      const v = latest.hours[h];
      return (v !== null && v !== undefined && !isNaN(v)) ? v : '';
    });

    // Tab-separated, one row per line — this is the format spreadsheet/grid apps
    // recognize as a multi-cell paste (same as copying a range in Excel).
    const rows = [];
    for (let i = 0; i < 8; i++) {
      rows.push(rowValues.join('\t'));
    }
    const clipboardText = rows.join('\n');

    try {
      await navigator.clipboard.writeText(clipboardText);
      if (setMsg) setMsg({type:'ok', text:'Copied 8 rows × 24 hours (based on '+latest.key+') to clipboard — paste directly into RiverWare.'});
    } catch (e) {
      if (setMsg) setMsg({type:'err', text:'Clipboard copy failed: '+e.message});
    }
  }

  // ============================================================

  // ============================================================
// RIVERWARE REALISTIC 8-DAY CLIPBOARD COPY
// Add this function near copyRiverWareTemplate in app.jsx,
// and add a second button in the History tab JSX (see below).
//
// Depends on: holidayLabel, average, validPrice, HE_COLS (all already
// available from parsing.jsx / analysis-core.jsx).
// ============================================================

// For a given calendar date, returns the historical average hourly shape (HE01-HE24)
// to use as that date's baseline: holiday-average if the date is a recognized holiday,
// otherwise same-weekday average across all stored history.
function baselineShapeForDate(records, dateStr) {
  const holiday = holidayLabel(dateStr);
  const targetDow = new Date(dateStr + 'T12:00:00Z').getUTCDay();

  let matching;
  if (holiday) {
    // Match against all other days carrying the same holiday classification (actual or observed),
    // not just this specific holiday name, since a single named holiday may have very few
    // historical occurrences — broadening to "any actual/observed holiday" gives a usable sample.
    matching = records.filter(r => {
      const h = holidayLabel(r.key);
      return h && h.kind === holiday.kind;
    });
  } else {
    matching = records.filter(r => {
      if (holidayLabel(r.key)) return false; // exclude holidays from ordinary-weekday baseline
      return new Date(r.key + 'T12:00:00Z').getUTCDay() === targetDow;
    });
  }

  const shape = HE_COLS.slice(0, 24).map(h => {
    const vals = matching.map(r => r.hours[h]).filter(validPrice);
    return vals.length ? average(vals) : null;
  });

  return { shape, matchCount: matching.length, isHoliday: !!holiday, holidayName: holiday ? holiday.name : null };
}

// Copies a more realistic 8-day forward price assumption to the clipboard:
// each of the next 8 calendar days uses its own holiday-aware or day-of-week-aware
// historical average shape, then the whole set is scaled by a single flat ratio
// reflecting how today's actual average price compares to today's own historical
// baseline — so if today is running hot or cold vs. typical, the 8-day outlook
// shifts proportionally rather than just repeating today's raw numbers.
  
  async function copyRiverWareRealistic(records, setMsg) {
    if (!records.length) {
      if (setMsg) setMsg({type:'err', text:'No data to copy.'});
      return;
    }
    const sorted = [...records].sort((a,b) => b.key.localeCompare(a.key));
    const latest = sorted[0];

    // Step 1: today's own baseline and today's actual average, to compute the flat adjustment ratio.
    const todayBaseline = baselineShapeForDate(records, latest.key);
    const todayBaselineAvg = average(todayBaseline.shape.filter(v => v !== null));
    const todayActualVals = HE_COLS.slice(0,24).map(h => latest.hours[h]).filter(validPrice);
    const todayActualAvg = todayActualVals.length ? average(todayActualVals) : null;

    let ratio = 1;
    if (todayActualAvg !== null && todayBaselineAvg !== null && todayBaselineAvg !== 0) {
      ratio = todayActualAvg / todayBaselineAvg;
    }

    // Row 1: today's actual values, verbatim — no scaling, no substitution.
    const todayRow = HE_COLS.slice(0,24).map(h => {
      const v = latest.hours[h];
      return (v !== null && v !== undefined && !isNaN(v)) ? v : '';
    });
    const rows = [todayRow.join('\t')];
    const dayNotes = [latest.key + ' (actual, unchanged)'];

    // Rows 2-8: next 7 calendar days, each scaled by the same flat ratio.
    for (let i = 1; i <= 7; i++) {
      const futureDate = addDaysToIso(latest.key, i);
      const { shape, matchCount, isHoliday, holidayName } = baselineShapeForDate(records, futureDate);
      const scaled = shape.map(v => (v === null ? '' : (v * ratio).toFixed(2)));
      rows.push(scaled.join('\t'));
      dayNotes.push(futureDate + (isHoliday ? ' ('+holidayName+', '+matchCount+' matches)' : ' ('+matchCount+' matches)'));
    }

    const clipboardText = rows.join('\n');

    try {
      await navigator.clipboard.writeText(clipboardText);
      const pct = ((ratio - 1) * 100).toFixed(1);
      const dir = ratio >= 1 ? '+' : '';
      if (setMsg) setMsg({
        type: 'ok',
        text: `Copied 8 rows × 24 hours (row 1 = today's actual prices, rows 2-8 = realistic forecast). Adjustment applied to forecast rows: ${dir}${pct}% vs typical. Days: ${dayNotes.join('; ')}`
      });
    } catch (e) {
      if (setMsg) setMsg({type:'err', text:'Clipboard copy failed: '+e.message});
    }
  }

  const exportCSV = function() {
    const rows = ['Date,' + HE_COLS.join(',')];
    const sorted = records.slice().sort(function(a,b) { return a.key.localeCompare(b.key); });
    sorted.forEach(function(r) {
      const vals = HE_COLS.map(function(h) { return r.hours[h] !== null && r.hours[h] !== undefined ? r.hours[h] : ''; });
      rows.push(r.date + ',' + vals.join(','));
    });
    const blob = new Blob([rows.join('\n')], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mead_da_price_history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!loaded) {
    return <div className="app"><p>Loading...</p></div>;
  }

  let heatMin = 0;
  let heatMax = 1;
  if (records.length > 0) {
    const allVals = [];
    records.forEach(function(r) {
      HE_COLS.forEach(function(h) {
        const v = r.hours[h];
        if (v !== null && v !== undefined) allVals.push(v);
      });
    });
    if (allVals.length > 0) {
      heatMin = Math.min.apply(null, allVals);
      heatMax = Math.max.apply(null, allVals);
    }
  }

  const latest = sortedList[0];
  const latestStats = latest ? computeStats(latest.hours) : null;
  const outlookTop=outlook?outlook.prices.filter(x=>validPrice(x.price)).map(x=>({he:Number(x.hour.slice(2)),price:x.price})).sort((a,b)=>b.price-a.price).slice(0,5):[];
  const chartDays = sortedList.slice(0, overviewDays).reverse();
  const highRecords=sortedList.slice(0,highValueDays);
  const peakHours=HE_COLS.slice(0,24).map(h=>({hour:h,price:average(highRecords.map(r=>r.hours[h]).filter(validPrice))})).filter(x=>validPrice(x.price)).sort((a,b)=>b.price-a.price).slice(0,5);
  const currentRows=completePeakRows(sortedList.slice(0,14));
  const priorRows=completePeakRows(sortedList.slice(14,28));
  const recentAm=average(currentRows.map(r=>r.am)),recentPm=average(currentRows.map(r=>r.pm)),priorAm=average(priorRows.map(r=>r.am)),priorPm=average(priorRows.map(r=>r.pm));
  return (
    <div className={"app shell theme-"+theme}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-icon">≋</div><div><strong>HOOVER<span> / </span>MEAD</strong><small>ENERGY INTELLIGENCE</small></div></div>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav">
          {[['dashboard','◫','Overview'],['ask','💬','Ask'],['import','↓','Download prices'],['history','▤','Historical data'],['analysis','⌁','Price analysis'],['heatmap','▦','Daily price map'],['seasonal','▥','Seasonal trends'],['visuals','▧','Opportunity visuals'],['negative','⚠','Negative prices'],['explore','✦','Explore & stats'],['quality','✓','Data quality'],['report','📄','Report']].map(function(item){return <button key={item[0]} className={'nav-item'+(tab===item[0]?' selected':'')} onClick={function(){setTab(item[0]);}}><span className="nav-symbol">{item[1]}</span>{item[2]}</button>;})}
        </nav>
        <div className="sidebar-bottom"><div className="node-pill"><span className="live-dot"></span> CAISO · MEADS_2_N101</div></div>
      </aside>
      <main className="main-panel" onClickCapture={e=>{const chart=e.target.closest('.chart-panel,.chart-card');if(chart&&!e.target.closest('button,select,input,[data-no-expand],.js-plotly-plot')){setDetail({title:chart.querySelector('strong,h3')?.textContent||'Price chart',chart:chart.querySelector('svg')?.outerHTML||null,body:'Values are calculated from stored MEAD hourly prices. Hover over chart elements for additional values.'});}}}>
      <header className="topbar"><div><div className="eyebrow">HOOVER DAM / LAKE MEAD</div><h1>{({dashboard:'Energy price overview',ask:'Ask',import:'Download CAISO prices',history:'Historical price library',analysis:'Market price analysis',heatmap:'One-day price map',seasonal:'Seasonal trends',visuals:'Opportunity visualizations',regimes:'Regime detection & tail risk',negative:'Negative price tracker',explore:'Explore & dataset statistics',quality:'Database completeness',report:'Generate report'})[tab]}</h1><div className="sub">Day-ahead locational marginal prices · Pacific operating time</div></div><div className="top-actions"><span className="data-count">{records.length.toLocaleString()} days stored{records.length?` · ${sortedList[sortedList.length-1].key} to ${sortedList[0].key}`:''}</span><button className="theme-switch" onClick={()=>setTheme(theme==='light'?'dark':'light')}>{theme==='light'?'☾ Dark mode':'☀ Light mode'}</button><button onClick={function(){setTab('import');}}>↓ Download data</button></div></header>
      
      {tab === 'dashboard' && <section className="dashboard">
        <div className="section-heading">
          <div>
            <h2>Operating snapshot</h2>
            <p>{dayShape ? 'Latest available operating day: '+dayShape.key+' · prices are historical actuals, not a forecast. Overlay your own water, elevation, flow and unit constraints.' : 'No published daily price records are available'}</p>
          </div>
          <span className="source-tag">SOURCE · CAISO DAY-AHEAD</span>
        </div>

        <div className="kpi-grid">
          <div className="kpi interactive" onClick={()=>setDetail({title:"Morning peak window",body:"The contiguous block of highest-priced hours within HE01-12 (within 85% of that half's maximum) for the latest stored operating day. If your release timing is flexible, concentrating generation here captures the most value within the morning — subject to your operational constraints."})}>
            <span>AM peak window — latest day</span>
            <strong style={{fontSize:23}}>{(() => { const pw = dayShape&&dayShape.peakWindows?dayShape.peakWindows.find(p=>p.from<=12):null; return pw ? ('HE'+String(pw.from).padStart(2,'0')+'–HE'+String(pw.to).padStart(2,'0')) : '—'; })()}</strong>
            <small>{(() => { const pw = dayShape&&dayShape.peakWindows?dayShape.peakWindows.find(p=>p.from<=12):null; return pw ? ('up to '+formatPrice(pw.maxPrice)+' · '+dayShape.key) : 'No morning peak detected'; })()}</small>
          </div>
          <div className="kpi interactive" onClick={()=>setDetail({title:"Evening peak window",body:"The contiguous block of highest-priced hours within HE13-24 (within 85% of that half's maximum) for the latest stored operating day. This is typically the richer window for hydro — hold water for these hours if timing is flexible, subject to your operational constraints."})}>
            <span>PM peak window — latest day</span>
            <strong style={{fontSize:23}}>{(() => { const pw = dayShape&&dayShape.peakWindows?dayShape.peakWindows.find(p=>p.from>=13):null; return pw ? ('HE'+String(pw.from).padStart(2,'0')+'–HE'+String(pw.to).padStart(2,'0')) : '—'; })()}</strong>
            <small>{(() => { const pw = dayShape&&dayShape.peakWindows?dayShape.peakWindows.find(p=>p.from>=13):null; return pw ? ('up to '+formatPrice(pw.maxPrice)+' · '+dayShape.key) : 'No evening peak detected'; })()}</small>
          </div>
          <div className="kpi interactive" onClick={()=>setDetail({title:"Recent prices vs seasonal norm, AM & PM",body:"Average of each day's AM peak (HE01-12 max) and PM peak (HE13-24 max) over the latest 7 stored days, compared against the same calendar month's AM/PM peaks in prior years. A positive figure means that window is running richer than typical — useful for deciding whether to favor morning or evening generation right now."})}>
            <span>Recent vs {seasonalCtx?seasonalCtx.latestMonth:'season'} norm</span>
            <div style={{display:'flex', gap:18, marginTop:4}}>
              <div>
                <div style={{fontSize:10, color:'#8da0b3', textTransform:'uppercase', letterSpacing:0.4}}>AM</div>
                <strong style={{fontSize:20, color: seasonalCtx&&seasonalCtx.am.pct!==null&&seasonalCtx.am.pct>=0?'#2fb98a':'#e05d44'}}>{seasonalCtx&&seasonalCtx.am.pct!==null?(seasonalCtx.am.pct>=0?'+':'')+seasonalCtx.am.pct.toFixed(0)+'%':'—'}</strong>
              </div>
              <div>
                <div style={{fontSize:10, color:'#8da0b3', textTransform:'uppercase', letterSpacing:0.4}}>PM</div>
                <strong style={{fontSize:20, color: seasonalCtx&&seasonalCtx.pm.pct!==null&&seasonalCtx.pm.pct>=0?'#2fb98a':'#e05d44'}}>{seasonalCtx&&seasonalCtx.pm.pct!==null?(seasonalCtx.pm.pct>=0?'+':'')+seasonalCtx.pm.pct.toFixed(0)+'%':'—'}</strong>
              </div>
            </div>
            <small>{seasonalCtx&&seasonalCtx.am.recent!==null?('AM '+formatPrice(seasonalCtx.am.recent)+' vs '+formatPrice(seasonalCtx.am.norm)+' typical'):'Need prior-year data'}</small>
          </div>
          <div className="kpi interactive" onClick={()=>setDetail({title:"Latest intraday spread — what it means operationally",body:"Highest minus lowest hourly price on the latest stored operating day. This is a quick 'is today worth shaping around?' check: a wide spread means concentrating output into the best hour(s) is worth real money per MWh shifted, assuming water and ramp constraints allow it. A narrow spread means flat, steady operation captures nearly the same value as careful timing — not worth the operational complexity of shaping around price alone that day. It is not a revenue figure by itself; multiplying the spread by your actual flexible MWh gives an estimate of the dollar upside from shaping release timing versus running flat."})}>
            <span>Latest intraday spread</span>
            <strong>{dayShape&&dayShape.stats?formatPrice(dayShape.stats.max-dayShape.stats.min):'—'}</strong>
            <small>{dayShape&&dayShape.stats?'Value of shaping release timing — click for detail':'No prices loaded'}</small>
          </div>
          <div className="kpi interactive" onClick={()=>setDetail({title:"Negative-price hours (latest day)",body:"Count of hours on the latest stored day where the price fell below $0/MWh — hours when generating has a direct cost. A curtailable resource should minimize or defer output in these hours if operationally possible."})}>
            <span>Negative hours (latest day)</span>
            <strong style={{color: dayShape&&dayShape.negativeHours.length?'#e05d44':'#2fb98a'}}>{dayShape?dayShape.negativeHours.length:'—'}</strong>
            <small>{dayShape&&dayShape.negativeHours.length?dayShape.negativeHours.map(h=>'HE'+String(h).padStart(2,'0')).join(', '):'None on latest day'}</small>
          </div>
        </div>

        <div className="card chart-card">
          <div className="panel-heading">
            <div><h3>Latest operating-day price shape — {dayShape?dayShape.key:'—'}</h3><p>Hourly day-ahead LMP. Green = peak window · red = negative-price hours · teal = other hours.</p></div>
          </div>
          <LatestDayCurve shape={dayShape}/>
          <p className="insight-note">This is the most recent actual operating day in your database — effectively the next-day shape when freshly downloaded via your afternoon CAISO pull. It is historical/published data, not a prediction of a future day.</p>
        </div>

        {signals.length > 0 && <div className="card" style={{background:'linear-gradient(155deg,#102a37,#0f2430)'}}>
          <h3 style={{marginTop:0}}>Today's action signals</h3>
          {signals.map((s,i) => {
            const bg = s.tone==='opportunity'?'#13332a':s.tone==='caution'?'#351d16':'#1b2730';
            const fg = s.tone==='opportunity'?'#6ee7a0':s.tone==='caution'?'#f2a98f':'#9fb2c0';
            return <div key={i} style={{display:'flex', gap:12, alignItems:'flex-start', background:bg, borderRadius:9, padding:'11px 14px', marginBottom:8}}>
              <span style={{color:fg, fontSize:15, fontWeight:700, lineHeight:1.3}}>{s.icon}</span>
              <span style={{fontSize:13, color:'#dbe7ee', lineHeight:1.5}}>{s.text}</span>
            </div>;
          })}
          <p className="insight-note" style={{marginTop:6}}>Signals are derived from the latest stored operating day's price shape and recent-vs-seasonal comparison. They describe price opportunity only — not generation instructions. Water availability, reservoir elevation, downstream/environmental flow requirements, ramp limits and unit availability all override these signals.</p>
        </div>}

        <div className="dashboard-grid">
          <div className="card chart-card">
            <div className="panel-heading"><div><h3>Recent daily average prices</h3><p>Recent stored operating days</p></div><label>Period <select value={overviewDays} onChange={e=>setOverviewDays(Number(e.target.value))}>{[7,14,30,60,90].map(n=><option key={n} value={n}>Last {n} days</option>)}</select></label></div>
            {chartDays.length?<DailyBarChart days={chartDays}/>:<div className="empty">No historical prices yet. Download CAISO data to see price trends.</div>}
          </div>
          <div className="card insight-card">
            <div className="panel-heading"><div><h3>Best hours — latest day</h3><p>Highest-priced hours on {dayShape?dayShape.key:'—'}, ranked</p></div></div>
            {dayShape&&dayShape.valid.length?[...dayShape.valid].sort((a,b)=>b.price-a.price).slice(0,5).map((item,i)=>{
              const top=[...dayShape.valid].sort((a,b)=>b.price-a.price)[0].price;
              return <div className="rank-row" key={item.he}><span className="rank">{String(i+1).padStart(2,'0')}</span><strong>HE{String(item.he).padStart(2,'0')}</strong><div className="rank-bar"><i style={{width:(Math.max(0,item.price)/Math.max(1,top)*100)+'%'}}></i></div><b>{formatPrice(item.price)}</b></div>;
            }):<div className="empty">No hourly prices available.</div>}
            <div className="insight-note">The specific best-paying hours on the latest operating day — your primary release-timing target, subject to operating constraints.</div>
          </div>
        </div>

        <div className="card action-card"><div><h3>Dig deeper</h3><p>Seasonal patterns, volatility, regime detection, negative-price history and one-click answers are all available in the workspace.</p></div><div className="action-buttons"><button className="ghost" onClick={function(){setTab('ask');}}>Ask a question →</button><button onClick={function(){setTab('analysis');}}>Open analysis →</button></div></div>
      </section>}
      
      {msg && <div className={'msg ' + msg.type}>{msg.text}</div>}
     
      {tab === 'import' && (
        <div className="card">
          <h2>Update CAISO day-ahead prices</h2>
          <p>Scheduled downloads update the published price data automatically. Repository users with appropriate access can request a manual date-range download in GitHub Actions.</p>
          <p>Open the workflow, choose <b>Run workflow</b>, and provide both dates or leave both blank for the rolling eight-date window. After the update and deployment finish, reload this website.</p>
          {window.MEAD_ACTIONS_URL
            ? <a className="button-link" href={window.MEAD_ACTIONS_URL} target="_blank" rel="noopener noreferrer">Open price-update workflow</a>
            : <p className="insight-note">Open your repository's Actions tab and select Update CAISO prices.</p>}
          <p className="insight-note">This public website is read-only and contains no repository write credentials.</p>
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <div className="row" style={{justifyContent:'space-between'}}>
            <span style={{fontSize:13, color:'#8b8f9a'}}>{sortedList.length} record(s)</span>
            <button className="ghost" onClick={exportCSV} disabled={sortedList.length===0}>Export CSV</button>
            <button className="ghost" onClick={()=>copyRiverWareTemplate(records, setMsg)} disabled={sortedList.length===0}>📋 Copy 8-day RiverWare template</button>
            <button className="ghost" onClick={()=>copyRiverWareRealistic(records, setMsg)} disabled={sortedList.length===0}>📋 Copy 8-day (realistic, holiday-aware)</button>
          </div>
          {sortedList.length === 0 ? (
            <div className="empty">No data yet.</div>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Avg</th><th>Min</th><th>Max</th>
                    <th>On-Peak</th><th>Off-Peak</th><th>Std Dev</th><th>Source</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedList.map(function(r) {
                    const s = computeStats(r.hours);
                    if (!s) return null;
                    const isSel = selectedDates.indexOf(r.key) !== -1;
                    const isExpanded = expandedRow === r.key;
                    const rowEls = [];
                    rowEls.push(
                      <tr key={r.key + '-main'}>
                        <td>
                          <span style={{cursor:'pointer', marginRight:6}} onClick={function(){ setExpandedRow(isExpanded ? null : r.key); }}>
                            {isExpanded ? '▾' : '▸'}
                          </span>
                          {r.date}
                        </td>
                        <td>{s.avg.toFixed(2)}</td>
                        <td>{s.min.toFixed(2)}</td>
                        <td className={s.max>spikeThreshold?'spike':''}>{s.max.toFixed(2)}</td>
                        <td>{s.onAvg !== null ? s.onAvg.toFixed(2) : '-'}</td>
                        <td>{s.offAvg !== null ? s.offAvg.toFixed(2) : '-'}</td>
                        <td>{s.std.toFixed(2)}</td>
                        <td style={{fontSize:11, color:'#8b8f9a'}}>{r.source}</td>
                        <td>
                          <button
                            className="ghost"
                            style={{padding:'3px 8px', fontSize:11}}
                            onClick={function(){
                              setSelectedDates(function(prev) {
                                if (isSel) return prev.filter(function(k){ return k !== r.key; });
                                return prev.concat([r.key]).slice(-5);
                              });
                            }}
                          >
                            {isSel ? 'Remove' : 'Chart'}
                          </button>
                        </td>
                      </tr>
                    );
                    if (isExpanded) {
                      rowEls.push(
                        <tr key={r.key + '-detail'}>
                          <td colSpan={9} style={{background:'#0f1117', padding:'12px 10px'}}>
                            <div style={{display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:8}}>
                              {HE_COLS.map(function(h) {
                                const v = r.hours[h];
                                const isSpike = v !== null && v !== undefined && v > spikeThreshold;
                                return (
                                  <div
                                    key={h}
                                    style={{background:'#171a21', border:'1px solid #272a33', borderRadius:6, padding:'6px 10px'}}
                                  >
                                    <div style={{fontSize:10, color:'#8b8f9a'}}>{h}</div>
                                    <div style={{fontSize:14, fontWeight:600, color: isSpike ? '#f1a0a0' : '#e2e4e9'}}>
                                      {formatPrice(v)}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return <Fragment key={r.key}>{rowEls}</Fragment>;
                  })}
                </tbody>
              </table>
            </div>
          )}
          {selectedDates.length > 0 && (
            <div style={{marginTop:18}}>
              <LineChart series={selectedDates.map(function(k, i) {
                const colors = ['#5b8dee','#6ee7a0','#f0c674','#f1a0a0','#c38fe6'];
                return {
                  color: colors[i % 5],
                  label: recordsMap[k].key,
                  points: HE_COLS.map(function(h, idx) { return { x: idx, y: recordsMap[k].hours[h] }; })
                };
              })} />
            </div>
          )}
        </div>
      )}

      {tab === 'quality' && <section className="card">
        <h2>Database completeness audit</h2>
        <p>Checks calendar days between the earliest and latest stored date. HE01–HE24 are checked for missing values; HE25 is excluded because it is not a normal daily hour. Daylight-saving transition days need separate interval-level verification.</p>
        <div className="stat-grid"><div className="stat"><div className="label">Days in stored range</div><div className="val">{audit.checked}</div></div><div className="stat"><div className="label">Missing days</div><div className="val">{audit.missingDays.length}</div></div><div className="stat"><div className="label">Incomplete days</div><div className="val">{audit.incomplete.length}</div></div></div>
        <h3>Missing dates</h3><div className="scroll" style={{maxHeight:220}}>{audit.missingDays.length ? audit.missingDays.map(d=><div key={d} className="audit-line">{d} — all hours missing</div>) : <p>No gaps between stored dates.</p>}</div>
        <h3>Missing hourly values</h3><div className="scroll" style={{maxHeight:300}}>{audit.incomplete.length ? audit.incomplete.map(d=><div key={d.key} className="audit-line"><strong>{d.key}</strong> — {d.hours.join(', ')}</div>) : <p>No missing HE01–HE24 values in stored days.</p>}</div>
        <p className="insight-note">This audit does not check dates outside your stored range or confirm that CAISO delivered the correct timestamps. It is not a DST certification.</p>
      </section>}
      {tab === 'report' && <ReportPanel records={records}/>}
      {tab === 'history' && <section className="card"><div className="panel-heading"><div><h3>All hourly prices — one day per row</h3><p>Scroll horizontally to view HE01–HE25. A dash means no stored price.</p></div></div><div className="scroll" style={{overflowX:'auto',maxHeight:530}}><table className="wide-hour-table"><thead><tr><th>Date</th>{HE_COLS.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{sortedList.map(r=><tr key={r.key}><td>{r.key}</td>{HE_COLS.map(h=><td key={h} className={!validPrice(r.hours[h])?'missing-price':''}>{validPrice(r.hours[h])?r.hours[h].toFixed(2):'—'}</td>)}</tr>)}</tbody></table></div></section>}
      {tab === 'analysis' && <section className="card intelligence">
        <div className="panel-heading"><div><h2>Daily price opportunities</h2><p>Identify the strongest morning and evening generation windows · MEAD day-ahead LMP ($/MWh)</p></div><select value={trendWindow} onChange={e=>setTrendWindow(Number(e.target.value))}><option value={7}>Last 7 stored days</option><option value={30}>Last 30 stored days</option><option value={90}>Last 90 stored days</option><option value={365}>Last 365 stored days</option></select></div>
        <p className="insight-note">Morning: HE01–HE12. Evening: HE13–HE24. Each day's window maximum is its single highest hourly price. Only days with all 12 window prices are compared.</p>
        <div className="stat-grid">
          <div className="stat"><div className="label">Morning peak (daily average)</div><div className="val">{formatPrice(peaks.amAvg)}</div><small>Average of each day's highest AM hour</small></div>
          <div className="stat"><div className="label">Evening peak (daily average)</div><div className="val">{formatPrice(peaks.pmAvg)}</div><small>Average of each day's highest PM hour</small></div>
          <div className="stat"><div className="label">Days AM beats PM</div><div className="val">{opp.entries.length?Math.round(opp.amWins/opp.entries.length*100)+'%':'—'}</div><small>{opp.amWins} of {opp.entries.length} comparable days</small></div>
          <div className="stat"><div className="label">PM advantage over AM</div><div className="val">{opp.avgSpread===null?'—':formatPrice(-opp.avgSpread)}</div><small>Average (PM maximum − AM maximum), $/MWh; negative means AM higher</small></div>
        </div>
        <h3>Where are the high-value hours?</h3>
        <div className="opportunity-columns"><div><h3>Morning hours · HE01–HE12</h3>{opp.amHours.slice(0,4).map((x,i)=><div className="audit-line" key={x.he}><b>{i+1}. {x.he}</b><span>{formatPrice(x.mean)} average</span></div>)}</div><div><h3>Evening hours · HE13–HE24</h3>{opp.pmHours.slice(0,4).map((x,i)=><div className="audit-line" key={x.he}><b>{i+1}. {x.he}</b><span>{formatPrice(x.mean)} average</span></div>)}</div></div>
        <h3>Is there a distinct peak?</h3>
        <label>Minimum premium above nearby shoulder hours ($/MWh) <input type="number" min="0" step="1" value={amPremium} onChange={e=>setAmPremium(Math.max(0,Number(e.target.value)||0))}/></label>
        <div className="stat-grid"><div className="stat"><div className="label">AM peak days</div><div className="val">{opp.entries.length?Math.round(opp.amPeaks.length/opp.entries.length*100)+'%':'—'}</div><small>AM peak price vs median of the other 11 AM hours</small></div><div className="stat"><div className="label">PM peak days</div><div className="val">{opp.entries.length?Math.round(opp.pmPeaks.length/opp.entries.length*100)+'%':'—'}</div><small>PM peak price vs median of the other 11 PM hours</small></div><div className="stat"><div className="label">Average AM peak premium</div><div className="val">{formatPrice(opp.avgAmPremium)}</div><small>AM maximum minus median of the rest of the AM window</small></div><div className="stat"><div className="label">Average PM peak premium</div><div className="val">{formatPrice(opp.avgPmPremium)}</div><small>PM maximum minus median of the rest of the PM window</small></div></div>
        <p className="insight-note">A premium compares a window's peak hour against the median of the other 11 hours in that same window (HE01–12 for AM, HE13–24 for PM) — a high premium means a sharp, decisive spike; a low premium means the "peak" is a flat plateau where the exact hour is close to arbitrary. This is not revenue and does not account for generation limits.</p>
        <h3>Recent movement</h3><div className="opportunity-columns"><div className="trend-panel"><strong>AM daily maximum · latest 7 comparable days</strong><div>{formatPrice(opp.recentAM)}</div><small>{trendText(opp.recentAM,opp.priorAM)}</small></div><div className="trend-panel"><strong>PM daily maximum · latest 7 comparable days</strong><div>{formatPrice(opp.recentPM)}</div><small>{trendText(opp.recentPM,opp.priorPM)}</small></div></div>
        <p className="insight-note">Comparison: average of the latest 7 complete comparison days versus the preceding 14 complete days. A change is a trend, not a forecast. The selected lookback limits the days available for this comparison.</p>
        <h3>Next operating day · historical reference only</h3>
        {outlook&&outlook.matching?<><p><strong>{outlook.tomorrow}</strong> is the day after the most recent stored date, not necessarily tomorrow's calendar date. For each hour, the app averages available prices from up to 8 most recent matching weekdays. {outlook.matching} matching days found. It does not adjust for weather, demand, outages or changing market conditions.</p><div className="hour-chips">{outlookTop.map(x=><span key={x.he}>HE{String(x.he).padStart(2,'0')} <b>{formatPrice(x.price)}</b></span>)}</div><p className="insight-note">These are the five hours with the highest historical weekday average, not predicted prices. Download published CAISO day-ahead prices for the target operating day when available and use those instead.</p></>:<p>Insufficient matching-weekday history for an hourly reference.</p>}
      </section>}
      {tab === 'analysis' && (
        <div>
          {!globalStats ? (
            <div className="card"><div className="empty">No data yet.</div></div>
          ) : (
            <Fragment>
              <div className="card">
                <div className="stat-grid">
                  <div className="stat"><div className="label">Avg price</div><div className="val">{formatPrice(globalStats.avgAll)}</div></div>
                  <div className="stat"><div className="label">All-time max</div><div className="val">{formatPrice(globalStats.maxAll)}</div><small>{globalStats.maxRecord.date} · {globalStats.maxRecord.hour}</small></div>
                  <div className="stat"><div className="label">All-time min</div><div className="val">{formatPrice(globalStats.minAll)}</div><small>{globalStats.minRecord.date} · {globalStats.minRecord.hour}</small></div>
                  <div className="stat"><div className="label">Spike days</div><div className="val">{spikeDays.length}</div></div>
                </div>
              </div>
              <div className="card">
                <div className="row">
                  <label>Spike threshold ($):</label>
                  <input
                    type="number"
                    value={spikeThreshold}
                    onChange={function(e){ setSpikeThreshold(Number(e.target.value) || 0); }}
                    style={{width:90}}
                  />
                </div>
                {spikeDays.length === 0 ? (
                  <p style={{fontSize:13,color:'#8b8f9a'}}>None above threshold.</p>
                ) : (
                  <div className="scroll" style={{maxHeight:200}}>
                    <table>
                      <thead><tr><th>Date</th><th>Max</th></tr></thead>
                      <tbody>
                        {spikeDays.map(function(k) {
                          const s = computeStats(recordsMap[k].hours);
                          return (
                            <tr key={k}>
                              <td>{recordsMap[k].date}</td>
                              <td className="spike">{formatPrice(s.max)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Fragment>
          )}
        </div>
      )}

      {tab === 'heatmap' && <div className="card">
        <div className="section-heading"><div><h2>Weekly hourly price map</h2><p>Seven operating days per page · 24 hours across · each day has its own red-to-green scale.</p></div></div>
        {sortedList.length? <>
          <div className="row"><label>Week ending on stored day <select value={matrixRecord?matrixRecord.key:sortedList[0].key} onChange={e=>setMatrixDate(e.target.value)}>{sortedList.map(r=><option key={r.key} value={r.key}>{r.key}</option>)}</select></label><button onClick={()=>{const i=sortedList.findIndex(r=>r.key===(matrixRecord?matrixRecord.key:sortedList[0].key));setMatrixDate(sortedList[Math.min(sortedList.length-1,i+7)].key)}}>← Earlier week</button><button onClick={()=>{const i=sortedList.findIndex(r=>r.key===(matrixRecord?matrixRecord.key:sortedList[0].key));setMatrixDate(sortedList[Math.max(0,i-7)].key)}}>Later week →</button></div>
          <div className="week-map-scroll"><div className="week-map"><div className="week-date">Operating day</div>{Array.from({length:24},(_,i)=><div className="week-head" key={i}>HE{String(i+1).padStart(2,'0')}</div>)}<div className="week-head">Low</div><div className="week-head">High</div>
          {Array.from({length:7},(_,i)=>{const anchor=matrixRecord?matrixRecord.key:sortedList[0].key;const date=addDaysToIso(anchor,-6+i);const r=recordsMap[date];const values=r?HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice):[];const lo=values.length?Math.min(...values):null,hi=values.length?Math.max(...values):null;return <React.Fragment key={date}><div className="week-date">{date}</div>{HE_COLS.slice(0,24).map(h=>{const v=r?r.hours[h]:null;return <div key={h} className="week-cell" title={`${date} ${h}: ${validPrice(v)?formatPrice(v):'Missing'}`} style={{background:validPrice(v)?heatColor(v,lo,hi):'#cbd5e1'}}>{validPrice(v)?Number(v).toFixed(0):'—'}</div>})}<div className="week-edge">{lo===null?'—':formatPrice(lo)}</div><div className="week-edge">{hi===null?'—':formatPrice(hi)}</div></React.Fragment>})}</div></div>
          <p className="insight-note">Colors are relative to each individual day; compare numeric prices to assess differences between days. The display uses HE01–HE24. Fall-back daylight-saving days may contain an additional interval not represented here.</p>
        </>:<div className="empty">No stored prices yet.</div>}
      </div>}

      {tab === 'seasonal' && <div className="card">
        <div className="section-heading"><div><h2>Seasonal and calendar patterns</h2><p>AM = HE01–HE12 · PM = HE13–HE24. Only days with all 12 comparison hours are included.</p></div></div>
        <div className="row"><label>Months to display <select value={seasonMonths} onChange={e=>setSeasonMonths(Number(e.target.value))}><option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option><option value={36}>36 months</option></select></label></div>
        <div className="opportunity-columns"><div className="trend-panel"><strong>Weekdays</strong><div>{seasonal.weekday.days} complete days</div><small>AM peak: {seasonal.weekday.am===null?'—':formatPrice(seasonal.weekday.am)} · PM peak: {seasonal.weekday.pm===null?'—':formatPrice(seasonal.weekday.pm)}<br/>PM advantage: {seasonal.weekday.diff===null?'—':formatPrice(seasonal.weekday.diff)} · AM wins: {seasonal.weekday.amWins}</small></div><div className="trend-panel"><strong>Weekends</strong><div>{seasonal.weekend.days} complete days</div><small>AM peak: {seasonal.weekend.am===null?'—':formatPrice(seasonal.weekend.am)} · PM peak: {seasonal.weekend.pm===null?'—':formatPrice(seasonal.weekend.pm)}<br/>PM advantage: {seasonal.weekend.diff===null?'—':formatPrice(seasonal.weekend.diff)} · AM wins: {seasonal.weekend.amWins}</small></div></div>
        <h3>Explore a month</h3><p className="insight-note">Select a month to see its average daily AM and PM peaks, PM advantage, and how often AM exceeds PM. Based on the last {seasonMonths} months.</p>
        <div className="row">{MONTH_ABBR.map((label,i)=><button key={i} className={selectedMonth===i?'':'ghost'} onClick={()=>setSelectedMonth(selectedMonth===i?null:i)}>{label}</button>)}</div>
        {selectedMonth!==null&&(()=>{const rows=completePeakRows(records).filter(r=>Number(r.date.slice(5,7))===selectedMonth+1);const a=average(rows.map(r=>r.am)),b=average(rows.map(r=>r.pm));return <div className="month-detail"><button onClick={()=>setSelectedMonth(null)} style={{float:'right'}}>Close</button><h3>{new Date(Date.UTC(2024,selectedMonth,1)).toLocaleString('en-US',{month:'long',timeZone:'UTC'})} across all stored years</h3><HourlyBoxPlot records={records} month={selectedMonth} label={'Hourly price distribution · '+new Date(Date.UTC(2024,selectedMonth,1)).toLocaleString('en-US',{month:'long',timeZone:'UTC'})+' · all years'}/><p>Based on {rows.length} days with complete AM/PM prices · AM peak average: {formatPrice(a)} · PM peak average: {formatPrice(b)} · PM advantage: {a===null||b===null?'—':formatPrice(b-a)} · AM higher on {rows.filter(r=>r.am>r.pm).length} days.</p><p>Calculated using the maximum price in HE07–HE12 and HE17–HE22 for each complete day in this calendar month.</p></div>})()}
        <h3>Monthly AM / PM peak comparison</h3>
        <div className="scroll"><table><thead><tr><th>Month</th><th>Complete days</th><th>Average AM peak</th><th>Average PM peak</th><th>PM advantage</th><th>AM higher (days)</th></tr></thead><tbody>{seasonal.monthly.map(m=><tr key={m.month}><td>{m.month}</td><td>{m.days}</td><td>{m.am===null?'—':formatPrice(m.am)}</td><td>{m.pm===null?'—':formatPrice(m.pm)}</td><td>{m.diff===null?'—':formatPrice(m.diff)}</td><td>{m.amWins} / {m.days}</td></tr>)}</tbody></table></div>
        <h3>Year-over-year monthly peak prices</h3>
        <p className="insight-note">Each line is one year, January through December. Dashed/faded segments mark months built from fewer than 5 complete days — treat those points cautiously. The bar strip shows sample size per month across all years combined.</p>
        {(()=>{
          const years=[...new Set(yoy.map(r=>r.year))].sort((a,b)=>b-a).slice(0,5);
          const palette=['#65b8fa','#f2b56d','#8de39c','#e38da8','#c3a0f2'];
          const amSeries=years.map((year,i)=>({name:String(year)+' AM',color:palette[i%palette.length],points:Array.from({length:12},(_,m)=>{const r=yoy.find(x=>x.year===year&&x.month===m+1);return {x:m,value:r?r.am:null,n:r?r.days:0};})}));
          const diffSeries=years.map((year,i)=>({name:String(year),color:palette[i%palette.length],points:Array.from({length:12},(_,m)=>{const r=yoy.find(x=>x.year===year&&x.month===m+1);return {x:m,value:r?r.diff:null,n:r?r.days:0};})}));
          return <>
            <PriceLineChart title="AM peak by month, all years overlaid" monthMode minN={5} series={amSeries}/>
            <PriceLineChart title="PM advantage (PM − AM) by month, all years overlaid" monthMode minN={5} showCounts series={diffSeries}/>
          </>;
        })()}
        <h3>Rolling AM / PM peak trends</h3>
        <p className="insight-note">Window applies to both the trend line and the change cards below: change compares the most recent complete window against the immediately preceding non-overlapping window of the same size. Missing dates are skipped — "days" means complete comparison days, not calendar days.</p>
        <div className="row"><label>Rolling window <select value={rollingWindow} onChange={e=>setRollingWindow(Number(e.target.value))}>{[7,14,30,90,365].map(n=><option key={n} value={n}>{n}-day rolling average</option>)}</select></label></div>
        <div className="opportunity-columns">{rolling.change.length?rolling.change.map(c=><div className="trend-panel" key={c.key}><strong>{({am:'AM peak',pm:'PM peak',diff:'PM advantage'})[c.key]}</strong><div>{c.delta>=0?'+':''}{formatPrice(c.delta)}</div><small>{c.pct===null?'% unavailable':`${c.pct>=0?'+':''}${c.pct.toFixed(1)}%`} · {Math.abs(c.delta)<0.01?'Flat':c.delta>0?'Strengthening':'Weakening'}</small></div>):<p className="insight-note">Need at least {rollingWindow*2} complete comparison days for a period-over-period indicator at this window size.</p>}</div>
        <RollingAmPmChart points={rolling.points.slice(-180).map(r=>({date:r.date, am:r.am, pm:r.pm}))}/>
        <h3>Holiday versus ordinary days</h3>
        <p className="insight-note">Major US federal holidays are classified by actual date or observed weekday. Holiday dates are excluded from the ordinary weekday/weekend groups. Only complete AM/PM days are compared; small holiday samples may be unreliable.</p>
        <div className="scroll"><table><thead><tr><th>Day type</th><th>Days</th><th>AM peak average</th><th>PM peak average</th><th>PM advantage</th></tr></thead><tbody>{holidayStats.groups.map(g=><tr key={g.key}><td>{{weekday:'Ordinary weekday',weekend:'Ordinary weekend',actual:'Actual holiday',observed:'Observed holiday'}[g.key]}</td><td>{g.days}</td><td>{formatPrice(g.am)}</td><td>{formatPrice(g.pm)}</td><td>{formatPrice(g.diff)}</td></tr>)}</tbody></table></div>
        <details><summary>See classified holiday dates ({holidayStats.holidayDays.length})</summary><div className="scroll" style={{maxHeight:230}}><table><thead><tr><th>Date</th><th>Holiday</th><th>Classification</th><th>AM</th><th>PM</th></tr></thead><tbody>{holidayStats.holidayDays.map(r=><tr key={r.date}><td>{r.date}</td><td>{r.name}</td><td>{r.kind}</td><td>{formatPrice(r.am)}</td><td>{formatPrice(r.pm)}</td></tr>)}</tbody></table></div></details>
        <h3>Hourly price distribution — box plots</h3><p className="insight-note">Each box shows the middle 50% of observed prices (25th–75th percentile), the median line, and whiskers from minimum to maximum. Compare stable high-value hours with hours that spike only occasionally.</p>
        <div className="row"><label>Period <select value={boxPeriod} onChange={e=>setBoxPeriod(e.target.value)}><option value="7">Last 7 calendar days</option><option value="14">Last 14 calendar days</option><option value="30">Last 30 calendar days</option><option value="90">Last 90 calendar days</option><option value="365">Last 365 calendar days</option></select></label></div>
        <HourlyBoxPlot records={records} days={Number(boxPeriod)}/>
        <h3>How the trend is changing</h3>
        <p className="insight-note">Compare adjacent months to see whether PM advantage is rising or falling. For seasonal conclusions, compare the same month across different years: a single month-to-month change may be normal seasonality. Holidays are classified separately above.</p>
      </div>}


      {tab === 'visuals' && <div className="card">
        <div className="section-heading"><div><h2>PM premium by calendar month and day</h2><p>PM peak (HE13–24) minus AM peak (HE01–12), averaged across all available years. Positive values mean evening prices were higher.</p></div></div>
        <div className="month-card-grid">{Array.from({length:12},(_,i)=><button key={i} className={'month-card '+(opMonth===i?'month-active':'')} onClick={()=>{setOpMonth(i);setSelectedCalendarDay(null)}}>{new Date(Date.UTC(2024,i,1)).toLocaleString('en-US',{month:'long',timeZone:'UTC'})}</button>)}</div>
        <h3>{new Date(Date.UTC(2024,opMonth,1)).toLocaleString('en-US',{month:'long',timeZone:'UTC'})} · all stored years</h3>
        <OpportunityCalendar rows={opportunityData} month={opMonth} onDay={setSelectedCalendarDay}/>
        {selectedCalendarDay&&<div className="focus-detail"><div className="panel-heading"><h3>{new Date(Date.UTC(2024,opMonth,selectedCalendarDay.day)).toLocaleString('en-US',{month:'long',day:'numeric',timeZone:'UTC'})} · all years</h3><button onClick={()=>setSelectedCalendarDay(null)}>Close</button></div><p>Average AM peak: {formatPrice(selectedCalendarDay.am)} · Average PM peak: {formatPrice(selectedCalendarDay.pm)} · PM premium: {formatPrice(selectedCalendarDay.premium)} · PM higher on {selectedCalendarDay.pmWins} of {selectedCalendarDay.n} days.</p><div className="detail-table"><table><thead><tr><th>Date</th><th>AM peak</th><th>AM hour</th><th>PM peak</th><th>PM hour</th><th>PM premium</th></tr></thead><tbody>{selectedCalendarDay.rs.map(r=><tr key={r.date}><td>{r.date}</td><td>{formatPrice(r.am.price)}</td><td>HE{r.am.hour}</td><td>{formatPrice(r.pm.price)}</td><td>HE{r.pm.hour}</td><td>{formatPrice(r.pm.price-r.am.price)}</td></tr>)}</tbody></table></div></div>}
        <h2>Hourly Price Probability</h2><p className="insight-note">How frequently does each hour exceed a price level? Choose a threshold and lookback period.</p>
        <div className="row"><label>Price threshold ($/MWh) <select value={probThreshold} onChange={e=>setProbThreshold(Number(e.target.value))}>{[25,50,75,100,150,200].map(v=><option key={v} value={v}>${v}</option>)}</select></label><label>Lookback <select value={probDays} onChange={e=>setProbDays(Number(e.target.value))}>{[7,14,30,90,365].map(v=><option key={v} value={v}>Last {v} calendar days</option>)}</select></label></div>
        <ProbabilityChart records={records} threshold={probThreshold} days={probDays} onHour={setFocusHour}/>
        <h2>Peak-Hour Migration</h2><p className="insight-note">See whether the highest-priced morning and evening hours are shifting earlier or later.</p>
        <div className="row"><label>Lookback <select value={migrationDays} onChange={e=>setMigrationDays(Number(e.target.value))}>{[30,90,180,365,730].map(v=><option key={v} value={v}>Last {v} calendar days</option>)}</select></label></div>
        <MigrationChart rows={opportunityData} windowDays={migrationDays} onWeek={setSelectedWeek}/>
        {selectedWeek&&<div className="focus-detail"><div className="panel-heading"><h3>Week beginning {selectedWeek}</h3><button onClick={()=>setSelectedWeek(null)}>Close</button></div><p>Individual daily peak-hour observations underlying this weekly summary. "Margin" is how much the peak hour beat the next-highest hour in its window — a small margin means the peak was a flat plateau, not a sharp spike, and the exact hour is close to arbitrary.</p><div className="detail-table"><table><thead><tr><th>Date</th><th>AM peak hour</th><th>AM price</th><th>AM margin</th><th>PM peak hour</th><th>PM price</th><th>PM margin</th></tr></thead><tbody>{opportunityData.filter(r=>{const d=new Date(r.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-d.getUTCDay());return d.toISOString().slice(0,10)===selectedWeek}).map(r=><tr key={r.date}><td>{r.date}</td><td>HE{r.am.hour}</td><td>{formatPrice(r.am.price)}</td><td className={r.am.margin!==null&&r.am.margin<3?'spike':''}>{r.am.margin===null?'—':formatPrice(r.am.margin)}</td><td>HE{r.pm.hour}</td><td>{formatPrice(r.pm.price)}</td><td className={r.pm.margin!==null&&r.pm.margin<3?'spike':''}>{r.pm.margin===null?'—':formatPrice(r.pm.margin)}</td></tr>)}</tbody></table></div></div>}
        {focusHour&&<HourDetail records={records} hour={focusHour} threshold={probThreshold} onClose={()=>setFocusHour(null)}/>}
        <p className="insight-note">All charts use local MEAD day-ahead prices. Missing AM/PM hours exclude a day from the calendar and migration analysis. These are descriptive historical patterns, not tomorrow's published prices.</p>
      </div>}

      {tab === 'regimes' && <div className="card">
        <div className="section-heading"><div><h2>Day-type regime detection</h2><p>Groups historical days by price shape (level, volatility, midday dip, evening ramp, peak timing) using K-means clustering on z-scored features. No weather or solar data is available in this app, so regimes are derived and labeled from price behavior only — a label like "Midday dip" describes the price pattern, not a confirmed weather cause.</p></div></div>
        <PeriodPicker records={records} period={regimePeriod} onChange={setRegimePeriod}/>
        <p className="insight-note">Currently analyzing: <b>{periodLabel(regimePeriod)}</b> ({regimeFiltered.length} stored days in this selection). Choose "Specific year" to compare one year's regimes against another, or "All data" for the complete combined picture.</p>
        <div className="row"><label>Number of regimes (k) <select value={regimeK} onChange={e=>setRegimeK(Number(e.target.value))}>{[3,4,5,6,7].map(k=><option key={k} value={k}>{k}</option>)}</select></label><button className="ghost" onClick={()=>setShowElbow(s=>!s)}>{showElbow?'Hide':'Show'} elbow chart (choosing k)</button></div>
        {showElbow && <div className="chart-panel"><strong>Elbow method — inertia by k</strong><p className="insight-note">Inertia measures how tightly days cluster around their regime's center; it always decreases as k grows. Look for the point where adding another regime stops helping much (the "elbow") rather than picking the lowest value.</p>{elbow.length?<PlotlyChart traces={[{type:'scatter',mode:'lines+markers',x:elbow.map(e=>e.k),y:elbow.map(e=>e.inertia),line:{color:'#35c4ae',width:2.5},marker:{size:7},hovertemplate:'k=%{x}<br>inertia %{y:.1f}<extra></extra>'}]} layout={{height:240,xaxis:{title:'k',dtick:1},yaxis:{title:'Inertia'}}} height={240} style={{maxWidth:500}}/>:<p className="insight-note">Not enough complete days to compute an elbow chart.</p>}</div>}
        {!regimeResult ? <div className="empty">Not enough complete days ({'need at least '+(regimeK*3)}) with 20+ valid hourly prices to run regime detection at this k, for this period. Try a smaller k, a wider period, or import more data.</div> : <>
          <p className="insight-note">Based on {regimeResult.totalDays} days with at least 20 valid hourly prices. Regimes are sorted by frequency (most common first).</p>
          <div className="opportunity-columns">{regimeResult.clusters.map(c=><div key={c.id} className="trend-panel interactive" onClick={()=>setSelectedRegime(selectedRegime===c.id?null:c.id)} style={{cursor:'pointer',outline:selectedRegime===c.id?'2px solid #35c4ae':undefined}}><strong>{c.label}</strong><div style={{fontSize:16}}>{c.n} days <small style={{fontSize:11,color:'#9cb3c4'}}>({(c.n/regimeResult.totalDays*100).toFixed(0)}%)</small></div><small>Avg price {formatPrice(c.avgPrice)} · Avg peak {formatPrice(c.avgPeak)} · Avg spread {formatPrice(c.avgSpread)} · {Math.round(c.weekendShare*100)}% weekend/holiday</small></div>)}</div>
          {selectedRegime!==null && (()=>{const c=regimeResult.clusters.find(x=>x.id===selectedRegime);if(!c)return null;const recent=[...c.members].sort((a,b)=>b.key.localeCompare(a.key)).slice(0,20);return <div className="focus-detail"><div className="panel-heading"><h3>{c.label} · {c.n} matching days</h3><button onClick={()=>setSelectedRegime(null)}>Close</button></div><p>Centroid shape (regime average): daily average {formatPrice(c.centroid[0])} · peak {formatPrice(c.centroid[1])} · off-peak {formatPrice(c.centroid[2])} · volatility (std dev) {formatPrice(c.centroid[3])} · spread {formatPrice(c.centroid[4])} · midday deviation from daily average {formatPrice(c.centroid[5])} · evening ramp (HE17-19 minus HE15-16) {formatPrice(c.centroid[6])} · typical peak hour HE{Math.round(c.centroid[7])}.</p><div className="detail-table"><table><thead><tr><th>Date</th><th>Avg</th><th>Peak</th><th>Spread</th><th>Peak hour</th></tr></thead><tbody>{recent.map(m=><tr key={m.key}><td>{m.key}</td><td>{formatPrice(m.avg)}</td><td>{formatPrice(m.peak)}</td><td>{formatPrice(m.spread)}</td><td>HE{String(m.peakHourIdx).padStart(2,'0')}</td></tr>)}</tbody></table></div><p className="insight-note">Showing up to 20 most recent matching days of {c.n} total. Use this regime's typical shape to anticipate similar days and tailor bidding or release timing accordingly.</p></div>;})()}
        </>}

        <div className="section-heading" style={{marginTop:28}}><div><h2>Price-duration curves & tail risk</h2><p>Ranks each season's hourly prices from highest to lowest, and quantifies how extreme the top percentiles get using Conditional Value at Risk (CVaR) — the average price of hours at or above a given percentile threshold. Uses the same period selection as regime detection above.</p></div></div>
        {seasonCurves.length? <PriceDurationChart curves={seasonCurves}/> : <div className="empty">No stored prices yet in this period.</div>}
        {seasonCurves.map(c=><div key={c.key} className="card" style={{marginTop:14}}>
          <h3 style={{color:c.color}}>{c.name}</h3>
          <p className="insight-note">{c.stats.n.toLocaleString()} hourly observations.</p>
          <div className="scroll"><table><thead><tr><th>Percentile</th><th>Threshold</th><th>Hours at/above</th><th>% of hours</th><th>CVaR (avg price in that tail)</th></tr></thead><tbody>{c.stats.cvar.map(row=><tr key={row.p}><td>P{row.p}</td><td>{formatPrice(row.threshold)}</td><td>{row.count}</td><td>{row.pctOfHours.toFixed(2)}%</td><td className={row.p>=95?'spike':''}>{formatPrice(row.cvar)}</td></tr>)}</tbody></table></div>
        </div>)}
        <p className="insight-note">CVaR at P99 answers: "when prices spike into the top 1% of hours, what's the average price of that spike?" A high CVaR relative to the P99 threshold means the tail is heavy — when spikes happen, they tend to be severe, which raises the value of holding generation capacity in reserve for those hours. This is historical descriptive risk, not a forecast or a guarantee of future spike magnitude or frequency.</p>
      </div>}

      {tab === 'explore' && <div className="card">
        <div className="section-heading"><div><h2>Explore & dataset statistics</h2><p>Pick a period below — all charts and the summary panel on this tab update together. Use this to understand overall dataset behavior: which months/years run high or low, typical daily shape, and volatility over time.</p></div></div>
        <PeriodPicker records={records} period={explorePeriod} onChange={setExplorePeriod}/>
        <p className="insight-note">Currently showing: <b>{periodLabel(explorePeriod)}</b> ({exploreFiltered.length} stored days in this selection).</p>
        {exploreFiltered.length===0 ? <div className="empty">No stored days in this selection.</div> : <>
          <SummaryStatsPanel records={exploreFiltered}/>
          <DailyAverageWithMeanChart records={exploreFiltered}/>
          <VolatilityChart records={exploreFiltered}/>
          <PriceHistogramChart records={exploreFiltered}/>
          <MonthlyBoxChart records={exploreFiltered}/>
          <HourOfDayChart records={exploreFiltered}/>
          <MonthHourHeatmapChart records={exploreFiltered}/>
        </>}
      </div>}

      {tab === 'ask' && <AskPanel records={records}/>}

      {tab === 'negative' && <NegativePricePanel records={records}/>}

      {detail&&<div className="modal-backdrop" onClick={()=>setDetail(null)}><div className="detail-modal" onClick={e=>e.stopPropagation()}><div className="modal-heading"><h2>{detail.title}</h2><button onClick={()=>setDetail(null)}>✕ Close</button></div><p>{detail.body}</p>{detail.chart&&<div className="modal-chart" dangerouslySetInnerHTML={{__html:detail.chart}}/>}{detail.chart&&<button onClick={()=>{const svg=detail.chart.replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ');const blob=new Blob([svg],{type:'image/svg+xml'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='hoover-mead-chart.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>↓ Download chart (SVG)</button>}</div></div>}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
