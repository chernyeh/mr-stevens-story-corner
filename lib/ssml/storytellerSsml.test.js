'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { convertStoryToSsml, convertStoryToPlainText } = require('./storytellerSsml');

test('wraps output in <speak>...</speak>', () => {
  const ssml = convertStoryToSsml('Just one plain paragraph.');
  assert.match(ssml, /^<speak>/);
  assert.match(ssml, /<\/speak>$/);
});

test('returns an empty <speak> element for empty input', () => {
  assert.equal(convertStoryToSsml(''), '<speak></speak>');
  assert.equal(convertStoryToSsml('   \n  '), '<speak></speak>');
});

test('escapes XML special characters before any tags are injected', () => {
  const ssml = convertStoryToSsml('Smith & Sons said "5 < 10 > -1".');
  assert.match(ssml, /Smith &amp; Sons/);
  assert.match(ssml, /5 &lt; 10 &gt; -1/);
  assert.ok(!ssml.includes(' < 10'), 'raw < must not survive escaping');
});

test('markdown # heading becomes a slow, authoritative title with a long pause', () => {
  const ssml = convertStoryToSsml('# The Glass Mountain');
  assert.equal(
    ssml,
    '<speak><prosody rate="slow" pitch="-2st">The Glass Mountain</prosody><break time="1.5s"/></speak>'
  );
});

test('a line starting with "Chapter" becomes a title', () => {
  const ssml = convertStoryToSsml('Chapter One: The Beginning');
  assert.equal(
    ssml,
    '<speak><prosody rate="slow" pitch="-2st">Chapter One: The Beginning</prosody><break time="1.5s"/></speak>'
  );
});

test('a title is not followed by a doubled-up paragraph pause', () => {
  const ssml = convertStoryToSsml('# Title\n\nBody text.');
  // The title's own 1.5s break must serve as the only separator.
  assert.ok(!ssml.includes('</break time="1.5s"/><break time="1.2s"/>'));
  assert.match(ssml, /<break time="1.5s"\/>Body text\./);
});

test('double line breaks become a 1.2s pacing pause between paragraphs', () => {
  const ssml = convertStoryToSsml('First paragraph.\n\nSecond paragraph.');
  assert.equal(
    ssml,
    '<speak>First paragraph.<break time="1.2s"/>Second paragraph.</speak>'
  );
});

test('a single newline inside a paragraph collapses to a space, not a pause', () => {
  const ssml = convertStoryToSsml('Line one\nline two.');
  assert.equal(ssml, '<speak>Line one line two.</speak>');
});

test('em-dashes (unicode and double-hyphen) become a 600ms hanging pause', () => {
  assert.equal(
    convertStoryToSsml('She walked—alone.'),
    '<speak>She walked<break time="600ms"/>alone.</speak>'
  );
  assert.equal(
    convertStoryToSsml('She walked--alone.'),
    '<speak>She walked<break time="600ms"/>alone.</speak>'
  );
});

test('ellipses become an 800ms trailing pause', () => {
  assert.equal(
    convertStoryToSsml('I have come a long way...'),
    '<speak>I have come a long way<break time="800ms"/></speak>'
  );
});

test('*word* becomes strong emphasis', () => {
  assert.equal(
    convertStoryToSsml('It was *impossible* to know.'),
    '<speak>It was <emphasis level="strong">impossible</emphasis> to know.</speak>'
  );
});

test('(asides) get a hushed, lowered prosody wrapper', () => {
  assert.equal(
    convertStoryToSsml('She smiled (though she was afraid) and left.'),
    '<speak>She smiled <prosody pitch="-1st" volume="-4dB">(though she was afraid)</prosody> and left.</speak>'
  );
});

test('dialogue near a high-pitch keyword ("squeaked") gets pitched up', () => {
  const ssml = convertStoryToSsml('"I do!" the goblin squeaked.');
  assert.equal(
    ssml,
    '<speak><prosody pitch="+2st" rate="fast">"I do!"</prosody> the goblin squeaked.</speak>'
  );
});

test('dialogue near a low-pitch keyword ("rumbled") gets pitched down', () => {
  const ssml = convertStoryToSsml('The giant rumbled, "Who goes there?"');
  assert.equal(
    ssml,
    '<speak>The giant rumbled, <prosody pitch="-3st" rate="slow">"Who goes there?"</prosody></speak>'
  );
});

