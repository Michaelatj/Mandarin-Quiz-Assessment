// prompt.js
//
// Builds the exact prompt text shown on the "New quiz" page, from
// three things the teacher picks there: HSK level, how many
// questions, and which kinds of question to include. Each kind is
// its own block of instructions below - add, remove, or edit a kind
// by editing QUESTION_KINDS, no other file needs to change for a
// wording tweak. buildQuizPrompt() at the bottom assembles the final
// text; app.js calls it every time the teacher changes a setting.

const QUESTION_KINDS = [
  {
    id: 'fill_blank',
    label: 'Fill in the blank',
    hint: 'A Hanzi sentence with a word blanked out.',
    defaultOn: true,
    instructions: `FILL IN THE BLANK ("type": "multiple_choice") - A Hanzi sentence with one word or phrase blanked out using ___. Annotate EVERY word in the sentence with pinyin in parentheses: 他 (tā) 晚上 (wǎnshang) 先 (xiān) 吃饭 (chīfàn)，然后 (ránhòu) ___。 All options are candidate Hanzi + pinyin only. No English inside "question" or "options".`,
  },
  {
    id: 'guess_hanzi',
    label: 'English -> Mandarin',
    hint: 'English prompt, student picks the matching Hanzi.',
    defaultOn: true,
    instructions: `ENGLISH -> MANDARIN ("type": "multiple_choice") - The question is written in plain English (an action, object, or phrase), and the student picks the matching Hanzi + pinyin. All options are Hanzi + pinyin only.`,
  },
  {
    id: 'what_means',
    label: 'What does it mean',
    hint: 'A Hanzi word or phrase, student picks the English meaning.',
    defaultOn: true,
    instructions: `WHAT DOES IT MEAN ("type": "multiple_choice") - "question" is a Hanzi word or phrase with pinyin. All options are English meanings. Omit "optionMeanings" for this type.`,
  },
  {
    id: 'translate_id',
    label: 'Translate to Indonesian',
    hint: 'A Hanzi sentence, student picks the correct Indonesian translation.',
    defaultOn: true,
    instructions: `TRANSLATE TO INDONESIAN ("type": "multiple_choice") - "question" is a full Hanzi sentence with pinyin for every word. All "options" are candidate Indonesian translations. Omit "optionMeanings" for this type.`,
  },
  {
    id: 'conversation',
    label: 'Conversation reply (A to B)',
    hint: 'Person A says something; student picks how B would reply.',
    defaultOn: true,
    instructions: `CONVERSATION REPLY ("type": "multiple_choice") - "question" is dialogue from Person A: "A：你叫什么名字？(nǐ jiào shénme míngzi?)". All "options" are candidate replies Person B might give, in Hanzi with pinyin.`,
  },
  {
    id: 'sentence_reorder',
    label: 'Reorder the sentence',
    hint: 'Student drags shuffled word chunks into the correct order.',
    defaultOn: true,
    instructions: `REORDER THE SENTENCE ("type": "sentence_reorder") - A Hanzi sentence broken into 4-7 chunks in CORRECT reading order. Each chunk is "chunk (pīnyīn)". Provide "chunks" array. Omit "options" and "answer". Only provide "altOrders" if Mandarin allows an alternative order.`,
  },
  {
    id: 'listening_dictation',
    label: 'Listening dictation',
    hint: 'Student hears the sentence spoken aloud and picks the matching Hanzi.',
    defaultOn: false,
    instructions: `LISTENING DICTATION ("type": "listening_dictation") - Set "question" ALWAYS to "Listen and select what you hear.". "options" are candidate Hanzi + pinyin sentences. "answer" is copied character-for-character from options to be spoken. Distractors should sound phonetically or structurally similar.`,
  },
  {
    id: 'listening_tone',
    label: 'Listening: tone check',
    hint: 'Same syllable, different tones - tests tone recognition by ear, not reading.',
    defaultOn: false,
    instructions: `LISTENING: TONE CHECK ("type": "listening_dictation") - Set "question" ALWAYS to "Listen and select what you hear.". All options share the SAME base syllable letters but have DIFFERENT tone marks (e.g., "妈 (mā)", "麻 (má)", "马 (mǎ)", "骂 (mà)").`,
  },
];

