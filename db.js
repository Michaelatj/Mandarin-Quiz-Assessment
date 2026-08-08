// db.js
//
// The data access layer, now backed by Supabase's hosted Postgres
// instead of a local JSON file (see supabase/schema.sql for the
// tables). Every function here is async and talks to Postgres
// through the Supabase JS client, using the SERVICE ROLE key -
// meaning the Express server is the only thing that ever touches the
// database directly. The browser never sees a Supabase key at all,
// it only ever talks to our own /api/* routes.
//
// Passwords are hashed with bcrypt before they're ever written here -
// see the signup/login routes in server.js. This file just stores
// and reads whatever hash it's given.

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
// rest of the app (and the JSON shapes the frontend already expects)
// stay camelCase, same as they were with the old JSON file.
// ---------------------------------------------------------------------

function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    xpTotal: Number(row.xp_total),
    createdAt: row.created_at,
  };
}

function quizFromRow(row, questionRows = []) {
  return {
    id: row.id,
    teacherId: row.teacher_id,
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
  return {
    id: row.id,
    type: 'multiple_choice',
    question: row.question,
    questionMeaning: row.question_meaning || undefined,
    options: row.options,
    optionMeanings: row.option_meanings || undefined,
    answer: row.answer,
    points: Number(row.points),
  };
}

function attemptFromRow(row) {
  return {
    id: row.id,
    quizId: row.quiz_id,
    studentId: row.student_id,
    studentName: row.student_name,
    answers: row.answers || {},
    answerOrder: row.answer_order || [],
    accuracyScore: row.accuracy_score === null ? null : Number(row.accuracy_score),
    xpScore: row.xp_score === null ? null : Number(row.xp_score),
    longestStreak: row.longest_streak,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
  };
}

// ---------------------------------------------------------------------
// Profiles (teacher + student accounts)
// ---------------------------------------------------------------------

async function createProfile({ id, username, passwordHash, role }) {
  const row = unwrap(
    await supabase
      .from('profiles')
      .insert({ id, username, password_hash: passwordHash, role })
      .select()
      .single()
  );
  return profileFromRow(row);
}

async function findProfileByUsername(username) {
  const row = unwrap(
    await supabase
      .from('profiles')
      .select('*')
      .ilike('username', username) // case-insensitive - "Wei" and "wei" are the same account
      .maybeSingle()
  );
  return profileFromRow(row);
}

async function getProfileById(id) {
  const row = unwrap(await supabase.from('profiles').select('*').eq('id', id).maybeSingle());
  return profileFromRow(row);
}

// Adds `amount` XP to a student's running total and returns the new
// total. Read-modify-write rather than a raw SQL increment, which is
// fine at this app's scale (one update per quiz submission).
async function addXp(profileId, amount) {
  const current = unwrap(
    await supabase.from('profiles').select('xp_total').eq('id', profileId).single()
  );
  const newTotal = Number(current.xp_total) + amount;
  unwrap(
    await supabase.from('profiles').update({ xp_total: newTotal }).eq('id', profileId)
  );
  return newTotal;
}

// ---------------------------------------------------------------------
// Quizzes + questions
// ---------------------------------------------------------------------

async function createQuiz(quiz) {
  unwrap(
    await supabase.from('quizzes').insert({
      id: quiz.id,
      teacher_id: quiz.teacherId,
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
    question: q.question,
    question_meaning: q.questionMeaning || null,
    options: q.options,
    option_meanings: q.optionMeanings || null,
    answer: q.answer,
    points: q.points,
  }));
  unwrap(await supabase.from('questions').insert(questionRows));
  return getQuizById(quiz.id);
}

async function listQuizzesByTeacher(teacherId) {
  const quizzes = unwrap(
    await supabase
      .from('quizzes')
      .select('*')
      .eq('teacher_id', teacherId)
      .order('created_at', { ascending: false })
  );
  const results = [];
  for (const row of quizzes) {
    const [{ count: questionCount }, { count: attemptCount }] = await Promise.all([
      supabase.from('questions').select('*', { count: 'exact', head: true }).eq('quiz_id', row.id),
      supabase.from('attempts').select('*', { count: 'exact', head: true }).eq('quiz_id', row.id),
    ]);
    results.push({
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description,
      createdAt: row.created_at,
      questionCount: questionCount || 0,
      attemptCount: attemptCount || 0,
    });
  }
  return results;
}

async function getQuizById(id) {
  const quizRow = unwrap(await supabase.from('quizzes').select('*').eq('id', id).maybeSingle());
  if (!quizRow) return null;
  const questionRows = unwrap(await supabase.from('questions').select('*').eq('quiz_id', id));
  return quizFromRow(quizRow, questionRows);
}

async function findQuizByCode(code) {
  const quizRow = unwrap(await supabase.from('quizzes').select('*').eq('code', code).maybeSingle());
  if (!quizRow) return null;
  const questionRows = unwrap(await supabase.from('questions').select('*').eq('quiz_id', quizRow.id));
  return quizFromRow(quizRow, questionRows);
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
      student_id: attempt.studentId || null,
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

async function hasCompletedAttempt(quizId, studentNameOrId) {
  let query = supabase.from('attempts').select('id').eq('quiz_id', quizId).not('submitted_at', 'is', null);
  query = typeof studentNameOrId === 'object'
    ? query.eq('student_id', studentNameOrId.studentId)
    : query.ilike('student_name', studentNameOrId);
  const rows = unwrap(await query.limit(1));
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
// writes the computed scores. `scored` is the result of
// recomputeScore() in server.js - this function just persists it.
async function finalizeAttempt(attemptId, mergedAnswers, mergedOrder, scored) {
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

module.exports = {
  createProfile,
  findProfileByUsername,
  getProfileById,
  addXp,
  createQuiz,
  listQuizzesByTeacher,
  getQuizById,
  findQuizByCode,
  deleteQuiz,
  updateQuizSettings,
  createAttempt,
  getAttemptById,
  hasCompletedAttempt,
  recordAnswer,
  finalizeAttempt,
  listAttemptsByQuiz,
};