test('dialogue with no nearby indicator gets the subtle neutral shift', () => {
  const ssml = convertStoryToSsml('She said, "I have come a long way."');
  assert.equal(
    ssml,
    '<speak>She said, <prosody pitch="+1st">"I have come a long way."</prosody></speak>'
  );
});

test('keyword classification ignores words outside the context window', () => {
  // "goblin" sits well outside the 60-char window that precedes the quote.
  const farAway = 'goblin, '.repeat(10) + 'and then, after a long quiet walk through the woods, ';
  const ssml = convertStoryToSsml(`${farAway}"Hello there."`);
  assert.match(ssml, /<prosody pitch="\+1st">"Hello there\."<\/prosody>/);
});

test('"The End" rises on "The", hangs, then falls on "End." — no doubled paragraph pause', () => {
  const ssml = convertStoryToSsml('Body text.\n\nThe End');
  assert.equal(
    ssml,
    '<speak>Body text.<break time="2.0s"/>' +
      '<prosody rate="x-slow" volume="-2dB">' +
      '<prosody pitch="+1st">The</prosody><break time="400ms"/>' +
      '<prosody pitch="-4st">End.</prosody></prosody></speak>'
  );
});

test('curly-quoted dialogue is detected the same as straight quotes', () => {
  const ssml = convertStoryToSsml('The giant rumbled, “Who goes there?”');
  assert.equal(
    ssml,
    '<speak>The giant rumbled, <prosody pitch="-3st" rate="slow">“Who goes there?”</prosody></speak>'
  );
});

test('"Fin" is treated as an ending too', () => {
  const ssml = convertStoryToSsml('Fin');
  assert.equal(
    ssml,
    '<speak><break time="2.0s"/><prosody rate="x-slow" pitch="-3st" volume="-2dB">Fin.</prosody></speak>'
  );
});

test('an ending is not preceded by a doubled-up paragraph pause', () => {
  const ssml = convertStoryToSsml('Body text.\n\nThe End');
  assert.ok(!ssml.includes('<break time="1.2s"/><break time="1.2s"/>'));
});

test('full story: title, paragraphs, dashes, aside, emphasis, mixed dialogue, and The End', () => {
  const rawStory = [
    '# The Glass Mountain',
    '',
    'Once upon a time there lived a girl who dreamed of *impossible* things.',
    '',
    'She walked for three days—resting only when the moon rose (though she was rarely tired)—until she reached the mountain.',
    '',
    '"Who dares climb my slopes?" the giant rumbled, his voice shaking the stones.',
    '',
    '"I do!" the goblin squeaked, hopping from behind a rock.',
    '',
    'The girl merely said, "I have come a long way..."',
    '',
    'The End',
  ].join('\n');

  const ssml = convertStoryToSsml(rawStory);

  const expected =
    '<speak>' +
    '<prosody rate="slow" pitch="-2st">The Glass Mountain</prosody><break time="1.5s"/>' +
    'Once upon a time there lived a girl who dreamed of <emphasis level="strong">impossible</emphasis> things.' +
    '<break time="1.2s"/>' +
    'She walked for three days<break time="600ms"/>resting only when the moon rose ' +
    '<prosody pitch="-1st" volume="-4dB">(though she was rarely tired)</prosody>' +
    '<break time="600ms"/>until she reached the mountain.' +
    '<break time="1.2s"/>' +
    '<prosody pitch="-3st" rate="slow">"Who dares climb my slopes?"</prosody> the giant rumbled, his voice shaking the stones.' +
    '<break time="1.2s"/>' +
    '<prosody pitch="+2st" rate="fast">"I do!"</prosody> the goblin squeaked, hopping from behind a rock.' +
    '<break time="1.2s"/>' +
    'The girl merely said, <prosody pitch="+1st">"I have come a long way<break time="800ms"/>"</prosody>' +
    '<break time="2.0s"/><prosody rate="x-slow" volume="-2dB">' +
    '<prosody pitch="+1st">The</prosody><break time="400ms"/>' +
    '<prosody pitch="-4st">End.</prosody></prosody>' +
    '</speak>';

  assert.equal(ssml, expected);
});

test('convertStoryToPlainText (Journey engine) never emits SSML tags', () => {
  const rawStory = '# Title\n\nIt was *impossible*—truly (an aside)... "The end," she said.\n\nThe End';
  const plain = convertStoryToPlainText(rawStory);
  assert.ok(!/<[a-z]/i.test(plain), `expected no tags, got: ${plain}`);
  assert.match(plain, /Title\.{2,}/);
  assert.match(plain, /impossible/);
});
