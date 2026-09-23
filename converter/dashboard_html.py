"""Self-contained presentation of the public, aggregate-only dashboard contract."""

import html
import json
import math


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
    keys = ('period', 'attempts', 'successes', 'errors', 'unique_users', 'p50_seconds', 'p95_seconds',
            'error_rate', 'rolling_error_rate', 'partial', 'attempts_per_day', 'errors_per_day')
    return [{key: row.get(key) for key in keys} for row in rows]


# Show the ten listed country categories as parts of all attempts, including the remainder.
def _country_pie(rows, attempts):
    colors = ('#087b82', '#b33b32', '#6f4e9c', '#b36b08', '#2864b4',
              '#735c48', '#bd427d', '#4f7325', '#465767', '#aa510c')
    slices = [(row['label'], row['count']) for row in rows if row['count'] > 0]
    remainder = max(0, attempts - sum(count for label, count in slices))
    if remainder:
        slices.append(('Other / unlisted', remainder))
    total = sum(count for label, count in slices)
    if not total:
        return '<p class="note">No country observations in this period.</p>'
    shapes, legend = [], []
    angle = -math.pi / 2
    for index, (label, count) in enumerate(slices):
        share = count / total
        color = '#687982' if label == 'Other / unlisted' else colors[index % len(colors)]
        title = '{}: {} attempts ({:.1f}%)'.format(label, _number(count), share * 100)
        if count == total:
            shape = '<circle cx="100" cy="100" r="82" fill="{}"><title>{}</title></circle>'.format(
                color, _escape(title))
        else:
            finish = angle + 2 * math.pi * share
            x1, y1 = 100 + 82 * math.cos(angle), 100 + 82 * math.sin(angle)
            x2, y2 = 100 + 82 * math.cos(finish), 100 + 82 * math.sin(finish)
            shape = ('<path d="M100,100 L{:.3f},{:.3f} A82,82 0 {},1 {:.3f},{:.3f} Z" '
                     'fill="{}" stroke="white" stroke-width="1.5"><title>{}</title></path>').format(
                         x1, y1, int(share > .5), x2, y2, color, _escape(title))
            angle = finish
        shapes.append(shape)
        legend.append('<li><span class="pie-swatch" style="background:{}"></span><span>{}</span>'
                      '<strong>{:.1f}%</strong></li>'.format(color, _escape(label), share * 100))
    return ('<div class="country-content"><svg viewBox="0 0 200 200" role="img" '
            'aria-label="Country shares of all map attempts"><title>Country shares of all map attempts</title>{}</svg>'
            '<ul class="pie-legend">{}</ul></div>').format(''.join(shapes), ''.join(legend))


