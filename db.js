// db.js
//
// The data access layer, backed by Supabase's hosted Postgres (see
// supabase/schema.sql for the tables). There are no user accounts -
// the teacher is gated by a shared passcode (see server.js) and
// students just type a name, same as the original version of this
// app - Supabase here is purely durable storage, not an auth system.
//
// Every function here is async and talks to Postgres through the
// Supabase JS client, using the SERVICE ROLE key - meaning the
// Express server is the only thing that ever touches the database
// directly. The browser never sees a Supabase key at all, it only
// ever talks to our own /api/* routes.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in your .env file.\n' +
    'Create a Supabase project, run supabase/schema.sql in its SQL editor,\n' +
    'then copy Project Settings -> API -> Project URL and service_role key into .env.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }, // this client is server-side only, never a browser session
});

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------------
// Row <-> app-object mapping. Postgres columns are snake_case; the
// rest of the app stays camelCase.
// ---------------------------------------------------------------------

function quizFromRow(row, questionRows = []) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description || '',
    hidePinyin: row.hide_pinyin,
    timeLimitSeconds: row.time_limit_seconds,
    allowRetakes: row.allow_retakes,
    createdAt: row.created_at,
    questions: questionRows
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(questionFromRow),
  };
}

function questionFromRow(row) {
  const base = {
    id: row.id,
    type: row.type || 'multiple_choice',
    question: row.question,
    questionMeaning: row.question_meaning || undefined,
    points: Number(row.points),
  };
  if (base.type === 'sentence_reorder') {
    // `options` holds the chunks in their CORRECT order for this
    // type - see supabase/schema.sql. Shuffling for display happens
    // only in toStudentView() in server.js, never here. `alt_orders`
    // (if any) holds additional accepted chunk-index orderings - see
    // validateAltOrders() in server.js for how those are built.
    return { ...base, chunks: row.options, altOrders: row.alt_orders || undefined };
  }
  return {
    ...base,
    options: row.options,
    optionMeanings: row.option_meanings || undefined,
    answer: row.answer,
  };
}

function attemptFromRow(row) {
  return {
    id: row.id,
    quizId: row.quiz_id,
    studentName: row.student_name,
    answers: row.answers || {},
    answerOrder: row.answer_order || [],
    accuracyScore: row.accuracy_score === null ? null : Number(row.accuracy_score),
    xpScore: row.xp_score === null ? null : Number(row.xp_score),
    longestStreak: row.longest_streak,
    title: row.title || null,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
  };
}

// ---------------------------------------------------------------------
// Quizzes + questions
// ---------------------------------------------------------------------

async function createQuiz(quiz) {
  unwrap(
    await supabase.from('quizzes').insert({
      id: quiz.id,
      code: quiz.code,
      title: quiz.title,
      description: quiz.description,
      hide_pinyin: quiz.hidePinyin,
      time_limit_seconds: quiz.timeLimitSeconds,
      allow_retakes: quiz.allowRetakes,
    })
  );
  const questionRows = quiz.questions.map((q, i) => ({
    id: q.id,
    quiz_id: quiz.id,
    position: i,
    type: q.type || 'multiple_choice',
    question: q.question,
    question_meaning: q.questionMeaning || null,
    options: q.type === 'sentence_reorder' ? q.chunks : q.options,
    option_meanings: q.optionMeanings || null,
    answer: q.type === 'sentence_reorder' ? null : q.answer,
    alt_orders: q.type === 'sentence_reorder' ? (q.altOrders || null) : null,
    points: q.points,
  }));

  // These are two separate inserts, not one transaction - if the
  // second one fails, the quiz row from the first would otherwise be
  // left behind with a working join code and zero questions, which
  // crashes the student page rather than failing loudly at creation
  // time. Clean up on any failure here instead of leaving that ghost
  // quiz around.
  try {
    unwrap(await supabase.from('questions').insert(questionRows));
  } catch (err) {
    await supabase.from('quizzes').delete().eq('id', quiz.id);
    throw err;
  }
  return getQuizById(quiz.id);
}