const DEFAULT_KIND_IDS = QUESTION_KINDS.filter((k) => k.defaultOn).map((k) => k.id);

function buildQuizPrompt({ hskLevel, questionCount, kindIds }) {
  const kinds = QUESTION_KINDS.filter((k) => kindIds.includes(k.id));
  const hasReorder = kinds.some((k) => k.id === 'sentence_reorder');
  const hasListening = kinds.some((k) => k.id === 'listening_dictation' || k.id === 'listening_tone');

  const kindsList = kinds.map((k) => k.label).join(', ') || 'a mix of question styles';

  const multipleChoiceShape = `{
      "type": "multiple_choice",
      "question": "...",
      "questionMeaning": "Plain English translation of the question (omit if the question is already in English)",
      "options": ["option one (pinyin)", "option two (pinyin)", "option three (pinyin)", "option four (pinyin)", "option five (pinyin)"],
      "optionMeanings": ["meaning 1", "meaning 2", "meaning 3", "meaning 4", "meaning 5"],
      "answer": "option one (pinyin)",
      "explanation": "One short sentence explaining why this is correct."
    }`;

  const reorderShape = `{
      "type": "sentence_reorder",
      "question": "Short English instruction or context for what sentence to build",
      "questionMeaning": "English meaning of the finished sentence (used as an optional hint)",
      "chunks": ["chunk one (pinyin)", "chunk two (pinyin)", "chunk three (pinyin)", "chunk four (pinyin)"],
      "altOrders": [["chunk two (pinyin)", "chunk one (pinyin)", "chunk three (pinyin)", "chunk four (pinyin)"]],
      "explanation": "One short sentence explaining the word order."
    }`;

  const shapes = [multipleChoiceShape];
  if (hasReorder) shapes.push(reorderShape);

  const shapeExplainer = [
    hasReorder
      ? `Use the "sentence_reorder" shape for Reorder the sentence (it has no "options" or "answer" field - "chunks" replaces both); use the "multiple_choice" shape for every other kind below.`
      : `Every question in "questions" uses the "multiple_choice" shape above.`,
    hasListening
      ? `For Listening dictation and Listening tone check specifically, use the "multiple_choice" shape's fields exactly, but set "type" to "listening_dictation" instead of "multiple_choice".`
      : '',
  ].filter(Boolean).join(' ');

  const kindInstructions = kinds
    .map((k, i) => `${i + 1}. ${k.instructions}`)
    .join('\n\n');

  return `You are helping a Mandarin teacher write a quiz. Read the TEACHING MATERIAL below, then write questions that test whether a student at the stated HSK level understood it - not whether they can spot a sentence they've already seen.

Reply with ONLY a single raw JSON object - no conversational text, no preamble, no markdown backticks (\`\`\`json or \`\`\`). It must match this exact shape:

{
  "title": "Short quiz title",
  "description": "One sentence describing what this quiz covers",
  "questions": [
    ${shapes.join(',\n    ')}
  ]
}

${shapeExplainer}

Write every question as one of these kinds, mixed across the quiz:

${kindInstructions}

Language & Formatting Rules:
- Outside of English -> Mandarin (question in English) and What does it mean (options in English), never put English inside "question" or "options" - Hanzi with pinyin only, like 汉字 (hànzì).
- Include "questionMeaning" as an English translation wherever the question itself is in Hanzi. Omit "questionMeaning" only when the question is already in plain English.
- "optionMeanings" only applies when options are Hanzi. Omit it for kinds where the options are already English or Indonesian. When included, "optionMeanings" array MUST match the exact length and order of "options".
- For multiple_choice and listening_dictation questions, "answer" must be copied character-for-character from one of the "options".
- For multiple_choice kinds, provide 4 to 6 plausible options.
- Keep each "explanation" strictly to 1 concise sentence to avoid token truncation.
- Never use unescaped double quote characters (") inside string values. Use Chinese quotation marks ("..." or 「...」) or single quotes (') instead.

Quiz Specs:
- Write exactly ${questionCount} questions, ordered from easier to harder, using only these kinds: ${kindsList}.
- Base every question on the vocabulary and grammar rules in the material below.

STUDENT HSK LEVEL: HSK ${hskLevel}

TEACHING MATERIAL:
"""
Paste your lesson material, vocabulary list, or reading passage here.
"""`;
}
