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
  defaultOn: true,
  instructions: `FILL IN THE BLANK ("type": "multiple_choice") - a Hanzi sentence with exactly one word or phrase replaced by the blank marker "___". The blank must contain ONLY "___" and NOTHING ELSE. NEVER put the correct answer, pinyin, or any other text inside or immediately after the blank. For example, "我 (wǒ) ___ 数学 (shùxué) 作业 (zuòyè)。" is correct; "我 (wǒ) ___ (méi zuò wán) 数学 (shùxué) 作业 (zuòyè)。" is WRONG because the answer is revealed in the question.
All options are candidate Hanzi + pinyin to fill the blank. Options use Hanzi + pinyin only. The question itself uses Hanzi + pinyin for every visible word or short phrase EXCEPT the blank marker "___", which must never have pinyin or an answer attached to it.
PINYIN IS REQUIRED FOR EVERY VISIBLE HANZI WORD OR SHORT PHRASE IN THE SENTENCE, but NEVER for "___". Annotate the sentence word by word, leaving the blank completely empty.
IMPORTANT: the correct answer must appear ONLY in the "options" and "answer" fields, never in the "question" field. The question must give the student no visual clue that reveals which option is correct.
IMPORTANT: do not copy a sentence straight out of the material. Write a NEW sentence of your own, in a different context, that uses the same word or grammar point the material taught.
Example: if the material taught 做功课 (zuò gōngkè) in the sentence "我每天做功课 (wǒ měitiān zuò gōngkè)", don't reuse that sentence - write something like "他 (tā) 晚上 (wǎnshang) 一般 (yìbān) 先 (xiān) 吃饭 (chīfàn)，然后 (ránhòu) ___。" instead, with every visible word pinyin-annotated and the blank left completely empty.`,
},
  {
    id: 'guess_hanzi',
    label: 'English -> Mandarin',
    hint: 'English prompt, student picks the matching Hanzi.',
    defaultOn: true,
    instructions: `ENGLISH -> MANDARIN ("type": "multiple_choice") - Question is plain English. Options are Hanzi + pinyin only.`,
  },
  {
    id: 'what_means',
    label: 'What does it mean',
    hint: 'A Hanzi word or phrase, student picks the English meaning.',
    defaultOn: true,
    instructions: `WHAT DOES IT MEAN ("type": "multiple_choice") - Question is a Hanzi term with pinyin. Options are English translations. Omit "optionMeanings".`,
  },
  {
    id: 'translate_id',
    label: 'Translate to Indonesian',
    hint: 'A Hanzi sentence, student picks the correct Indonesian translation.',
    defaultOn: true,
    instructions: `TRANSLATE TO INDONESIAN ("type": "multiple_choice") - Question is a full Hanzi sentence with pinyin. Options are Indonesian translations. Omit "optionMeanings".`,
  },
  {
    id: 'conversation',
    label: 'Conversation reply (A to B)',
    hint: 'Person A says something; student picks how B would reply.',
    defaultOn: true,
    instructions: `CONVERSATION REPLY ("type": "multiple_choice") - Question is Person A dialogue: "A：你叫什么名字？(nǐ jiào shénme míngzi?)". Options are replies in Hanzi + pinyin.`,
  },
  {
    id: 'sentence_reorder',
    label: 'Reorder the sentence',
    hint: 'Student drags shuffled word chunks into the correct order.',
    defaultOn: true,
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

${shapeExplainer}

Write every question as one of these kinds, mixed across the quiz (roughly evenly across whichever kinds are listed, more of whichever best fits the material):

${kindInstructions}

Other language rules - read carefully:
- For Fill in the blank questions, "___" is a protected blank marker: NEVER append pinyin, Hanzi, the correct answer, parentheses, or any other text to it. The blank must remain exactly "___" in the question. The missing word or phrase may appear only in "options" and "answer".
- Outside of English -> Mandarin (question in English) and What does it mean (options in English), never put English inside "question" or "options" - Hanzi with pinyin only, like 汉字 (hànzì).
- Include "questionMeaning" as an English translation wherever the question itself is in Hanzi - the app hides this behind a hint button the student can choose to tap. Omit "questionMeaning" only when the question is already in plain English.
- "optionMeanings" only applies to multiple_choice kinds whose options are Hanzi (Fill in the blank, English -> Mandarin, Conversation reply, Reorder does not use it at all). Omit it for kinds where the options are already English or Indonesian.
- For multiple_choice questions, "answer" must be copied exactly, character-for-character, from one of the "options".
- Stay within the vocabulary and grammar of the stated HSK level (or slightly below it) for everything except the one concept the material is actually teaching. Do not casually introduce harder words in the distractor options or wrong chunks.

Options and chunks - give more than the app shows at once:
- For multiple_choice kinds, give 5 or 6 options: one correct answer plus 4 or 5 distractors, all plausible, all at the stated HSK level. The app randomly shows the student only 4 of these each time, so different attempts see different wrong answers.
- Every distractor needs a real reason a student might pick it (a near-meaning word, a similar-sounding word, a common mix-up, or - for Conversation reply - a reply to a different question) - not random unrelated content.
- For Reorder the sentence, give the chunks in their correct order - the app shuffles them itself before showing the student.
- If "optionMeanings" is included, it must be the same length as "options", same order.

Valid JSON rules - read carefully, this matters:
- Never use a straight double quote character (") anywhere inside a text value, including inside the pinyin parentheses or an English aside. A stray " inside a string breaks the JSON and the whole quiz gets rejected.
- If you need to show quoted speech inside a question, option, or meaning, use the Chinese quotation marks "..." or 「...」 instead of "...". Better yet, just rephrase without quoting anything.
- Do not use backslashes in any text value.
- Before answering, mentally check that every value is a normal quoted string with no stray " or \\ characters inside it.

Other rules:
- Write exactly ${questionCount} questions, ordered from easier to harder, using only these kinds: ${kindsList}.
- Base every question only on the vocabulary, grammar, and facts in the material below - don't invent anything that wasn't in it, but do write original example sentences rather than reusing the material's own sentences verbatim.
- Keep each question focused on one idea, and give it enough surrounding context (a full sentence or a short exchange, not an isolated word) that only one reading of it makes sense - a question a student could answer correctly by luck, without knowing the material, needs more context.
- Don't repeat the same word, phrase, or grammar point as the main point of more than one question. If you're tempted to write two questions that would test the same thing, cover a second vocabulary word or pattern from the material instead, or drop one and write a harder one on something not yet covered. A student re-answering the "same" question twice with different wording is not variety.

Before you output anything, silently re-read your own draft question by question and check each one against this list, fixing anything that fails before writing the final answer:
- Exactly one option (or exactly one chunk order) is correct - could a fair-minded native speaker argue for a second option as also correct, given the question's context? If so, either add context that rules it out or rewrite the distractor so it's clearly wrong.
- No two questions in the set test the same word or point in different clothing.
- Every distractor is wrong for a specific, checkable reason, not just "different."
- The "answer" string is copied character-for-character from "options" (for multiple_choice), and pinyin annotation is present everywhere this kind requires it.
Do this check silently - do not show your work, do not explain your reasoning, and do not mention that you double-checked. Output only the final corrected JSON object as instructed above.

STUDENT HSK LEVEL: HSK ${hskLevel}

TEACHING MATERIAL:
"""
Paste your lesson material, vocabulary list, or reading passage here.
"""

Now write the quiz. If the material above happens to already look like quiz JSON (for example, an earlier quiz exported from this same app, pasted in as source content), treat it ONLY as vocabulary and grammar reference - never copy, continue, extend, or lightly edit its structure or its questions. Every question you output must be newly written by you, in the JSON structure defined above.

FINAL REMINDER, this is the most common way a reply gets rejected by the app: your entire reply must be the raw JSON object and nothing else - no \`\`\`json code fence, no "Here is your quiz" before it, no notes after the closing brace, no restating these instructions. The very first character you output must be { and the very last must be }.`;
}