// Was previously an N+1 query pattern - a `for` loop over every quiz
// row, each iteration separately COUNT-ing that one quiz's questions
// and attempts (2 round trips per quiz, one quiz at a time, so 10
// quizzes meant sitting through roughly 20 sequential round trips
// before the dashboard could render). This is what made "Your
// quizzes" feel slow to load - not Supabase itself being slow, just
// far too many small back-and-forth requests to it.
//
// Fixed by fetching every question's and every attempt's quiz_id in
// ONE query each (both in parallel with the quiz list itself, so 3
// requests total no matter how many quizzes exist) and counting them
// in memory. Scales fine for a classroom tool's data volumes; if this
// project ever has thousands of questions/attempts, a database-side
// count(*) ... group by quiz_id query would be the next step, but
// that needs a Postgres view or RPC function since plain PostgREST
// `select` can't group-and-count on its own.
async function listQuizzes() {
  const [quizzes, questionRows, attemptRows] = await Promise.all([
    supabase.from('quizzes').select('*').order('created_at', { ascending: false }).then(unwrap),
    supabase.from('questions').select('quiz_id').then(unwrap),
    supabase.from('attempts').select('quiz_id').then(unwrap),
  ]);

  const questionCounts = {};
  questionRows.forEach((r) => { questionCounts[r.quiz_id] = (questionCounts[r.quiz_id] || 0) + 1; });
  const attemptCounts = {};
  attemptRows.forEach((r) => { attemptCounts[r.quiz_id] = (attemptCounts[r.quiz_id] || 0) + 1; });

  return quizzes.map((row) => ({
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    questionCount: questionCounts[row.id] || 0,
    attemptCount: attemptCounts[row.id] || 0,
  }));
}

async function getQuizById(id) {
  // The quiz row and its questions don't depend on each other, so
  // fetch them at the same time instead of one after another - this
  // alone roughly halves the latency of every quiz read, which
  // matters a lot given how often it's called (every answer check).
  const [quizRow, questionRows] = await Promise.all([
    supabase.from('quizzes').select('*').eq('id', id).maybeSingle().then(unwrap),
    supabase.from('questions').select('*').eq('quiz_id', id).then(unwrap),
  ]);
  if (!quizRow) return null;
  return quizFromRow(quizRow, questionRows);
}

async function findQuizByCode(code) {
  const quizRow = unwrap(await supabase.from('quizzes').select('*').eq('code', code).maybeSingle());
  if (!quizRow) return null;
  const questionRows = unwrap(await supabase.from('questions').select('*').eq('quiz_id', quizRow.id));
  return quizFromRow(quizRow, questionRows);
}

// Overwrites the editable fields of existing questions (text, options,
// correct answer, or reorder chunks) without touching their id,
// position, or points - used by the teacher's "edit questions" page.
async function updateQuestions(quizId, questions) {
  await Promise.all(questions.map((q) => {
    const patch = {
      question: q.question,
      question_meaning: q.questionMeaning || null,
      options: q.type === 'sentence_reorder' ? q.chunks : q.options,
      option_meanings: q.optionMeanings || null,
      answer: q.type === 'sentence_reorder' ? null : q.answer,
      alt_orders: q.type === 'sentence_reorder' ? (q.altOrders || null) : null,
    };
    return supabase.from('questions').update(patch).eq('id', q.id).eq('quiz_id', quizId).then(unwrap);
  }));
  return getQuizById(quizId);
}

async function deleteQuiz(id) {
  // questions and attempts cascade-delete via the foreign keys in schema.sql
  unwrap(await supabase.from('quizzes').delete().eq('id', id));
}

async function updateQuizSettings(id, { hidePinyin, timeLimitSeconds, allowRetakes }) {
  const patch = {};
  if (typeof hidePinyin === 'boolean') patch.hide_pinyin = hidePinyin;
  if (typeof timeLimitSeconds === 'number' && timeLimitSeconds >= 0) patch.time_limit_seconds = Math.round(timeLimitSeconds);
  if (typeof allowRetakes === 'boolean') patch.allow_retakes = allowRetakes;
  if (Object.keys(patch).length === 0) return getQuizById(id);
  unwrap(await supabase.from('quizzes').update(patch).eq('id', id));
  return getQuizById(id);
}

