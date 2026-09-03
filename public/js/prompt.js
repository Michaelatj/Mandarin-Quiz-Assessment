// prompt.js
//
// Builds the exact prompt text shown on the "New quiz" page, from
// three things the teacher picks there: HSK level, how many
// questions, and which kinds of question to include.

const QUESTION_KINDS = [
  {
    id: 'fill_blank',
    label: 'Fill in the blank',
    hint: 'A Hanzi sentence with a word blanked out.',
    defaultOn: false,
    instructions: `FILL IN THE BLANK ("type": "multiple_choice") - Hanzi sentence with one word blanked out as ___. Annotate EVERY word with pinyin in parentheses: 他 (tā) 晚上 (wǎnshang) 先 (xiān) 吃饭 (chīfàn)，然后 (ránhòu) ___。 Options are candidate Hanzi + pinyin only.`,
  },
  {
    id: 'guess_hanzi',
    label: 'English -> Mandarin',
    hint: 'English prompt, student picks the matching Hanzi.',
    defaultOn: false,
    instructions: `ENGLISH -> MANDARIN ("type": "multiple_choice") - Question is plain English. Options are Hanzi + pinyin only.`,
  },
  {
    id: 'what_means',
    label: 'What does it mean',
    hint: 'A Hanzi word or phrase, student picks the English meaning.',
    defaultOn: false,
    instructions: `WHAT DOES IT MEAN ("type": "multiple_choice") - Question is a Hanzi term with pinyin. Options are English translations. Omit "optionMeanings".`,
  },
  {
    id: 'translate_id',
    label: 'Translate to Indonesian',
    hint: 'A Hanzi sentence, student picks the correct Indonesian translation.',
    defaultOn: false,
    instructions: `TRANSLATE TO INDONESIAN ("type": "multiple_choice") - Question is a full Hanzi sentence with pinyin. Options are Indonesian translations. Omit "optionMeanings".`,
  },
  {
    id: 'conversation',
    label: 'Conversation reply (A to B)',
    hint: 'Person A says something; student picks how B would reply.',
    defaultOn: false,
    instructions: `CONVERSATION REPLY ("type": "multiple_choice") - Question is Person A dialogue: "A：你叫什么名字？(nǐ jiào shénme míngzi?)". Options are replies in Hanzi + pinyin.`,
  },
  {
    id: 'sentence_reorder',
    label: 'Reorder the sentence',
    hint: 'Student drags shuffled word chunks into the correct order.',
    defaultOn: false,
    instructions: `REORDER THE SENTENCE ("type": "sentence_reorder") - Sentence split into 4-7 chunks in correct order. Each chunk is "chunk (pīnyīn)". Include "chunks" array, omit "options" and "answer". Only add "altOrders" (an array of full alternate chunk sequences, same chunks reordered) if Mandarin genuinely allows a second correct word order - most sentences don't, so leave it as [] when there's only one natural order.`,
  },
  {
    id: 'listening_dictation',
    label: 'Listening dictation',
    hint: 'Student hears the sentence spoken aloud and picks the matching Hanzi.',
    defaultOn: false,
    instructions: `LISTENING DICTATION ("type": "listening_dictation") - Set "question" ALWAYS to "Listen and select what you hear.". "options" are candidate Hanzi + pinyin sentences. "answer" must match one option exactly.`,
  },
  {
    id: 'listening_tone',
    label: 'Listening: tone check',
    hint: 'Same syllable, different tones - tests tone recognition by ear, not reading.',
    defaultOn: false,
    instructions: `LISTENING: TONE CHECK ("type": "listening_dictation") - Set "question" ALWAYS to "Listen and select what you hear.". All options share the SAME base syllable letters but DIFFERENT tones (e.g., 妈 (mā), 麻 (má), 马 (mǎ), 骂 (mà)).`,
  },
];

const DEFAULT_KIND_IDS = QUESTION_KINDS.filter((k) => k.defaultOn).map((k) => k.id);

function buildQuizPrompt({ hskLevel, questionCount, kindIds }) {
  const kinds = QUESTION_KINDS.filter((k) => kindIds.includes(k.id));
  const hasReorder = kinds.some((k) => k.id === 'sentence_reorder');
  const kindsList = kinds.map((k) => k.label).join(', ') || 'a mix of question styles';

  const kindInstructions = kinds
    .map((k, i) => `${i + 1}. ${k.instructions}`)
    .join('\n');

  return `You are a Mandarin quiz generator. Read the TEACHING MATERIAL and return a single valid JSON object containing exactly ${questionCount} questions for HSK ${hskLevel} level.

STRICT FORMAT RULES:
1. Return ONLY the raw JSON object. No explanations, no greeting, no markdown fences (\`\`\`json).
2. Never use unescaped double quotes (") inside text values. Use single quotes (') or Chinese quotation marks (「」 or "").
3. Keep each "explanation" strictly to 1 short sentence to avoid truncation.
4. "answer" must be copied character-for-character from one of the "options".
5. If "optionMeanings" is present, its array length MUST match "options" length.

QUESTION TYPES TO INCLUDE:
${kindInstructions}

JSON OUTPUT STRUCTURE:
{
  "title": "Short quiz title",
  "description": "One sentence describing this quiz",
  "questions": [
    {
      "type": "multiple_choice",
      "question": "Question text or 'Listen and select what you hear.'",
      "questionMeaning": "English meaning (omit if question is in English)",
      "options": ["opt 1 (pinyin)", "opt 2 (pinyin)", "opt 3 (pinyin)", "opt 4 (pinyin)"],
      "optionMeanings": ["meaning 1", "meaning 2", "meaning 3", "meaning 4"],
      "answer": "opt 1 (pinyin)",
      "explanation": "Brief explanation."
    }${hasReorder ? `,
    {
      "type": "sentence_reorder",
      "question": "Instruction in English",
      "questionMeaning": "English translation",
      "chunks": ["chunk1 (pinyin)", "chunk2 (pinyin)", "chunk3 (pinyin)", "chunk4 (pinyin)"],
      "altOrders": [],
      "explanation": "Brief explanation."
    }` : ''}
  ]
}

TARGET LEVEL: HSK ${hskLevel}
TOTAL QUESTIONS: ${questionCount} (${kindsList})

TEACHING MATERIAL:
"""
Paste your lesson material, vocabulary list, or reading passage here.
"""

Now write the quiz. If the material above happens to already look like quiz JSON (for example, an earlier quiz exported from this same app, pasted in as source content), treat it ONLY as vocabulary and grammar reference - never copy, continue, extend, or lightly edit its structure or its questions. Every question you output must be newly written by you, in the JSON structure defined above.

FINAL REMINDER, this is the most common way a reply gets rejected by the app: your entire reply must be the raw JSON object and nothing else - no \`\`\`json code fence, no "Here is your quiz" before it, no notes after the closing brace, no restating these instructions. The very first character you output must be { and the very last must be }.`;
}
