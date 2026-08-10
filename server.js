// server.js
//
// One Express app that serves both the API and the static frontend
// (the public/ folder). Data lives in Supabase Postgres (see db.js
// and supabase/schema.sql) - purely as durable storage, not as an
// auth system. There are no user accounts: the teacher is gated by
// one shared passcode (TEACHER_PASSCODE in .env, same as the very
// first version of this app), and students just type a name.

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const db = require('./db');
const { computeTitle } = require('./titles');

const app = express();
const PORT = process.env.PORT || 3000;
const TEACHER_PASSCODE = process.env.TEACHER_PASSCODE;

if (!TEACHER_PASSCODE) {
  console.error('Missing TEACHER_PASSCODE in your .env file. Set it to any passcode only you know.');
  process.exit(1);
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Express 4 does not catch rejected promises from an async route
// handler on its own - an unhandled rejection there crashes the
// ENTIRE process, taking down every other student and teacher
// connected at the time. This wraps every handler passed to
// app.get/post/patch/delete so a Supabase hiccup becomes a normal
// error response instead - see the error-handling middleware at the
// bottom of this file, which turns the passed-through error into
// JSON.
['get', 'post', 'patch', 'delete'].forEach((method) => {
  const original = app[method].bind(app);
  app[method] = (routePath, ...handlers) => original(
    routePath,
    ...handlers.map((h) => (h.constructor.name === 'AsyncFunction'
      ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)
      : h))
  );
});

function requireTeacher(req, res, next) {
  const key = req.get('x-teacher-key');
  if (key !== TEACHER_PASSCODE) return res.status(401).json({ error: 'Incorrect passcode.' });
  next();
}

