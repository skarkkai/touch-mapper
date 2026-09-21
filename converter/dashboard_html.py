"""Self-contained presentation of the public, aggregate-only dashboard contract."""

import html
import json


def _escape(value):
    return html.escape(str(value), quote=True)


def _number(value, suffix='', decimals=0):
    if value is None:
        return 'Unavailable'
    return ('{:,.%df}' % decimals).format(value) + suffix


# Render semantic tables with horizontal scrolling restricted to the table itself.
def _table(headers, rows, caption):
    cells = ''.join('<tr>' + ''.join('<{}>{}</{}>'.format(
        'th scope="row"' if index == 0 else 'td', _escape(cell),
        'th' if index == 0 else 'td') for index, cell in enumerate(row)) + '</tr>'
        for row in rows)
    if not cells:
        cells = '<tr><td colspan="{}">No observations in this period.</td></tr>'.format(len(headers))
    return ('<div class="table-scroll" tabindex="0" role="region" aria-label="{}">'
            '<table class="{}"><caption>{}</caption><thead><tr>{}</tr></thead><tbody>{}</tbody>'
            '</table></div>').format(_escape(caption), 'wide-table' if len(headers) > 3 else '', _escape(caption), ''.join(
                '<th scope="col">{}</th>'.format(_escape(header)) for header in headers), cells)


# Keep the downloadable source limited to the defined aggregate chart fields.
def _chart_rows(rows):
    keys = ('period', 'attempts', 'successes', 'errors', 'unique_users', 'p50_seconds', 'p95_seconds')
    return [{key: row.get(key) for key in keys} for row in rows]


