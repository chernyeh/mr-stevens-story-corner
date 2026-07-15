'use strict';

/**
 * storytellerSsml.js
 *
 * Converts raw Markdown story text into SSML tuned for the "Master
 * Storyteller" cadence (deliberate pauses, theatrical emphasis, wry
 * asides, pitch-shifted dialogue) on Google Cloud Text-to-Speech voices.
 *
 * ── Engine note (read before wiring this into a pipeline) ──────────────────
 * Google's Journey voices historically do NOT support SSML tags — they only
 * accept plain `text` input and infer pacing from punctuation. Feeding them
 * the markup this module produces would make them read tag names aloud
 * ("prosody pitch plus two st...") instead of pausing. `convertStoryToSsml`
 * therefore targets Neural2 and Studio (which fully honor <prosody>,
 * <break>, and <emphasis>). For Journey, call `convertStoryToPlainText`
 * instead, which renders the same structural decisions (titles, asides,
 * dialogue, "The End") as punctuation-based pacing cues with no tags.
 */

const HIGH_PITCH_WORDS = new Set(['squeaked', 'cried', 'child', 'goblin']);
const LOW_PITCH_WORDS = new Set(['rumbled', 'growled', 'giant', 'old']);

// How many characters of narration on either side of a quote to scan for
// dialogue-tag keywords (e.g. `"Stop!" the goblin squeaked.`).
const DIALOGUE_CONTEXT_WINDOW = 60;

