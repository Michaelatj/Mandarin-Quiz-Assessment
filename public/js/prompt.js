// prompt.js
//
// Builds the exact prompt text shown on the "New quiz" page, from
// three things the teacher picks there: HSK level, how many
// questions, and which kinds of question to include. Each kind is
// its own block of instructions below - add, remove, or edit a kind
// by editing QUESTION_KINDS, no other file needs to change for a
// wording tweak. buildQuizPrompt() at the bottom assembles the final
// text; app.js calls it every time the teacher changes a setting.

// Every kind still produces "multiple_choice" questions EXCEPT
// sentence_reorder, which has its own JSON shape (see the shape
// block inside buildQuizPrompt) and its own drag-to-order UI in the
// app - everything else renders as ordinary answer buttons.
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
    instructions: `ENGLISH -> MANDARIN ("type": "multiple_choice") - the question is written in plain English (an action, object, or phrase), and the student picks the correct Hanzi + pinyin for it. "question" is English here. All options are Hanzi + pinyin only, no English inside them. Phrase the English prompt in your own words rather than lifting a translation line straight from the material.
Example: question "doing homework", options include "做功课 (zuò gōngkè)" as the answer plus distractors like "看电视 (kàn diànshì)", "去学校 (qù xuéxiào)", "吃早饭 (chī zǎofàn)".`,
  },
  {
    id: 'what_means',
    label: 'What does it mean',
    hint: 'A Hanzi word or phrase, student picks the English meaning.',
    defaultOn: true,
    instructions: `WHAT DOES IT MEAN ("type": "multiple_choice") - "question" is a Hanzi word or phrase with pinyin, and the student picks its correct English meaning. Copying the word or phrase directly from the material is fine here - this type tests recognition of the term itself. All options here are English. Do not include "optionMeanings" for this type - the options already are the meanings.
Example: question "做功课 (zuò gōngkè)", options "doing homework", "watching TV", "going to school", "eating breakfast".`,
  },
  {
    id: 'translate_id',
    label: 'Translate to Indonesian',
    hint: 'A Hanzi sentence, student picks the correct Indonesian translation.',
    defaultOn: true,
    instructions: `TRANSLATE TO INDONESIAN ("type": "multiple_choice") - "question" is a full Hanzi sentence with pinyin (write a NEW sentence, same rule as Fill in the blank - don't copy one from the material verbatim), pinyin-annotated word by word the same way. All "options" are candidate Indonesian (Bahasa Indonesia) translations of that sentence - one exactly correct, the rest plausible near-misses (wrong tense, wrong object, a swapped word) rather than random unrelated sentences. Do not include "optionMeanings" for this type.
Example: question "我 (wǒ) 喜欢 (xǐhuan) 学习 (xuéxí) 中文 (zhōngwén)。", options "Saya suka belajar bahasa Mandarin." (correct), "Saya suka mengajar bahasa Mandarin.", "Saya tidak suka belajar bahasa Mandarin.", "Saya suka belajar bahasa Inggris."`,
  },
  {
    id: 'conversation',
    label: 'Conversation reply (A to B)',
    hint: 'Person A says something; student picks how B would reply.',
    defaultOn: true,
    instructions: `CONVERSATION REPLY ("type": "multiple_choice") - "question" is one line of dialogue from Person A, written as "A：" followed by a Hanzi sentence with pinyin (e.g. "A：你叫什么名字？(nǐ jiào shénme míngzi?)"). All "options" are candidate replies Person B might give, in Hanzi with pinyin - one that's a natural, correct reply, the others each wrong for a clear reason (answers a different question, wrong grammar, doesn't make sense as a reply). Base the exchange on a real pattern from the material (asking someone's name, ordering food, asking the time, etc.) but write your own line, not a copy.
Example: question "A：你想喝什么？(nǐ xiǎng hē shénme?)", options include "我想喝茶。(wǒ xiǎng hē chá.)" as the answer plus distractors like "我叫王明。(wǒ jiào wáng míng.)" (answers "what's your name" instead), "我不想去。(wǒ bù xiǎng qù.)" (doesn't answer what was asked).`,
  },
  {
    id: 'sentence_reorder',
    label: 'Reorder the sentence',
    hint: 'Student drags shuffled word chunks into the correct order.',
    defaultOn: true,
    instructions: `REORDER THE SENTENCE ("type": "sentence_reorder", NOT "multiple_choice" - this kind has its own JSON shape, shown separately below) - give a correct Hanzi sentence broken into 4-7 word/phrase chunks, listed in their CORRECT reading order (the app shuffles them for the student - never shuffle them yourself). Each chunk is one word or short phrase with its pinyin, formatted exactly like an option elsewhere: "chunk (pīnyīn)". Write a NEW sentence, not one copied verbatim from the material, that uses a grammar point or vocabulary word the material taught.
Example: for the sentence 我明天要去学校 (I have to go to school tomorrow), chunks (in correct order) would be: ["我 (wǒ)", "明天 (míngtiān)", "要 (yào)", "去 (qù)", "学校 (xuéxiào)"].`,
  },
];

const DEFAULT_KIND_IDS = QUESTION_KINDS.filter((k) => k.defaultOn).map((k) => k.id);

function buildQuizPrompt({ hskLevel, questionCount, kindIds }) {
  const kinds = QUESTION_KINDS.filter((k) => kindIds.includes(k.id));
  const hasReorder = kinds.some((k) => k.id === 'sentence_reorder');
  const otherKinds = kinds.filter((k) => k.id !== 'sentence_reorder');

  const kindsList = kinds.map((k) => k.label).join(', ') || 'a mix of question styles';

  const multipleChoiceShape = `{
      "type": "multiple_choice",
      "question": "...",
      "questionMeaning": "Plain English translation of the question (omit if the question is already in English)",
      "options": ["option one", "option two", "option three", "option four", "option five", "option six"],
      "optionMeanings": ["meaning of option 1", "meaning of option 2", "meaning of option 3", "meaning of option 4", "meaning of option 5", "meaning of option 6"],
      "answer": "option one",
      "explanation": "One short sentence on why this is correct"
    }`;

  const reorderShape = `{
      "type": "sentence_reorder",
      "question": "Short English instruction or context for what sentence to build",
      "questionMeaning": "English meaning of the finished sentence (used as an optional hint)",
      "chunks": ["chunk one (pinyin)", "chunk two (pinyin)", "chunk three (pinyin)", "chunk four (pinyin)"],
      "explanation": "One short sentence on why this order is correct"
    }`;

  const shapes = [multipleChoiceShape];
  if (hasReorder) shapes.push(reorderShape);

  const shapeExplainer = hasReorder
    ? `Every question in "questions" is one of the JSON shapes above depending on its kind: use the "multiple_choice" shape for every kind below except Reorder the sentence, which uses the "sentence_reorder" shape instead (it has no "options" or "answer" field - "chunks" replaces both).`
    : `Every question in "questions" uses the "multiple_choice" shape above.`;

  const kindInstructions = kinds
    .map((k, i) => `${i + 1}. ${k.instructions}`)
    .join('\n\n');

  return `You are helping a Mandarin teacher write a quiz. Read the TEACHING MATERIAL below, then write questions that test whether a student at the stated HSK level understood it - not whether they can spot a sentence they've already seen.

Reply with ONLY a single JSON object - no explanation, no markdown code fences, nothing before or after it. It must match this exact shape:

{
  "title": "Short quiz title",
  "description": "One sentence describing what this quiz covers",
  "questions": [
    ${shapes.join(',\n    ')}
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
"""`;
}