# Produce one dependency-free document, including useful tables without JavaScript.
def render_report(report):
    summary = report['summary']
    coverage = report['coverage']
    recent = report['recent']
    current, previous = recent['last7']['success_rate'], recent['previous7']['success_rate']
    change = None if current is None or previous is None else current - previous
    cards = [('7-day success rate', _number(current, '%', 1)),
             ('vs previous 7 days', 'Unavailable' if change is None else '{:+.1f} pp'.format(change)),
             ('7-day failures / attempts', '{} / {}'.format(recent['last7']['errors'], recent['last7']['attempts'])),
             ('30-day success rate', _number(summary.get('success_rate'), '%', 1)),
             ('30-day attempts', _number(summary.get('attempts'))),
             ('30-day approx. users', _number(summary.get('unique_users')))]
    charts = []
    for key, source, title, description, options in (
            ('daily', 'daily', 'Daily attempts', 'Completed UTC days · stacked by outcome',
             [('attempts', 'Attempts by outcome'), ('unique_users', 'Approx. users')]),
            ('monthly', 'monthly', 'Monthly attempts', 'Striped month is partial · totals include elapsed days only',
             [('attempts', 'Attempts by outcome'), ('attempts_per_day', 'Attempts per calendar day'), ('unique_users', 'Approx. users')]),
            ('daily-rates', 'daily', 'Daily failure rate', 'Daily rate and weighted 7-day rate · zero attempts = gap', [('rates', 'Failure rate')]),
            ('monthly-rates', 'monthly', 'Monthly failure rate', 'Failures / attempts · current month is provisional', [('error_rate', 'Failure rate')]),
            ('success-latency', 'latency_success', 'Successful map duration', 'p50 and p95 · seconds from pickup to completion', [('latency', 'p50 / p95')]),
            ('failed-latency', 'latency_failed', 'Failed attempt duration', 'p50 and p95 · separate from successful maps', [('latency', 'p50 / p95')]),
            ('error-stages', 'errors_daily', 'Daily errors by stage', 'Where failures occur · safe stage categories only', [('stages', 'Failure stages')]),
            ('osm-classes', 'osm_classes_daily', 'Daily OSM failure classes', 'get-osm failures · safe exception classes only', [('stages', 'Exception classes')])):
        rows = report[source]
        fields = (sorted(set(field for row in rows for field in row if field != 'period')) if source in ('errors_daily', 'osm_classes_daily')
                  else ['attempts', 'successes', 'errors', 'unique_users', 'error_rate', 'p50_seconds', 'p95_seconds'])
        if source.startswith('latency_'):
            fields = ['attempts', 'p50_seconds', 'p95_seconds']
        elif source == 'daily':
            fields += ['rolling_error_rate']
        elif source == 'monthly':
            fields += ['attempts_per_day', 'errors_per_day']
        names = {'attempts': 'Attempts', 'successes': 'Successes', 'errors': 'Errors', 'unique_users': 'Approx. users',
                 'error_rate': 'Failure %', 'rolling_error_rate': '7-day failure %',
                 'attempts_per_day': 'Attempts / day', 'errors_per_day': 'Errors / day',
                 'p50_seconds': 'p50 (s)', 'p95_seconds': 'p95 (s)'}
        charts.append('<section class="panel trend{single}" id="{key}" data-source="{source}"><div class="chart-heading">'
                      '<div><h2>{title}</h2><p>{description}</p></div><label>Metric '
                      '<select aria-label="{title} metric">{options}</select></label></div>'
                      '<div class="plot"></div><p class="chart-summary" aria-live="polite"></p>'
                      '<details><summary>View trend data</summary>{table}</details></section>'.format(
                          key=key, source=source, title=title, description=description,
                          single=' single-metric' if len(options) == 1 else '',
                          options=''.join('<option value="{}">{}</option>'.format(*option) for option in options),
                          table=_table(['UTC period'] + [names.get(field, field) for field in fields],
                                       [[row['period'] + (' (partial)' if row.get('partial') else '')] + [_number(row.get(field, 0) if source in ('errors_daily', 'osm_classes_daily') else row.get(field), decimals=1 if field.endswith(('_seconds', '_rate', '_day')) else 0)
                                        for field in fields]
                                        for row in rows], title + ' aggregate values')))
    error_total = sum(row['count'] for row in report['errors'])
    errors = _table(['Safe error group', 'Count', 'Share of failures'], [[row['label'], _number(row['count']),
                    _number(row['count'] / error_total * 100 if error_total else None, '%', 1)]
                    for row in report['errors']], 'Most common errors')
    rss = _table(['Process / stage', 'p50 MiB', 'p95 MiB', 'Max MiB', 'p95 / 1 GiB'],
                 [[row['stage']] + [_number(None if row.get(key) is None else row[key] / 1024.0, decimals=1)
                   for key in ('p50_kib', 'p95_kib', 'max_kib')] + [_number(row.get('p95_capacity_percent'), '%', 1)]
                  for row in report['rss']], 'Peak resident memory')
    timings = _table(['Pipeline stage', 'p50 seconds', 'p95 seconds'],
                     [[row['stage'], _number(row.get('p50_seconds'), decimals=1),
                       _number(row.get('p95_seconds'), decimals=1)] for row in report['timings']], 'Pipeline timings')
    usage = ''.join('<div class="panel">{}</div>'.format(_table(['Category', 'Attempts', 'Share of all attempts'],
                   [[row['label'], _number(row['count']), _number(row['count'] / summary['attempts'] * 100 if summary['attempts'] else None, '%', 1)] for row in report['usage'].get(key, [])], title))
                   for key, title in [('printing_technology', 'Printing technology'), ('content_mode', 'Content mode'),
                                      ('multipart', 'Multipart use')])
    countries = report['usage'].get('countries', [])
    country_table = _table(['Country', 'Attempts', 'Share of all attempts'],
                           [[row['label'], _number(row['count']),
                             _number(row['count'] / summary['attempts'] * 100 if summary['attempts'] else None, '%', 1)]
                            for row in countries], 'Top countries')
    usage += ('<section class="panel country-panel"><h2>Top countries</h2>'
              '<p class="note">Share of all attempts. Other / unlisted includes remaining countries and unknown locations outside the displayed ten.</p>'
              '{}<details><summary>View country data</summary>{}</details></section>').format(
                  _country_pie(countries, summary['attempts']), country_table)
    releases = _table(['Code commit', 'First observed in window', 'Attempts', 'Failure %', 'p50 (s)', 'p95 (s)'],
                      [[row['label'], row['first_seen'] or 'Unavailable', _number(row['attempts']),
                        _number(row['errors'] / row['attempts'] * 100 if row['attempts'] else None, '%', 1),
                        _number(row['p50_seconds'], decimals=1), _number(row['p95_seconds'], decimals=1)]
                       for row in report['releases']], 'Attempts by code revision')
    chart_data = {key: _chart_rows(report[key]) for key in ('daily', 'monthly', 'latency_success', 'latency_failed')}
    chart_data['errors_daily'] = report['errors_daily']
    chart_data['osm_classes_daily'] = report['osm_classes_daily']
    chart_data['releases'] = report['releases']
    data = json.dumps(chart_data,
                      separators=(',', ':'), allow_nan=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    return _DOCUMENT.replace('@@ENV@@', _escape(report['environment'])).replace(
        '@@GENERATED@@', _escape(report['generated_at'])).replace('@@START@@', _escape(coverage['start'])).replace(
        '@@END@@', _escape(coverage['end'])).replace('@@CARDS@@', ''.join(
            '<div class="stat"><dt>{}</dt><dd>{}</dd></div>'.format(_escape(label), _escape(value)) for label, value in cards)).replace(
        '@@CHARTS@@', ''.join(charts)).replace('@@ERRORS@@', errors).replace('@@RSS@@', rss).replace(
        '@@TIMINGS@@', timings).replace('@@USAGE@@', usage).replace('@@RELEASES@@', releases).replace('@@DATA@@', data)


_DOCUMENT = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>Touch Mapper · Map creation</title>
<style>
:root{color-scheme:light;--ink:#18313b;--muted:#526671;--line:#d5e1e5;--accent:#086e77;--paper:#fff}
*{box-sizing:border-box}body{margin:0;background:#f1f5f6;color:var(--ink);font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1680px;margin:auto;padding:32px 28px 48px}header{margin-bottom:24px}h1{font-size:clamp(1.8rem,4vw,2.6rem);letter-spacing:-.04em;line-height:1.15;margin:8px 0 12px}h2{font-size:1.2rem;margin:0 0 6px}p{margin:4px 0;color:var(--muted)}.eyebrow{font-weight:700;font-size:.8rem;letter-spacing:.12em;text-transform:uppercase}.badge{background:#d9eceb;color:#13595e;border-radius:5px;padding:3px 9px;letter-spacing:.04em;margin-left:8px}.panel{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px;min-width:0}.trend{margin-bottom:18px}.chart-heading{display:flex;justify-content:space-between;gap:16px;align-items:center}.chart-heading p{font-size:.875rem}.single-metric .chart-heading label{display:none}label{display:flex;align-items:center;gap:8px;font-size:.875rem;font-weight:600}select{font:inherit;color:var(--ink);background:white;border:1px solid #79949c;border-radius:6px;padding:9px;max-width:100%;min-width:0}select:focus-visible,summary:focus-visible,.table-scroll:focus-visible{outline:3px solid #096cbd;outline-offset:4px}.plot{margin-top:18px;min-height:180px}.plot svg{width:100%;height:auto;display:block;overflow:visible}.chart-summary{font-size:.85rem;margin:8px 0}.chart-summary strong{color:var(--ink)}details{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}summary{cursor:pointer;color:var(--accent);font-size:.875rem;font-weight:600}.section-heading{margin:32px 0 14px}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 18px}.stat{padding:16px;background:white;border:1px solid var(--line);border-radius:10px}dt{font-size:.8rem;color:var(--muted)}dd{font-size:1.65rem;line-height:1.3;font-weight:650;margin:7px 0 0;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.full{grid-column:1/-1}.table-scroll{overflow-x:auto;max-width:100%;border-radius:3px}table{width:100%;border-collapse:collapse;font-size:.875rem;font-variant-numeric:tabular-nums}caption{text-align:left;font-size:1rem;font-weight:650;margin-bottom:12px;color:var(--ink)}th,td{padding:10px 8px;border-bottom:1px solid #e4ebee;text-align:right;vertical-align:top}th:first-child,td:first-child{text-align:left;min-width:120px;overflow-wrap:break-word}.wide-table{min-width:500px}thead th{color:var(--muted);font-weight:600;background:#f5f8f9;font-size:.75rem}tbody th{font-weight:500}tbody tr:last-child>*{border-bottom:0}.scroll-hint{display:none}.note{font-size:.8rem;margin-top:12px}.country-content{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:18px;align-items:center;margin-top:14px}.country-content svg{width:100%;max-width:220px;height:auto}.pie-legend{list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 16px;padding:0;margin:0;font-size:.825rem;font-variant-numeric:tabular-nums}.pie-legend li{display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:6px;align-items:center}.pie-swatch{width:10px;height:10px;border-radius:2px}.pie-legend strong{font-weight:650}.country-panel details{margin-top:16px}footer{font-size:.8rem;margin-top:24px;color:var(--muted)}noscript p{padding:12px;background:#fff3d9}
@media(min-width:1200px){.trend-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:start}.trend-grid .trend{margin-bottom:0}.usage-grid{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}.chart-heading{align-items:flex-start}.chart-heading label{flex-direction:column;align-items:flex-start;flex-shrink:0;gap:4px}.chart-heading select{max-width:240px}}
@media(max-width:760px){.scroll-hint{display:block}main{padding:24px 16px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}.chart-heading{display:block}.chart-heading label{margin-top:14px}.panel{padding:16px}.plot{min-height:130px}.country-content{grid-template-columns:1fr;justify-items:center}.pie-legend{width:100%}th,td{padding:9px 6px}.stats .stat:last-child{grid-column:1/-1}}
@media(prefers-reduced-motion:no-preference){select{transition:border-color .15s}}
</style></head><body><main><header><div class="eyebrow">Touch Mapper <span class="badge">@@ENV@@</span></div><h1>Map creation</h1><p>Nightly aggregate activity &amp; converter health</p><p class="note">Generated <time>@@GENERATED@@</time> · UTC</p></header>
<noscript><p>Interactive charts need JavaScript. All aggregate trend values are available in the “View trend data” tables below.</p></noscript>
<div class="section-heading"><h2>30-day operations</h2><p>@@START@@ through @@END@@ · completed UTC days</p></div><dl class="stats">@@CARDS@@</dl><p class="note scroll-hint">Scroll tables sideways to view all columns.</p>
<div class="trend-grid">@@CHARTS@@</div>
<div class="section-heading"><h2>Diagnostics</h2><p>Last 30 completed UTC days</p></div>
<div class="grid"><section class="panel full">@@RELEASES@@<p class="note">Durations here mix successful and failed attempts. Revisions can have different workloads and sample sizes.</p></section><section class="panel full">@@RSS@@<p class="note">Peak RSS per stage, reported in MiB. Capacity share uses the 1 GiB production memory budget. Stage peaks are not additive and do not measure simultaneous host memory usage across the four pollers.</p></section><section class="panel">@@ERRORS@@<p class="note">Structured codes, then safe stage/class fallback. Raw error messages are never published.</p></section><section class="panel">@@TIMINGS@@<p class="note">Percentiles include available measurements only and mix outcomes. OSM fetch measures only the successful fetch attempt, excluding earlier failed retries. Missing measurements are unavailable, never zero.</p></section></div>
<div class="section-heading"><h2>Product usage</h2><p>Aggregate attempts during the same 30-day period</p></div><div class="grid usage-grid">@@USAGE@@</div>
<footer>Counts include completed telemetry through @@END@@ UTC. Empty periods have zero counts; duration gaps mean unavailable. Unique users are approximate and are not additive across periods. Striped monthly bars are partial. Per-day monthly counts use elapsed calendar days, not observed days; the first recorded month may have incomplete coverage. This unlisted public page uses obscurity, not authentication.</footer>
</main><script type="application/json" id="trend-data">@@DATA@@</script><script>
'use strict';
const trends = JSON.parse(document.getElementById('trend-data').textContent);
const metrics = {attempts:['Attempts by outcome','attempts'],unique_users:['Approximate users','users'],attempts_per_day:['Attempts per calendar day','attempts/day'],error_rate:['Failure rate','%'],rates:['Failure rate','%'],latency:['Duration','seconds'],stages:['Failures by stage','errors']};
const ns = 'http://www.w3.org/2000/svg';
const palette = ['#087b82','#b33b32','#6f4e9c','#b36b08','#2864b4','#735c48','#bd427d','#4f7325','#465767','#aa510c','#006c78','#75647f','#333333'];
function node(tag, attributes, text) { const el = document.createElementNS(ns,tag); for(const [key,value] of Object.entries(attributes)) el.setAttribute(key,value); if(text !== undefined) el.textContent=text; return el; }
function format(value) { return Number(value).toLocaleString('en-US',{maximumFractionDigits:2}); }
function present(value) { return value !== null && value !== undefined; }
// Use round tick intervals, with integer ticks for count charts.
function ceiling(value, integer) {
  const raw=Math.max(value,1)/4, magnitude=10**Math.floor(Math.log10(raw));
  let step=[1,2,2.5,5,10].find(n=>n*magnitude>=raw)*magnitude;
  if(integer) step=Math.max(1,Math.ceil(step));
  return step*4;
}
function percentageCeiling(value) { return [4,8,12,16,20,24,32,40,60,80,100].find(limit=>value<=limit) || 100; }
function shortDate(period) {
  const date=new Date(period+(period.length===7?'-01':'')+'T00:00:00Z');
  return date.toLocaleDateString('en-GB',period.length===7?{month:'short',year:'2-digit',timeZone:'UTC'}:{day:'numeric',month:'short',timeZone:'UTC'});
}
// Draw count bars and comparable lines using one unit per chart; missing durations stay gaps.
function draw(section, rows) {
  const key=section.querySelector('select').value, [label,unit]=metrics[key];
  const width=Math.max(240,section.querySelector('.plot').clientWidth), height=260;
  const left=55,right=18,top=28,bottom=42, innerWidth=width-left-right,innerHeight=height-top-bottom;
  const barMode=['attempts','attempts_per_day'].includes(key);
  let series=key==='attempts'?[['successes','Successful',palette[0]],['errors','Failed',palette[1]]]:
    key==='rates'?[['error_rate','Daily',palette[1]],['rolling_error_rate','7-day weighted',palette[0]]]:
    key==='latency'?[['p50_seconds','p50',palette[0]],['p95_seconds','p95',palette[2]]]:
    key==='stages'? [...new Set(rows.flatMap(r=>Object.keys(r).filter(k=>k!=='period')))].sort().map((k,i)=>[k,k,palette[i%palette.length]]):
    [[key,label,key.startsWith('error')?palette[1]:palette[0]]];
  const values=rows.flatMap(row=>series.map(([field])=>key==='stages'?(row[field]||0):row[field]).filter(present));
  const maximum=key==='attempts'?Math.max(1,...rows.map(r=>r.attempts)):Math.max(1,...values);
  const max=unit==='%'?percentageCeiling(maximum):ceiling(maximum,['attempts','errors','users'].includes(unit));
  const svg=node('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':`${label}, in ${unit}. Full values in the trend data table.`});
  const defs=node('defs',{}), pattern=node('pattern',{id:section.id+'-partial',width:6,height:6,patternUnits:'userSpaceOnUse',patternTransform:'rotate(45)'});
  pattern.appendChild(node('rect',{width:3,height:6,fill:'#ffffff','fill-opacity':0.55})); defs.appendChild(pattern);svg.appendChild(defs);
  svg.appendChild(node('text',{x:left,y:16,fill:'#526671','font-size':13},unit));
  for(let i=0;i<=4;i++){const value=max*i/4,y=top+innerHeight*(1-i/4);svg.appendChild(node('line',{x1:left,x2:width-right,y1:y,y2:y,stroke:'#dce6e9'}));svg.appendChild(node('text',{x:left-9,y:y+4,'text-anchor':'end',fill:'#526671','font-size':13},format(value)));}
  const slot=innerWidth/Math.max(1,rows.length), x=index=>left+slot*(index+0.5), y=value=>top+innerHeight*(1-value/max);
  if(barMode){
    rows.forEach((row,index)=>{
      let base=0;
      series.forEach(([field,name,color])=>{
        const value=row[field];if(!present(value))return;
        const rect=node('rect',{x:x(index)-slot*.35,y:y(base+value),width:slot*.7,height:innerHeight*value/max,fill:color});
        rect.appendChild(node('title',{},`${row.period}${row.partial?' (partial)':''}: ${name} ${format(value)} ${unit}`));svg.appendChild(rect);base+=value;
      });
      if(row.partial)svg.appendChild(node('rect',{x:x(index)-slot*.35,y:y(base),width:slot*.7,height:innerHeight*base/max,fill:`url(#${section.id}-partial)`,'pointer-events':'none'}));
    });
  } else {
    series.forEach(([field,name,color],seriesIndex)=>{
      let path='',connected=false;
      rows.forEach((row,index)=>{const value=key==='stages'?(row[field]||0):row[field];if(!present(value)){connected=false;return;}path+=`${connected?'L':'M'}${x(index)},${y(value)} `;connected=true;});
      svg.appendChild(node('path',{d:path,fill:'none',stroke:color,'stroke-width':2.5,'stroke-dasharray':seriesIndex%2?'7 4':'none','stroke-linejoin':'round'}));
      rows.forEach((row,index)=>{const value=key==='stages'?(row[field]||0):row[field];if(!present(value))return;const dot=node('circle',{cx:x(index),cy:y(value),r:3,fill:row.partial?'white':color,stroke:color,'stroke-width':2});dot.appendChild(node('title',{},`${row.period}${row.partial?' (partial)':''}: ${name} ${format(value)} ${unit}`));svg.appendChild(dot);});
    });
  }
  const step=Math.max(1,Math.ceil(rows.length/Math.max(2,Math.floor(innerWidth/85))));
  rows.forEach((row,index)=>{if(index%step && index!==rows.length-1)return;if(index!==rows.length-1 && index>0 && x(rows.length-1)-x(index)<95)return;svg.appendChild(node('text',{x:x(index),y:height-12,'text-anchor':index===0?'start':index===rows.length-1?'end':'middle',fill:'#526671','font-size':13},shortDate(row.period)));});
  section.querySelector('.plot').replaceChildren(svg);
  const description=section.querySelector('.chart-summary');description.replaceChildren();
  series.forEach(([field,name,color],i)=>{const span=document.createElement('span');span.style.color=color;span.style.marginRight='16px';span.textContent=(i%2&&!barMode?'┄ ':'━ ')+name;description.appendChild(span);});
  if(!values.length)description.appendChild(document.createTextNode('No measurements available.'));
  if(rows.some(r=>r.partial))description.appendChild(document.createTextNode(' Partial month: striped bars / hollow points.'));
}
function redraw(){document.querySelectorAll('[data-source]').forEach(section=>draw(section,trends[section.dataset.source]));}
document.querySelectorAll('[data-source]').forEach(section=>section.querySelector('select').addEventListener('change',()=>draw(section,trends[section.dataset.source])));
redraw();
let redrawTimer;window.addEventListener('resize',()=>{clearTimeout(redrawTimer);redrawTimer=setTimeout(redraw,100);});
</script></body></html>'''
