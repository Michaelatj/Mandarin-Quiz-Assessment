// server.js
//
// One Express app that serves both the API and the static frontend
// (the public/ folder). Data lives in Supabase Postgres (see db.js
// and supabase/schema.sql) instead of a local JSON file. Auth is our
// own username/password system - bcrypt-hashed passwords in the
// `profiles` table, our own signed JWT for sessions - not Supabase
// Auth, which is built around email addresses rather than usernames.

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const db = require('./db');
const { computeLevel } = require('./levels');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET in your .env file. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Express 4 does not catch rejected promises from an async route
// handler (or async middleware, like requireAuth below) on its own -
// an unhandled rejection there crashes the ENTIRE process, taking
// down every other student and teacher connected at the time. This
// wraps every handler passed to app.get/post/patch/delete so a
// Supabase hiccup becomes a normal error response instead - see the
// error-handling middleware at the bottom of this file, which turns
// the passed-through error into JSON.
['get', 'post', 'patch', 'delete'].forEach((method) => {
  const original = app[method].bind(app);
  app[method] = (routePath, ...handlers) => original(
    routePath,
    ...handlers.map((h) => (h.constructor.name === 'AsyncFunction'
      ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)
      : h))
  );
});

// ---------------------------------------------------------------------
// Auth
//
// Signup hashes the password with bcrypt and stores it in `profiles`.
// Login checks it and issues a JWT (7-day expiry) carrying { sub:
// profileId, role }. The browser stores that token in localStorage
// and sends it as `Authorization: Bearer <token>` on every request
// that needs it (see public/js/api.js). requireAuth() verifies the
// token and loads the profile fresh from the DB on every request,
// so a role change or a student's growing XP total is always current.
// ---------------------------------------------------------------------

const USERNAME_RE = /^[a-zA-Z0-9_\-. ]{3,40}$/;

function signToken(profile) {
  return jwt.sign({ sub: profile.id, role: profile.role }, JWT_SECRET, { expiresIn: '7d' });
}

function publicProfile(profile) {
  const level = computeLevel(profile.xpTotal);
  return { id: profile.id, username: profile.username, role: profile.role, xpTotal: profile.xpTotal, level };
}

function requireAuth(role) {
  return async (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not logged in.' });
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Your session expired. Please log in again.' });
    }
    const profile = await db.getProfileById(payload.sub);
    if (!profile) return res.status(401).json({ error: 'Account not found.' });
    if (role && profile.role !== role) return res.status(403).json({ error: `This action requires a ${role} account.` });
    req.profile = profile;
    next();
  };
}

app.post('/api/auth/signup', async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-40 characters (letters, numbers, spaces, - _ . only).' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (role !== 'teacher' && role !== 'student') {
    return res.status(400).json({ error: 'Role must be "teacher" or "student".' });
  }

  const existing = await db.findProfileByUsername(username);
  if (existing) return res.status(409).json({ error: 'That username is already taken.' });

  const passwordHash = await bcrypt.hash(password, 10);
  const profile = await db.createProfile({ id: crypto.randomUUID(), username: username.trim(), passwordHash, role });
  res.status(201).json({ token: signToken(profile), profile: publicProfile(profile) });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Enter a username and password.' });

  const profile = await db.findProfileByUsername(username.trim());
  if (!profile) return res.status(401).json({ error: 'Incorrect username or password.' });
  const ok = await bcrypt.compare(password, profile.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Incorrect username or password.' });

  res.json({ token: signToken(profile), profile: publicProfile(profile) });
});

app.get('/api/auth/me', requireAuth(), async (req, res) => {
  res.json({ profile: publicProfile(req.profile) });
});

// ---------------------------------------------------------------------
// Quiz JSON validation
//
// This is the shape teachers paste in from ChatGPT / Gemini / Grok /
// Claude etc. Keep it forgiving about extra fields, strict about the
// fields that matter for grading.
// ---------------------------------------------------------------------

