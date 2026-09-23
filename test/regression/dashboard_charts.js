'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../converter/dashboard_html.py'), 'utf8');
const start = source.indexOf('<script>\n') + '<script>\n'.length;
const end = source.indexOf('\n</script></body></html>', start);
assert(start > '<script>\n'.length && end > start);
const script = source.slice(start, end);

function element(tag) {
  return {
    tag, attributes: {}, children: [], style: {}, textContent: '',
    setAttribute(key, value) { this.attributes[key] = value; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; }
  };
}
function section(id, sourceName, metric) {
  const select = {value: metric, addEventListener() {}};
  const plot = Object.assign(element('div'), {clientWidth: 560});
  const summary = element('p');
  return {
    id, dataset: {source: sourceName}, plot,
    querySelector(selector) {
      return {'select': select, '.plot': plot, '.chart-summary': summary}[selector];
    }
  };
}
const sections = [
  section('daily-rates', 'daily', 'rates'),
  section('monthly-rates', 'monthly', 'error_rate'),
  section('high-rates', 'high', 'error_rate')
];
const trends = {
  daily: [{period: '2026-09-01', error_rate: 12, rolling_error_rate: 11},
          {period: '2026-09-02', error_rate: 15, rolling_error_rate: 12}],
  monthly: [{period: '2026-09', error_rate: 23, partial: true}],
  high: [{period: '2026-08', error_rate: 96}]
};
const document = {
  getElementById() { return {textContent: JSON.stringify(trends)}; },
  querySelectorAll() { return sections; },
  createElementNS(namespace, tag) { return element(tag); },
  createElement(tag) { return element(tag); },
  createTextNode(text) { return {textContent: text}; }
};
vm.runInNewContext(script, {document, window: {addEventListener() {}}});
function axisLabels(item) {
  const svg = item.plot.children[0];
  return svg.children.filter(child => child.tag === 'text').slice(1, 6).map(child => child.textContent);
}
assert.deepStrictEqual(axisLabels(sections[0]), ['0', '4', '8', '12', '16']);
assert.deepStrictEqual(axisLabels(sections[1]), ['0', '6', '12', '18', '24']);
assert.deepStrictEqual(axisLabels(sections[2]), ['0', '25', '50', '75', '100']);
console.log('Failure-rate axes match the observed values and retain the 100% cap');