const TITLE_HASH_RE = /^#{1,6}\s*(.+)$/;
const TITLE_CHAPTER_RE = /^chapter\b.*$/i;
const END_RE = /^(the end|fin)[.!]?$/i;
// Matches both straight and curly double-quote pairs — LLM-generated stories
// arrive with either style.
const QUOTE_RE = /["“]([^"“”]*)["”]/g;

/** Escape XML special characters. Must run before any SSML tags are injected. */
function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Classify the pitch treatment for a line of dialogue from its surrounding narration. */
function classifyDialogue(context) {
  const words = context.toLowerCase().match(/[a-z']+/g) || [];
  if (words.some((w) => HIGH_PITCH_WORDS.has(w))) return 'high';
  if (words.some((w) => LOW_PITCH_WORDS.has(w))) return 'low';
  return 'neutral';
}

function wrapDialogue(quoteText, pitchClass) {
  if (pitchClass === 'high') return `<prosody pitch="+2st" rate="fast">${quoteText}</prosody>`;
  if (pitchClass === 'low') return `<prosody pitch="-3st" rate="slow">${quoteText}</prosody>`;
  return `<prosody pitch="+1st">${quoteText}</prosody>`;
}

/**
 * Wrap every double-quoted span in a pitch/rate <prosody> tag. Classification
 * is scored against the paragraph BEFORE any other markup is injected, so the
 * keyword window always measures real narrative words rather than tags.
 */
function processDialogue(paragraph) {
  const matches = [...paragraph.matchAll(QUOTE_RE)];
  if (matches.length === 0) return paragraph;

  let result = '';
  let cursor = 0;
  for (const m of matches) {
    const start = m.index;
    const end = start + m[0].length;
    const before = paragraph.slice(Math.max(0, start - DIALOGUE_CONTEXT_WINDOW), start);
    const after = paragraph.slice(end, end + DIALOGUE_CONTEXT_WINDOW);
    const pitchClass = classifyDialogue(`${before} ${after}`);
    result += paragraph.slice(cursor, start) + wrapDialogue(m[0], pitchClass);
    cursor = end;
  }
  return result + paragraph.slice(cursor);
}

/** Apply all inline theatrical transformations to one ordinary paragraph of narration. */
function processParagraph(paragraph) {
  let text = escapeXml(paragraph);
  text = text.replace(/\s*\n\s*/g, ' '); // soft line-wraps inside a paragraph -> single space
  text = processDialogue(text);
  text = text.replace(/\.\.\.|…/g, '<break time="800ms"/>');
  text = text.replace(/--|—/g, '<break time="600ms"/>');
  text = text.replace(/\*([^*\n]+?)\*/g, '<emphasis level="strong">$1</emphasis>');
  text = text.replace(/\(([^()]*)\)/g, '<prosody pitch="-1st" volume="-4dB">($1)</prosody>');
  return text;
}

/** Split raw text into blank-line-delimited blocks (paragraphs / headings / the ending line). */
function splitBlocks(storyText) {
  const normalized = storyText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];
  return normalized
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/**
 * Convert raw Markdown story text into a complete `<speak>...</speak>` SSML
 * document for Google Cloud's Neural2 / Studio voices.
 *
 * Supported Markdown/plaintext conventions:
 *   - `# Heading` or a line starting with "Chapter" -> slow, authoritative title
 *   - blank line between paragraphs                -> 1.2s pacing pause
 *   - `—` or `--`                                   -> 600ms hanging pause
 *   - `...`                                         -> 800ms trailing pause
 *   - `*word*`                                      -> strong emphasis
 *   - `(aside)`                                     -> hushed, lowered aside
 *   - `"dialogue"`                                  -> pitch-shifted by nearby keyword
 *   - a final line of "The End" or "Fin"            -> maximum gravity close
 *
 * @param {string} storyText Raw story text.
 * @returns {string} A `<speak>...</speak>` SSML string.
 */
function convertStoryToSsml(storyText) {
  if (!storyText || !storyText.trim()) return '<speak></speak>';

  const blocks = splitBlocks(storyText);
  const rendered = [];

  for (const block of blocks) {
    const isSingleLine = !block.includes('\n');
    const hashMatch = isSingleLine ? block.match(TITLE_HASH_RE) : null;
    const isChapter = isSingleLine && !hashMatch && TITLE_CHAPTER_RE.test(block);
    const endMatch = isSingleLine ? block.match(END_RE) : null;

    if (hashMatch || isChapter) {
      const titleText = escapeXml(hashMatch ? hashMatch[1] : block);
      rendered.push({
        kind: 'title',
        ssml: `<prosody rate="slow" pitch="-2st">${titleText}</prosody><break time="1.5s"/>`,
      });
    } else if (endMatch) {
      const words = endMatch[1]
        .replace(/[.!]$/, '')
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
      let endSsml;
      if (words.length === 2) {
        // "The End": lift "The" slightly (suspended, expectant), hang, then
        // let "End." fall and settle — the finality contour of a storyteller.
        const [first, second] = words.map(escapeXml);
        endSsml =
          `<break time="2.0s"/><prosody rate="x-slow" volume="-2dB">` +
          `<prosody pitch="+1st">${first}</prosody><break time="400ms"/>` +
          `<prosody pitch="-4st">${second}.</prosody></prosody>`;
      } else {
        endSsml = `<break time="2.0s"/><prosody rate="x-slow" pitch="-3st" volume="-2dB">${escapeXml(words.join(' '))}.</prosody>`;
      }
      rendered.push({ kind: 'end', ssml: endSsml });
    } else {
      rendered.push({ kind: 'paragraph', ssml: processParagraph(block) });
    }
  }

  let body = '';
  rendered.forEach((item, i) => {
    if (i > 0) {
      const prevKind = rendered[i - 1].kind;
      // A title bakes in its own trailing break; an ending bakes in its own
      // leading break. Skip the generic pacing pause so breaks never double up.
      if (prevKind !== 'title' && item.kind !== 'end') {
        body += '<break time="1.2s"/>';
      }
    }
    body += item.ssml;
  });

  return `<speak>${body}</speak>`;
}

/**
 * Journey-safe counterpart of {@link convertStoryToSsml}. Journey voices
 * reject SSML tags, so this renders the same structural decisions as plain
 * text with punctuation-based pacing instead of markup.
 *
 * @param {string} storyText Raw story text.
 * @returns {string} Plain text with pacing/emphasis conveyed via punctuation.
 */
function convertStoryToPlainText(storyText) {
  if (!storyText || !storyText.trim()) return '';

  const blocks = splitBlocks(storyText);
  const rendered = [];

  for (const block of blocks) {
    const isSingleLine = !block.includes('\n');
    const hashMatch = isSingleLine ? block.match(TITLE_HASH_RE) : null;
    const isChapter = isSingleLine && !hashMatch && TITLE_CHAPTER_RE.test(block);
    const endMatch = isSingleLine ? block.match(END_RE) : null;

    if (hashMatch || isChapter) {
      rendered.push((hashMatch ? hashMatch[1] : block) + '..........');
    } else if (endMatch) {
      // Ellipsis suspends the first word on a hanging tone; the full stop
      // gives the last word a settled, downward close.
      const words = endMatch[1]
        .replace(/[.!]$/, '')
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
      rendered.push(words.join('...  ') + '.');
    } else {
      let text = block.replace(/\s*\n\s*/g, ' ');
      text = text.replace(/\.\.\.|…/g, '......  ');
      text = text.replace(/--|—/g, ',....  ');
      text = text.replace(/\*([^*\n]+?)\*/g, '$1');
      text = text.replace(/\(([^()]*)\)/g, ',  ($1),  ');
      rendered.push(text);
    }
  }

  return rendered.join('............        ');
}

module.exports = {
  convertStoryToSsml,
  convertStoryToPlainText,
  // Alias matching the exact signature name requested in the spec.
  convert_story_to_ssml: convertStoryToSsml,
};