const QUESTION_TYPES = ['multiple_choice'];

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
      errors.push(`${label}: only "multiple_choice" questions are supported.`);
    }
    if (!Array.isArray(q.options) || q.options.length < 4) {
      errors.push(`${label}: needs an "options" array with at least 4 choices (aim for 5-6 so the app can rotate distractors).`);
    } else if (q.answer === undefined || !q.options.includes(q.answer)) {
      errors.push(`${label}: "answer" must exactly match one of the "options".`);
    } else if (q.optionMeanings !== undefined) {
      if (!Array.isArray(q.optionMeanings) || q.optionMeanings.length !== q.options.length) {
        errors.push(`${label}: "optionMeanings" must be an array the same length as "options".`);
      }
    }
    if (q.questionMeaning !== undefined && typeof q.questionMeaning !== 'string') {
      errors.push(`${label}: "questionMeaning" must be a string.`);
    }
  });
  return errors;
}

function normalizeQuiz(payload, teacherId) {
  return {
    id: nanoid(10),
    teacherId,
    code: crypto.randomInt(100000, 999999).toString(), // 6-digit join code, easy for students to type
    title: payload.title.trim(),
    description: (payload.description || '').trim(),
    hidePinyin: false,
    timeLimitSeconds: 0, // 0 = no timer. When set, this is a single
    // countdown for the WHOLE quiz (not per question) - see
    // toStudentView and recomputeScore below.
    allowRetakes: true,
    questions: payload.questions.map((q) => ({
      id: nanoid(8),
      type: 'multiple_choice',
      question: q.question.trim(),
      questionMeaning: q.questionMeaning ? String(q.questionMeaning).trim() : undefined,
      options: q.options,
      optionMeanings: Array.isArray(q.optionMeanings) ? q.optionMeanings : undefined,
      answer: q.answer,
      points: typeof q.points === 'number' ? q.points : 1,
    })),
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
// the server when the teacher has hidePinyin turned on.
function toStudentView(quiz) {
  const hide = !!quiz.hidePinyin;
  return {
    id: quiz.id,
    code: quiz.code,
    title: quiz.title,
    description: quiz.description,
    timeLimitSeconds: quiz.timeLimitSeconds || 0,
    questions: shuffle(quiz.questions).map((q) => {
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

app.get('/api/quizzes', requireAuth('teacher'), async (req, res) => {
  res.json(await db.listQuizzesByTeacher(req.profile.id));
});

app.post('/api/quizzes', requireAuth('teacher'), async (req, res) => {
  const errors = validateQuiz(req.body);
  if (errors.length) {
    return res.status(400).json({ error: 'That JSON does not match the expected quiz format.', details: errors });
  }
  const quiz = await db.createQuiz(normalizeQuiz(req.body, req.profile.id));
  res.status(201).json(quiz);
});

async function loadOwnedQuiz(req, res) {
  const quiz = await db.getQuizById(req.params.id);
  if (!quiz || quiz.teacherId !== req.profile.id) {
    res.status(404).json({ error: 'Quiz not found.' });
    return null;
  }
  return quiz;
}

app.get('/api/quizzes/:id', requireAuth('teacher'), async (req, res) => {
  const quiz = await loadOwnedQuiz(req, res);
  if (quiz) res.json(quiz);
});

app.delete('/api/quizzes/:id', requireAuth('teacher'), async (req, res) => {
  const quiz = await loadOwnedQuiz(req, res);
  if (!quiz) return;
  await db.deleteQuiz(quiz.id);
  res.json({ ok: true });
});

// Per-quiz settings a teacher can flip any time, including for a quiz
// students are already using - the next student to join just gets the
// updated view.
app.patch('/api/quizzes/:id/settings', requireAuth('teacher'), async (req, res) => {
  const quiz = await loadOwnedQuiz(req, res);
  if (!quiz) return;
  const { hidePinyin, timeLimitSeconds, allowRetakes } = req.body || {};
  res.json(await db.updateQuizSettings(quiz.id, { hidePinyin, timeLimitSeconds, allowRetakes }));
});

app.get('/api/quizzes/:id/results', requireAuth('teacher'), async (req, res) => {
  const quiz = await loadOwnedQuiz(req, res);
  if (!quiz) return;
  const attempts = await db.listAttemptsByQuiz(quiz.id);
  // Attach each submitted student's current level, so the teacher
  // dashboard can show a badge next to their name.
  const withLevels = await Promise.all(
    attempts.map(async (a) => {
      if (!a.studentId) return a;
      const student = await db.getProfileById(a.studentId);
      return student ? { ...a, studentLevel: computeLevel(student.xpTotal) } : a;
    })
  );
  res.json({ quiz, attempts: withLevels });
});

// ---------------------------------------------------------------------
// Student routes - joining and taking a quiz requires a student
// account (see requireAuth('student') below), but the join CODE
// itself stays a simple 6-digit code, not a per-quiz invite link.
// ---------------------------------------------------------------------

app.get('/api/join/:code', async (req, res) => {
  const quiz = await db.findQuizByCode(req.params.code);
  if (!quiz) return res.status(404).json({ error: 'No quiz found for that code. Double-check it with your teacher.' });
  res.json({ title: quiz.title, description: quiz.description, questionCount: quiz.questions.length });
});

app.post('/api/join/:code', requireAuth('student'), async (req, res) => {
  const quiz = await db.findQuizByCode(req.params.code);
  if (!quiz) return res.status(404).json({ error: 'No quiz found for that code.' });

  if (quiz.allowRetakes === false) {
    const alreadyDone = await db.hasCompletedAttempt(quiz.id, { studentId: req.profile.id });
    if (alreadyDone) {
      return res.status(409).json({ error: 'You already completed this quiz. Ask your teacher if you need another attempt.' });
    }
  }

  const attempt = await db.createAttempt({
    id: nanoid(12),
    quizId: quiz.id,
    studentId: req.profile.id,
    studentName: req.profile.username,
  });

  res.status(201).json({ attemptId: attempt.id, quiz: toStudentView(quiz) });
});

// Two numbers, two jobs:
//  - accuracyScore (0-100): correct/total, stable and comparable, for
//    the teacher's gradebook. Never affected by speed or streaks.
//  - xpScore: uncapped, playful - base points, +50% speed bonus at
//    most (tapering to +0% as the WHOLE-QUIZ timer runs out), plus a
//    streak bonus that grows with consecutive correct answers. This
//    is also what gets added to the student's cumulative xp_total /
//    level (see /submit below) - so a fast, streaky quiz genuinely
//    moves the needle on their level, on top of counting for this
//    one quiz's fun number.
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

    if (value !== q.answer) { streak = 0; return; }

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
// option - this is what powers the on-screen streak animation while
// the quiz is still in progress. It records the answer (so a student
// who never hits "submit" isn't lost) but does NOT finalize the
// attempt or touch XP - /submit below is still the source of truth.
app.post('/api/attempts/:attemptId/answer', requireAuth('student'), async (req, res) => {
  const { questionId, value, usedMeaning, answeredAtMs } = req.body || {};
  if (!questionId) return res.status(400).json({ error: 'Missing questionId.' });

  const attempt = await db.getAttemptById(req.params.attemptId);
  if (!attempt || attempt.studentId !== req.profile.id) return res.status(404).json({ error: 'Attempt not found.' });
  const quiz = await db.getQuizById(attempt.quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  const q = quiz.questions.find((qq) => qq.id === questionId);
  if (!q) return res.status(404).json({ error: 'Question not found.' });

  const given = { value, usedMeaning: !!usedMeaning, answeredAtMs: typeof answeredAtMs === 'number' ? answeredAtMs : null };
  const outcome = await db.recordAnswer(attempt.id, questionId, given);
  if (outcome === 'already_submitted') return res.status(409).json({ error: 'This attempt was already submitted.' });

  res.json({ correct: value === q.answer });
});

app.post('/api/attempts/:attemptId/submit', requireAuth('student'), async (req, res) => {
  const { answers } = req.body || {};
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Missing answers.' });
  }

  const attempt = await db.getAttemptById(req.params.attemptId);
  if (!attempt || attempt.studentId !== req.profile.id) return res.status(404).json({ error: 'Attempt not found.' });
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
  await db.finalizeAttempt(attempt.id, mergedAnswers, mergedOrder, scored);

  // The XP this attempt earned is added to the student's permanent
  // total, which is what the level badge is computed from.
  const newXpTotal = await db.addXp(req.profile.id, scored.xpScore);
  const level = computeLevel(newXpTotal);
  const leveledUp = level.index > computeLevel(newXpTotal - scored.xpScore).index;

  const meaningUsedCount = Object.values(answers).filter((a) => a && typeof a === 'object' && a.usedMeaning).length;
  res.json({
    accuracyScore: scored.accuracyScore,
    xpScore: scored.xpScore,
    longestStreak: scored.longestStreak,
    meaningUsedCount,
    xpTotal: newXpTotal,
    level,
    leveledUp,
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

app.listen(PORT, () => {
  console.log(`Mandarin quiz app running at http://localhost:${PORT}`);
});
