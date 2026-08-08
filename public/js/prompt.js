// prompt.js
//
// The exact prompt text shown on the "New quiz" page. This is a
// plain JS file - edit the text inside the backticks below with any
// text editor, save, and refresh the browser. No build step, no
// restart needed, nothing else in the app has to change.
//
// One rule if you edit it: keep the token {{HSK_LEVEL}} somewhere in
// the text. The HSK dropdown on the "New quiz" page swaps that token
// for whatever level the teacher picked right before copying. If you
// delete the token, the prompt still works, it just always shows
// whatever level you typed in its place.

const QUIZ_PROMPT_TEMPLATE = `You are helping a Mandarin teacher write a multiple-choice quiz. Read the TEACHING MATERIAL below, then write questions that test whether a student at the stated HSK level understood it - not whether they can spot a sentence they've already seen.

Reply with ONLY a single JSON object - no explanation, no markdown code fences, nothing before or after it. It must match this exact shape:

{
  "title": "Short quiz title",
  "description": "One sentence describing what this quiz covers",
  "questions": [
    {
      "type": "multiple_choice",
      "question": "问题写成汉字 (wèntí xiě chéng hànzì)",
      "questionMeaning": "Plain English translation of the question",
      "options": ["选项一 (xuǎnxiàng yī)", "选项二 (xuǎnxiàng èr)", "选项三 (xuǎnxiàng sān)", "选项四 (xuǎnxiàng sì)", "选项五 (xuǎnxiàng wǔ)", "选项六 (xuǎnxiàng liù)"],
      "optionMeanings": ["English meaning of option 1", "English meaning of option 2", "English meaning of option 3", "English meaning of option 4", "English meaning of option 5", "English meaning of option 6"],
      "answer": "选项一 (xuǎnxiàng yī)",
      "explanation": "One short sentence on why this is correct"
    }
  ]
}

Write every question as one of these three kinds, mixed across the quiz (roughly a third each, more of whichever kind best fits the material):

1. FILL IN THE BLANK - a Hanzi sentence with one word or phrase blanked out (use ___ for the blank). All options are candidate Hanzi + pinyin to fill the blank. Options and the question itself use ONLY Hanzi and pinyin - no English anywhere in "question" or "options".
   IMPORTANT: do not copy a sentence straight out of the material. Write a NEW sentence of your own, in a different context, that uses the same word or grammar point the material taught. The point is testing whether the student can use the word, not whether they memorized which sentence it appeared in.
   Example: if the material taught 做功课 (zuò gōngkè) in the sentence "我每天做功课", don't reuse that sentence - write something like "他晚上一般先吃饭，然后___。" instead, still testing the same word in a fresh situation.

2. GUESS THE HANZI - the question is written in plain English (an action, object, or phrase), and the student picks the correct Hanzi + pinyin for it. "question" is English here. All options are Hanzi + pinyin only, no English inside them. Phrase the English prompt in your own words rather than lifting a translation line straight from the material.
   Example: question "doing homework", options include "做功课 (zuò gōngkè)" as the answer plus distractors like "看电视 (kàn diànshì)", "去学校 (qù xuéxiào)", "吃早饭 (chī zǎofàn)".

3. WHAT DOES IT MEAN - "question" is a Hanzi word or phrase with pinyin, and the student picks its correct English meaning. Copying the word or phrase directly from the material is fine here - this type tests recognition of the term itself, not sentence construction. All options here are English, since this type is specifically testing comprehension of the Hanzi shown. Do not include "optionMeanings" for this type - the options already are the meanings.
   Example: question "做功课 (zuò gōngkè)", options "doing homework", "watching TV", "going to school", "eating breakfast".

Other language rules - read carefully:
- Outside of type 2 (question in English) and type 3 (options in English), never put English inside "question" or "options" - Hanzi with pinyin only, like 汉字 (hànzì).
- For types 1 and 2, include "questionMeaning" and "optionMeanings" as English translations - the app hides these behind a toggle the student can choose to turn on, so keep the Hanzi fields themselves pure.
- For type 3, omit "optionMeanings" (the options are already the meanings) but you may still include "questionMeaning" if useful.
- "answer" must be copied exactly, character-for-character, from one of the "options".
- Stay within the vocabulary and grammar of the stated HSK level (or slightly below it) for everything except the one concept the material is actually teaching. Do not casually introduce harder words in the distractor options.

Options - give more than the app shows at once:
- Give 5 or 6 options per question: one correct answer plus 4 or 5 distractors, all plausible, all at the stated HSK level. The app randomly shows the student only 4 of these each time (the correct one plus 3 random distractors), so different attempts see different wrong answers and can't just memorize "the 3rd option is always right."
- Every distractor needs a real reason a student might pick it (a near-meaning word, a similar-sounding word, a common mix-up) - not random unrelated words.
- If "optionMeanings" is included, it must be the same length as "options", same order.

Valid JSON rules - read carefully, this matters:
- Never use a straight double quote character (") anywhere inside a text value, including inside the pinyin parentheses or an English aside. A stray " inside a string breaks the JSON and the whole quiz gets rejected.
- If you need to show quoted speech inside a question, option, or meaning, use the Chinese quotation marks “...” or 「...」 instead of "...". Better yet, just rephrase without quoting anything.
- Do not use backslashes in any text value.
- Before answering, mentally check that every value is a normal quoted string with no stray " or \\ characters inside it.

Other rules:
- Every question is "multiple_choice".
- Write 8 to 12 questions, ordered from easier to harder.
- Base every question only on the vocabulary, grammar, and facts in the material below - don't invent anything that wasn't in it, but do write original example sentences (see rule 1) rather than reusing the material's own sentences verbatim.
- Keep each question focused on one idea.

STUDENT HSK LEVEL: HSK {{HSK_LEVEL}}

TEACHING MATERIAL:
"""
Paste your lesson material, vocabulary list, or reading passage here.
"""`;
