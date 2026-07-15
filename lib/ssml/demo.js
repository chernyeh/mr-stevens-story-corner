'use strict';

// Run with: node lib/ssml/demo.js
// Prints a sample story's raw Markdown next to the SSML it converts to.

const { convertStoryToSsml, convertStoryToPlainText } = require('./storytellerSsml');

const rawStory = `# The Glass Mountain

Once upon a time there lived a girl who dreamed of *impossible* things.

She walked for three days—resting only when the moon rose (though she was rarely tired)—until she reached the mountain.

"Who dares climb my slopes?" the giant rumbled, his voice shaking the stones.

"I do!" the goblin squeaked, hopping from behind a rock.

The girl merely said, "I have come a long way..."

The End`;

console.log('── RAW STORY (Markdown) ──────────────────────────────────');
console.log(rawStory);

console.log('\n── SSML (Neural2 / Studio) ───────────────────────────────');
console.log(convertStoryToSsml(rawStory));

console.log('\n── Plain text (Journey — no SSML support) ────────────────');
console.log(convertStoryToPlainText(rawStory));