app.post('/api/login', (req, res) => {
  const { passcode } = req.body || {};
  if (passcode !== TEACHER_PASSCODE) return res.status(401).json({ error: 'Incorrect passcode.' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Quiz JSON validation
//
// This is the shape teachers paste in from ChatGPT / Gemini / Grok /
// Claude etc. Keep it forgiving about extra fields, strict about the
// fields that matter for grading.
// ---------------------------------------------------------------------

const QUESTION_TYPES = ['multiple_choice', 'sentence_reorder'];

function validateQuiz(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return ['The quiz must be a JSON object.'];
  }
  if (!payload.title || typeof payload.title !== 'string') {
    errors.push('Missing a "title" (string).');
  }
  if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
    errors.push('Missing a "questions" array with at least one question.');
    return errors;
  }
  payload.questions.forEach((q, i) => {
    const label = `Question ${i + 1}`;
    if (!q || typeof q !== 'object') {
      errors.push(`${label}: must be an object.`);
      return;
    }
    if (!q.question || typeof q.question !== 'string') {
      errors.push(`${label}: missing "question" text.`);
    }
    const type = q.type || 'multiple_choice';
    if (!QUESTION_TYPES.includes(type)) {
      errors.push(`${label}: "type" must be "multiple_choice" or "sentence_reorder".`);
      return;
    }

    if (type === 'sentence_reorder') {
      if (!Array.isArray(q.chunks) || q.chunks.length < 3) {
        errors.push(`${label}: needs a "chunks" array with at least 3 pieces.`);
      }
    } else {
      if (!Array.isArray(q.options) || q.options.length < 4) {
        errors.push(`${label}: needs an "options" array with at least 4 choices (aim for 5-6 so the app can rotate distractors).`);
      } else if (q.answer === undefined || !q.options.includes(q.answer)) {
        errors.push(`${label}: "answer" must exactly match one of the "options".`);
      } else if (q.optionMeanings !== undefined) {
        if (!Array.isArray(q.optionMeanings) || q.optionMeanings.length !== q.options.length) {
          errors.push(`${label}: "optionMeanings" must be an array the same length as "options".`);
        }
      }
    }
    if (q.questionMeaning !== undefined && typeof q.questionMeaning !== 'string') {
      errors.push(`${label}: "questionMeaning" must be a string.`);
    }
  });
  return errors;
}

function normalizeQuiz(payload) {
  return {
    id: nanoid(10),
    code: crypto.randomInt(100000, 999999).toString(), // 6-digit join code, easy for students to type
    title: payload.title.trim(),
    description: (payload.description || '').trim(),
    hidePinyin: false,
    timeLimitSeconds: 0, // 0 = no timer. When set, this is a single
    // countdown for the WHOLE quiz (not per question) - see
    // toStudentView and recomputeScore below.
    allowRetakes: true,
    questions: payload.questions.map((q) => {
      const type = q.type === 'sentence_reorder' ? 'sentence_reorder' : 'multiple_choice';
      const base = {
        id: nanoid(8),
        type,
        question: q.question.trim(),
        questionMeaning: q.questionMeaning ? String(q.questionMeaning).trim() : undefined,
        points: typeof q.points === 'number' ? q.points : 1,
      };
      if (type === 'sentence_reorder') {
        return { ...base, chunks: q.chunks.map((c) => String(c).trim()) };
      }
      return {
        ...base,
        options: q.options,
        optionMeanings: Array.isArray(q.optionMeanings) ? q.optionMeanings : undefined,
        answer: q.answer,
      };
    }),
  };
}

// Pinyin in this app always appears as a parenthetical right after
// Hanzi, e.g. 汉字 (hànzì). Matches only when everything inside the
// parentheses looks like pinyin (Latin letters, tone-marked vowels,
// spaces, apostrophes, hyphens) - if there's a Chinese character or
// anything else in there, it's left alone rather than guessed at.
const PINYIN_PAREN = /\s*\([a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü' -]+\)/gi;

function stripPinyin(text) {
  if (typeof text !== 'string') return text;
  return text.replace(PINYIN_PAREN, '').trim();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickDisplayOptions(q, maxCount = 4) {
  const pairs = q.options.map((opt, i) => ({ opt, meaning: q.optionMeanings ? q.optionMeanings[i] : undefined }));
  const correct = pairs.find((p) => p.opt === q.answer);
  const wrong = shuffle(pairs.filter((p) => p.opt !== q.answer)).slice(0, Math.max(0, maxCount - 1));
  const chosen = shuffle(correct ? [correct, ...wrong] : wrong);
  return {
    options: chosen.map((p) => p.opt),
    optionMeanings: q.optionMeanings ? chosen.map((p) => p.meaning) : undefined,
  };
}

// Strip answers before sending a quiz to a student, randomize question
// and option order (see pickDisplayOptions), and strip pinyin here on
// the server when the teacher has hidePinyin turned on - this applies
// uniformly to every question type, including sentence_reorder's
// chunks, so the teacher's one hidePinyin setting genuinely covers
// every kind of question, not just multiple choice.
function toStudentView(quiz) {
  const hide = !!quiz.hidePinyin;
  return {
    id: quiz.id,
    code: quiz.code,
    title: quiz.title,
    description: quiz.description,
    timeLimitSeconds: quiz.timeLimitSeconds || 0,
    questions: shuffle(quiz.questions).map((q) => {
      if (q.type === 'sentence_reorder') {
        // Each chunk's `id` is its index in the CORRECT order - the
        // client only ever sees the shuffled display order, but
        // submits back an array of these ids, so checking correctness
        // is just "does the submitted id order equal [0,1,2,...]".
        // The correct order itself is never sent to the student.
        const shuffledChunks = shuffle(
          q.chunks.map((text, id) => ({ id, text: hide ? stripPinyin(text) : text }))
        );
        return {
          id: q.id,
          type: q.type,
          question: hide ? stripPinyin(q.question) : q.question,
          questionMeaning: q.questionMeaning,
          chunks: shuffledChunks,
        };
      }
      const picked = pickDisplayOptions(q);
      return {
        id: q.id,
        type: q.type,
        question: hide ? stripPinyin(q.question) : q.question,
        questionMeaning: q.questionMeaning,
        options: hide ? picked.options.map(stripPinyin) : picked.options,
        optionMeanings: picked.optionMeanings,
      };
    }),
  };
}

// ---------------------------------------------------------------------
// Teacher routes
// ---------------------------------------------------------------------

app.get('/api/quizzes', requireTeacher, async (req, res) => {
  res.json(await db.listQuizzes());
});

app.post('/api/quizzes', requireTeacher, async (req, res) => {
  const errors = validateQuiz(req.body);
  if (errors.length) {
    return res.status(400).json({ error: 'That JSON does not match the expected quiz format.', details: errors });
  }
  const quiz = await db.createQuiz(normalizeQuiz(req.body));
  res.status(201).json(quiz);
});

app.get('/api/quizzes/:id', requireTeacher, async (req, res) => {
  const quiz = await db.getQuizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  res.json(quiz);
});

app.delete('/api/quizzes/:id', requireTeacher, async (req, res) => {
  const quiz = await db.getQuizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  await db.deleteQuiz(quiz.id);
  res.json({ ok: true });
});

// Per-quiz settings a teacher can flip any time, including for a quiz
// students are already using - the next student to join just gets the
// updated view.
app.patch('/api/quizzes/:id/settings', requireTeacher, async (req, res) => {
  const quiz = await db.getQuizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  const { hidePinyin, timeLimitSeconds, allowRetakes } = req.body || {};
  res.json(await db.updateQuizSettings(quiz.id, { hidePinyin, timeLimitSeconds, allowRetakes }));
});

app.get('/api/quizzes/:id/results', requireTeacher, async (req, res) => {
  const quiz = await db.getQuizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  const attempts = await db.listAttemptsByQuiz(quiz.id);
  res.json({ quiz, attempts });
});

// ---------------------------------------------------------------------
// Student routes - anonymous, just a name + the quiz's join code.
// ---------------------------------------------------------------------

app.get('/api/join/:code', async (req, res) => {
  const quiz = await db.findQuizByCode(req.params.code);
  if (!quiz) return res.status(404).json({ error: 'No quiz found for that code. Double-check it with your teacher.' });
  res.json({ title: quiz.title, description: quiz.description, questionCount: quiz.questions.length });
});

app.post('/api/join/:code', async (req, res) => {
  const { studentName } = req.body || {};
  const name = (studentName || '').trim();
  if (!name) return res.status(400).json({ error: 'Enter your name.' });

  const quiz = await db.findQuizByCode(req.params.code);
  if (!quiz) return res.status(404).json({ error: 'No quiz found for that code.' });

  if (quiz.allowRetakes === false) {
    const alreadyDone = await db.hasCompletedAttempt(quiz.id, name);
    if (alreadyDone) {
      return res.status(409).json({ error: 'You already completed this quiz. Ask your teacher if you need another attempt.' });
    }
  }

  const attempt = await db.createAttempt({ id: nanoid(12), quizId: quiz.id, studentName: name });
  res.status(201).json({ attemptId: attempt.id, quiz: toStudentView(quiz) });
});

// Two numbers, two jobs:
//  - accuracyScore (0-100): correct/total, stable and comparable, for
//    the teacher's gradebook. Never affected by speed or streaks.
//  - xpScore: uncapped, playful - base points, +50% speed bonus at
//    most (tapering to +0% as the WHOLE-QUIZ timer runs out), plus a
//    streak bonus that grows with consecutive correct answers. Fed
//    into computeTitle() below for the fun label shown at the end -
//    this app has no accounts, so nothing here persists between
//    quizzes, it's all scoped to this one attempt.
// True for either question type: a plain string match for
// multiple_choice, or - for sentence_reorder - the submitted array of
// chunk ids equaling [0, 1, 2, ...] (each chunk's id IS its correct
// position, assigned in toStudentView; getting every id in ascending
// order means the student reconstructed the original sentence).
function isAnswerCorrect(q, value) {
  if (q.type === 'sentence_reorder') {
    const total = q.chunks.length;
    return Array.isArray(value) && value.length === total && value.every((id, idx) => id === idx);
  }
  return value === q.answer;
}

function recomputeScore(answers, answerOrderIn, quiz) {
  const limitMs = (quiz.timeLimitSeconds || 0) * 1000;
  const totalPoints = quiz.questions.reduce((sum, q) => sum + q.points, 0);

  let correctCount = 0;
  let xp = 0;
  let streak = 0;
  let longestStreak = 0;

  const order = answerOrderIn && answerOrderIn.length ? answerOrderIn : quiz.questions.map((q) => q.id);

  order.forEach((questionId) => {
    const q = quiz.questions.find((qq) => qq.id === questionId);
    const given = answers[questionId];
    if (!q || !given) { streak = 0; return; }

    const value = typeof given === 'object' ? given.value : given;
    const usedMeaning = typeof given === 'object' && given.usedMeaning === true;
    const answeredAtMs = typeof given === 'object' && typeof given.answeredAtMs === 'number' ? given.answeredAtMs : null;

    if (!isAnswerCorrect(q, value)) { streak = 0; return; }

    correctCount += 1;
    streak += 1;
    longestStreak = Math.max(longestStreak, streak);

    const base = usedMeaning ? q.points * 0.5 : q.points;
    let bonusMultiplier = 0;

    if (limitMs > 0 && answeredAtMs !== null) {
      const remainingMs = Math.max(0, limitMs - answeredAtMs);
      const speedFraction = Math.min(1, remainingMs / limitMs);
      bonusMultiplier += 0.5 * speedFraction; // up to +50% for answering early
    }
    // Streak bonus: +10% per consecutive correct answer beyond the
    // first two, capped at +50% (a streak of 5 or more).
    bonusMultiplier += Math.min(0.5, Math.max(0, streak - 2) * 0.1);

    xp += base + base * bonusMultiplier;
  });

  return {
    accuracyScore: totalPoints > 0 ? Math.round((correctCount / quiz.questions.length) * 100) : 0,
    xpScore: Math.round(xp * 100) / 100,
    longestStreak,
  };
}

// Immediate correctness check, called right after the student picks an
// option (or finishes arranging a sentence_reorder question) - this is
// what powers the on-screen streak animation while the quiz is still
// in progress. It records the answer (so a student who never hits
// "submit" isn't lost) but does NOT finalize the attempt - /submit
// below is still the source of truth.
app.post('/api/attempts/:attemptId/answer', async (req, res) => {
  const { questionId, value, usedMeaning, answeredAtMs } = req.body || {};
  if (!questionId) return res.status(400).json({ error: 'Missing questionId.' });

  const attempt = await db.getAttemptById(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found.' });
  const quiz = await db.getQuizById(attempt.quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  const q = quiz.questions.find((qq) => qq.id === questionId);
  if (!q) return res.status(404).json({ error: 'Question not found.' });

  const given = { value, usedMeaning: !!usedMeaning, answeredAtMs: typeof answeredAtMs === 'number' ? answeredAtMs : null };
  const outcome = await db.recordAnswer(attempt.id, questionId, given);
  if (outcome === 'already_submitted') return res.status(409).json({ error: 'This attempt was already submitted.' });

  res.json({ correct: isAnswerCorrect(q, value) });
});

app.post('/api/attempts/:attemptId/submit', async (req, res) => {
  const { answers } = req.body || {};
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Missing answers.' });
  }

  const attempt = await db.getAttemptById(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found.' });
  if (attempt.submittedAt) return res.status(409).json({ error: 'This attempt was already submitted.' });
  const quiz = await db.getQuizById(attempt.quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });

  // Merge rather than overwrite - most answers already arrived via
  // /answer as the student worked through the quiz; this just fills
  // in anything that request missed (e.g. a flaky connection).
  const mergedAnswers = { ...attempt.answers, ...answers };
  const mergedOrder = attempt.answerOrder.slice();
  Object.keys(answers).forEach((questionId) => {
    if (!mergedOrder.includes(questionId)) mergedOrder.push(questionId);
  });

  const scored = recomputeScore(mergedAnswers, mergedOrder, quiz);
  const title = computeTitle(scored.accuracyScore, scored.longestStreak, quiz.questions.length);
  await db.finalizeAttempt(attempt.id, mergedAnswers, mergedOrder, scored, title);

  const meaningUsedCount = Object.values(answers).filter((a) => a && typeof a === 'object' && a.usedMeaning).length;
  res.json({
    accuracyScore: scored.accuracyScore,
    xpScore: scored.xpScore,
    longestStreak: scored.longestStreak,
    title,
    meaningUsedCount,
  });
});

// Fallback to the SPA for any non-API route so deep links (e.g. a
// shared /?join=123456 link) still load the frontend.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catches anything the wrapper above passed to next(err) - a Supabase
// error, a bug, whatever. Must be registered last and take 4
// arguments (that's how Express recognizes an error handler).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

// Vercel runs this file as a serverless function - it imports
// `module.exports` and calls it as a (req, res) handler per request,
// it never runs this file with `node server.js` directly. Everywhere
// else (your own machine, Render, Railway) runs it exactly that way,
// so app.listen() only happens in that case.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Mandarin quiz app running at http://localhost:${PORT}`);
  });
}

module.exports = app;