# Produce one dependency-free document, including useful tables without JavaScript.
def render_report(report):
    summary = report['summary']
    coverage = report['coverage']
    cards = [('Attempts', _number(summary.get('attempts'))),
             ('Success rate', _number(summary.get('success_rate'), '%', 1)),
             ('Approx. unique users', _number(summary.get('unique_users'))),
             ('p50 end-to-end', _number(summary.get('p50_seconds'), ' s', 1)),
             ('p95 end-to-end', _number(summary.get('p95_seconds'), ' s', 1))]
    charts = []
    for key, title, description in (
            ('daily', 'Daily activity', 'Last 30 completed UTC days'),
            ('monthly', 'Monthly activity', 'All available history through the last completed UTC day')):
        rows = report[key]
        options = [('attempts', 'Attempts'), ('successes', 'Successes'), ('errors', 'Errors'),
                   ('unique_users', 'Approximate unique users'),
                   ('p50_seconds', 'p50 end-to-end duration'), ('p95_seconds', 'p95 end-to-end duration')]
        charts.append('<section class="panel trend" id="{key}"><div class="chart-heading">'
                      '<div><h2>{title}</h2><p>{description}</p></div><label>Metric '
                      '<select aria-label="{title} metric">{options}</select></label></div>'
                      '<div class="plot"></div><p class="chart-summary" aria-live="polite"></p>'
                      '<details><summary>View trend data</summary>{table}</details></section>'.format(
                          key=key, title=title, description=description,
                          options=''.join('<option value="{}">{}</option>'.format(*option) for option in options),
                          table=_table(['UTC period', 'Attempts', 'Successes', 'Errors', 'Approx. users', 'p50 (s)', 'p95 (s)'],
                                       [[row['period']] + [_number(row.get(field), decimals=1 if field.endswith('_seconds') else 0)
                                        for field in ('attempts', 'successes', 'errors', 'unique_users', 'p50_seconds', 'p95_seconds')]
                                        for row in rows], title + ' aggregate values')))
    errors = _table(['Safe error group', 'Count'], [[row['label'], _number(row['count'])]
                    for row in report['errors']], 'Most common errors')
    rss = _table(['Process / stage', 'p50 MiB', 'p95 MiB', 'Max MiB', 'p95 / 1 GiB'],
                 [[row['stage']] + [_number(None if row.get(key) is None else row[key] / 1024.0, decimals=1)
                   for key in ('p50_kib', 'p95_kib', 'max_kib')] + [_number(row.get('p95_capacity_percent'), '%', 1)]
                  for row in report['rss']], 'Peak resident memory')
    timings = _table(['Pipeline stage', 'p50 seconds', 'p95 seconds'],
                     [[row['stage'], _number(row.get('p50_seconds'), decimals=1),
                       _number(row.get('p95_seconds'), decimals=1)] for row in report['timings']], 'Pipeline timings')
    usage = ''.join('<div class="panel">{}</div>'.format(_table(['Category', 'Attempts'],
                   [[row['label'], _number(row['count'])] for row in report['usage'].get(key, [])], title))
                   for key, title in [('printing_technology', 'Printing technology'), ('content_mode', 'Content mode'),
                                      ('multipart', 'Multipart use'), ('countries', 'Top countries')])
    data = json.dumps({key: _chart_rows(report[key]) for key in ('daily', 'monthly')},
                      separators=(',', ':'), allow_nan=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    return _DOCUMENT.replace('@@ENV@@', _escape(report['environment'])).replace(
        '@@GENERATED@@', _escape(report['generated_at'])).replace('@@START@@', _escape(coverage['start'])).replace(
        '@@END@@', _escape(coverage['end'])).replace('@@CARDS@@', ''.join(
            '<div class="stat"><dt>{}</dt><dd>{}</dd></div>'.format(_escape(label), _escape(value)) for label, value in cards)).replace(
        '@@CHARTS@@', ''.join(charts)).replace('@@ERRORS@@', errors).replace('@@RSS@@', rss).replace(
        '@@TIMINGS@@', timings).replace('@@USAGE@@', usage).replace('@@DATA@@', data)


_DOCUMENT = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>Touch Mapper · Map creation</title>
<style>
:root{color-scheme:light;--ink:#18313b;--muted:#526671;--line:#d5e1e5;--accent:#086e77;--paper:#fff}
*{box-sizing:border-box}body{margin:0;background:#f1f5f6;color:var(--ink);font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1680px;margin:auto;padding:32px 28px 48px}header{margin-bottom:24px}h1{font-size:clamp(1.8rem,4vw,2.6rem);letter-spacing:-.04em;line-height:1.15;margin:8px 0 12px}h2{font-size:1.2rem;margin:0 0 6px}p{margin:4px 0;color:var(--muted)}.eyebrow{font-weight:700;font-size:.8rem;letter-spacing:.12em;text-transform:uppercase}.badge{background:#d9eceb;color:#13595e;border-radius:5px;padding:3px 9px;letter-spacing:.04em;margin-left:8px}.panel{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px;min-width:0}.trend{margin-bottom:18px}.chart-heading{display:flex;justify-content:space-between;gap:16px;align-items:center}.chart-heading p{font-size:.875rem}label{display:flex;align-items:center;gap:8px;font-size:.875rem;font-weight:600}select{font:inherit;color:var(--ink);background:white;border:1px solid #79949c;border-radius:6px;padding:9px;max-width:100%;min-width:0}select:focus-visible,summary:focus-visible,.table-scroll:focus-visible{outline:3px solid #096cbd;outline-offset:4px}.plot{margin-top:18px;min-height:180px}.plot svg{width:100%;height:auto;display:block;overflow:visible}.chart-summary{font-size:.85rem;margin:8px 0}.chart-summary strong{color:var(--ink)}details{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}summary{cursor:pointer;color:var(--accent);font-size:.875rem;font-weight:600}.section-heading{margin:32px 0 14px}.stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:0 0 18px}.stat{padding:16px;background:white;border:1px solid var(--line);border-radius:10px}dt{font-size:.8rem;color:var(--muted)}dd{font-size:1.65rem;line-height:1.3;font-weight:650;margin:7px 0 0;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.full{grid-column:1/-1}.table-scroll{overflow-x:auto;max-width:100%;border-radius:3px}table{width:100%;border-collapse:collapse;font-size:.875rem;font-variant-numeric:tabular-nums}caption{text-align:left;font-size:1rem;font-weight:650;margin-bottom:12px;color:var(--ink)}th,td{padding:10px 8px;border-bottom:1px solid #e4ebee;text-align:right;vertical-align:top}th:first-child,td:first-child{text-align:left;min-width:120px;overflow-wrap:break-word}.wide-table{min-width:500px}thead th{color:var(--muted);font-weight:600;background:#f5f8f9;font-size:.75rem}tbody th{font-weight:500}tbody tr:last-child>*{border-bottom:0}.scroll-hint{display:none}.note{font-size:.8rem;margin-top:12px}footer{font-size:.8rem;margin-top:24px;color:var(--muted)}noscript p{padding:12px;background:#fff3d9}
@media(min-width:1200px){.trend-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:start}.trend-grid .trend{margin-bottom:0}.usage-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.chart-heading{align-items:flex-start}.chart-heading label{flex-direction:column;align-items:flex-start;flex-shrink:0;gap:4px}.chart-heading select{max-width:240px}}
@media(max-width:760px){.scroll-hint{display:block}main{padding:24px 16px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}.chart-heading{display:block}.chart-heading label{margin-top:14px}.panel{padding:16px}.plot{min-height:130px}th,td{padding:9px 6px}.stats .stat:last-child{grid-column:1/-1}}
@media(prefers-reduced-motion:no-preference){select{transition:border-color .15s}}
</style></head><body><main><header><div class="eyebrow">Touch Mapper <span class="badge">@@ENV@@</span></div><h1>Map creation</h1><p>Nightly aggregate activity &amp; converter health</p><p class="note">Generated <time>@@GENERATED@@</time> · UTC</p></header>
<noscript><p>Interactive charts need JavaScript. All aggregate trend values are available in the “View trend data” tables below.</p></noscript>
<div class="trend-grid">@@CHARTS@@</div>
<div class="section-heading"><h2>30-day operations</h2><p>@@START@@ through @@END@@ · completed UTC days</p></div><dl class="stats">@@CARDS@@</dl><p class="note scroll-hint">Scroll tables sideways to view all columns.</p>
<div class="grid"><section class="panel full">@@RSS@@<p class="note">Peak RSS per stage, reported in MiB. Capacity share uses the 1 GiB production memory budget. Stage peaks are not additive.</p></section><section class="panel">@@ERRORS@@<p class="note">Structured codes, then safe stage/class fallback. Raw error messages are never published.</p></section><section class="panel">@@TIMINGS@@<p class="note">Percentiles include available measurements only. Missing measurements are unavailable, never zero.</p></section></div>
<div class="section-heading"><h2>Product usage</h2><p>Aggregate attempts during the same 30-day period</p></div><div class="grid usage-grid">@@USAGE@@</div>
<footer>Counts include completed telemetry through @@END@@ UTC. Empty periods have zero counts; duration gaps mean unavailable. Unique users are approximate and are not additive across periods. Monthly values may include a partial current month. This unlisted public page uses obscurity, not authentication.</footer>
</main><script type="application/json" id="trend-data">@@DATA@@</script><script>
'use strict';
const trends = JSON.parse(document.getElementById('trend-data').textContent);
const metrics = {attempts:['Attempts','attempts'],successes:['Successes','maps'],errors:['Errors','errors'],unique_users:['Approximate unique users','users'],p50_seconds:['p50 end-to-end duration','seconds'],p95_seconds:['p95 end-to-end duration','seconds']};
const ns = 'http://www.w3.org/2000/svg';
function node(tag, attributes, text) { const el = document.createElementNS(ns,tag); for(const [key,value] of Object.entries(attributes)) el.setAttribute(key,value); if(text !== undefined) el.textContent=text; return el; }
function format(value) { return Number(value).toLocaleString('en-US',{maximumFractionDigits:1}); }
// Draw exactly one metric and unit; unavailable observations break the line.
function draw(section, rows) {
  const key=section.querySelector('select').value, [label,unit]=metrics[key];
  const width=Math.max(240,section.querySelector('.plot').clientWidth);
  const narrow=width<600;
  const height=narrow?230:260, left=narrow?45:65,right=12,top=30,bottom=45;
  const innerWidth=width-left-right,innerHeight=height-top-bottom;
  const available=rows.filter(row=>row[key]!==null && row[key]!==undefined);
  const max=Math.max(1,...available.map(row=>row[key]));
  const svg=node('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':`${label}, in ${unit}. ${rows.length} UTC periods. Full values in the trend data table.`});
  svg.appendChild(node('text',{x:left,y:15,fill:'#526671','font-size':13},unit));
  for(let i=0;i<=4;i++){const value=max*i/4,y=top+innerHeight*(1-i/4);svg.appendChild(node('line',{x1:left,x2:width-right,y1:y,y2:y,stroke:'#dce6e9'}));svg.appendChild(node('text',{x:left-10,y:y+4,'text-anchor':'end',fill:'#526671','font-size':13},format(value)));}
  const x=index=>left+(rows.length===1?innerWidth/2:index*innerWidth/Math.max(1,rows.length-1));
  const y=value=>top+innerHeight*(1-value/max);
  let path='',connected=false;
  rows.forEach((row,index)=>{const value=row[key];if(value===null || value===undefined){connected=false;return;}path+=`${connected?'L':'M'}${x(index)},${y(value)} `;connected=true;});
  svg.appendChild(node('path',{d:path,fill:'none',stroke:'#087b82','stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round'}));
  rows.forEach((row,index)=>{const value=row[key];if(value===null || value===undefined)return;const dot=node('circle',{cx:x(index),cy:y(value),r:rows.length>100?2:3,fill:'#087b82'});dot.appendChild(node('title',{},`${row.period}: ${format(value)} ${unit}`));svg.appendChild(dot);});
  const step=Math.max(1,Math.ceil((rows.length-1)/(width<400?1:narrow?2:5)));
  rows.forEach((row,index)=>{if(index%step && index!==rows.length-1)return;if(index!==0 && index!==rows.length-1 && x(rows.length-1)-x(index)<row.period.length*10)return;svg.appendChild(node('text',{x:x(index),y:height-14,'text-anchor':index===0?'start':index===rows.length-1?'end':'middle',fill:'#526671','font-size':13},row.period));});
  const plot=section.querySelector('.plot');plot.replaceChildren(svg);
  const description=section.querySelector('.chart-summary');
  description.textContent=available.length?`${label} · ${unit} · Range ${format(Math.min(...available.map(row=>row[key])))}–${format(max===1 && available.every(row=>row[key]===0)?0:Math.max(...available.map(row=>row[key])))} · ${available.length} of ${rows.length} periods with observations.`:`${label} · ${unit} · Unavailable for all periods.`;
}
for(const [key,rows] of Object.entries(trends)){const section=document.getElementById(key);section.querySelector('select').addEventListener('change',()=>draw(section,rows));draw(section,rows);}
let redrawTimer;window.addEventListener('resize',()=>{clearTimeout(redrawTimer);redrawTimer=setTimeout(()=>{for(const [key,rows] of Object.entries(trends))draw(document.getElementById(key),rows);},100);});
</script></body></html>'''