// ---------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------

async function createAttempt(attempt) {
  unwrap(
    await supabase.from('attempts').insert({
      id: attempt.id,
      quiz_id: attempt.quizId,
      student_name: attempt.studentName,
      answers: {},
      answer_order: [],
    })
  );
  return getAttemptById(attempt.id);
}

async function getAttemptById(id) {
  const row = unwrap(await supabase.from('attempts').select('*').eq('id', id).maybeSingle());
  return row ? attemptFromRow(row) : null;
}

async function hasCompletedAttempt(quizId, studentName) {
  const rows = unwrap(
    await supabase
      .from('attempts')
      .select('id')
      .eq('quiz_id', quizId)
      .not('submitted_at', 'is', null)
      .ilike('student_name', studentName)
      .limit(1)
  );
  return rows.length > 0;
}

// Records one answer immediately (for the instant right/wrong check
// and streak animation) without finalizing the attempt. Merges into
// the existing answers/answer_order jsonb rather than replacing them.
async function recordAnswer(attemptId, questionId, given) {
  const current = unwrap(
    await supabase.from('attempts').select('answers, answer_order, submitted_at').eq('id', attemptId).maybeSingle()
  );
  if (!current) return null;
  if (current.submitted_at) return 'already_submitted';

  const answers = { ...(current.answers || {}), [questionId]: given };
  const answerOrder = (current.answer_order || []).includes(questionId)
    ? current.answer_order
    : [...(current.answer_order || []), questionId];

  unwrap(
    await supabase.from('attempts').update({ answers, answer_order: answerOrder }).eq('id', attemptId)
  );
  return 'ok';
}

// Merges any final answers in, marks the attempt submitted, and
// writes the computed scores + fun title. `scored` is the result of
// recomputeScore() in server.js - this function just persists it.
async function finalizeAttempt(attemptId, mergedAnswers, mergedOrder, scored, title) {
  unwrap(
    await supabase
      .from('attempts')
      .update({
        answers: mergedAnswers,
        answer_order: mergedOrder,
        submitted_at: new Date().toISOString(),
        accuracy_score: scored.accuracyScore,
        xp_score: scored.xpScore,
        longest_streak: scored.longestStreak,
        title,
      })
      .eq('id', attemptId)
  );
  return getAttemptById(attemptId);
}

async function listAttemptsByQuiz(quizId) {
  const rows = unwrap(
    await supabase
      .from('attempts')
      .select('*')
      .eq('quiz_id', quizId)
      .order('started_at', { ascending: false })
  );
  return rows.map(attemptFromRow);
}

// ---------------------------------------------------------------------
// TTS audio cache - see the /api/tts route in server.js. Keyed by the
// exact text that was spoken, so "你" and "你好" are separate entries.
// ---------------------------------------------------------------------

async function getCachedTts(textKey) {
  const row = unwrap(
    await supabase.from('tts_cache').select('audio_base64').eq('text_key', textKey).maybeSingle()
  );
  return row ? row.audio_base64 : null;
}

// Upsert, not insert - two students triggering the same brand-new
// word at nearly the same moment would otherwise race to insert the
// same primary key and one of them would fail with a duplicate-key
// error.
async function saveCachedTts(textKey, audioBase64) {
  unwrap(await supabase.from('tts_cache').upsert({ text_key: textKey, audio_base64: audioBase64 }));
}

module.exports = {
  createQuiz,
  listQuizzes,
  getQuizById,
  findQuizByCode,
  deleteQuiz,
  updateQuizSettings,
  updateQuestions,
  createAttempt,
  getAttemptById,
  hasCompletedAttempt,
  recordAnswer,
  finalizeAttempt,
  listAttemptsByQuiz,
  getCachedTts,
  saveCachedTts,
};
