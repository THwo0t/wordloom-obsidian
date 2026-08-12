'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuery, parseCambridgeApiXml, parseCambridgeHtml, wordToSlug } = require('../src/services/cambridge');

const fixture = `<!doctype html><html><head><title>mitigate</title></head><body>
  <div class="entry-body__el">
    <div class="pos-header dpos-h"><span class="headword"><span class="hw">mitigate</span></span><span class="pos dpos">verb</span><span class="epp-xref">C2</span></div>
    <span class="uk dpron-i"><span class="ipa">/ˈmɪt.ɪ.ɡeɪt/</span></span>
    <span class="us dpron-i"><span class="ipa">/ˈmɪt̬.ə.ɡeɪt/</span></span>
    <div class="pr dsense">
      <span class="guideword"><span class="dsense_gw">MAKE LESS HARMFUL</span></span>
      <div class="def-block">
        <div class="def ddef_d">to make something less harmful, unpleasant, or bad</div>
        <span class="trans dtrans dtrans-se">减轻，缓和</span>
        <div class="examp dexamp"><span class="eg deg">It is unclear how to mitigate the effects.</span><span class="trans dtrans dtrans-se">尚不清楚如何减轻影响。</span></div>
      </div>
    </div>
  </div>
</body></html>`;

test('normalizes a word and creates Cambridge slug', () => {
  assert.equal(normalizeQuery('  climate   change  '), 'climate change');
  assert.equal(wordToSlug('Climate Change'), 'climate-change');
  assert.throws(() => normalizeQuery('1234'), /英文字母/);
});

test('parses Cambridge entry facts without AI inference', () => {
  const result = parseCambridgeHtml(fixture, 'https://dictionary.cambridge.org/test');
  assert.equal(result.query, 'mitigate');
  assert.deepEqual(result.levels, ['C2']);
  assert.equal(result.entries[0].partOfSpeech, 'verb');
  assert.equal(result.entries[0].senses[0].chinese, '减轻，缓和');
  assert.equal(result.entries[0].senses[0].examples[0].english, 'It is unclear how to mitigate the effects.');
});

test('rejects pages without a recognizable dictionary entry', () => {
  assert.throws(() => parseCambridgeHtml('<html><title>Missing</title></html>'), /未返回可识别/);
});

test('parses the official Cambridge API XML format', () => {
  const xml = `<root><di><header><f>mitigate</f><info><pron><ipa>/ˈmɪt.ɪ.ɡeɪt/</ipa></pron></info></header>
    <pos-block><header><info><pos>verb</pos><lvl>C2</lvl></info></header>
      <sense-block><header><info><gw>MAKE LESS HARMFUL</gw><lvl>C2</lvl></info></header>
        <def-block><definition><def>to make something less harmful</def><trans lang="zh-Hans">减轻，缓和</trans></definition>
          <examp><eg>We must mitigate the risks.</eg><trans lang="zh-Hans">我们必须降低风险。</trans></examp>
        </def-block>
      </sense-block>
    </pos-block></di></root>`;
  const result = parseCambridgeApiXml(xml, { entryUrl: 'https://dictionary.cambridge.org/dictionary/english/mitigate' });
  assert.equal(result.query, 'mitigate');
  assert.deepEqual(result.levels, ['C2']);
  assert.equal(result.entries[0].partOfSpeech, 'verb');
  assert.equal(result.entries[0].senses[0].examples[0].chinese, '我们必须降低风险。');
  assert.equal(result.source.name, 'Cambridge Dictionary API');
});
