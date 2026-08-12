// server.js
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
  console.error('Missing TEACHER_PASSCODE in your .env file.');
  process.exit(1);
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

const QUESTION_TYPES = ['multiple_choice', 'sentence_reorder'];

function validateQuiz(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['The quiz must be a JSON object.'];
  if (!payload.title || typeof payload.title !== 'string') errors.push('Missing a "title" (string).');
  if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
    errors.push('Missing a "questions" array.');
    return errors;
  }
  return errors;
}

function normalizeQuiz(payload) {
  return {
    id: nanoid(10),
    code: crypto.randomInt(100000, 999999).toString(),
    title: payload.title.trim(),
    description: (payload.description || '').trim(),
    hidePinyin: false,
    timeLimitSeconds: 0,
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
        const shuffledChunks = shuffle(
          q.chunks.map((text, id) => ({ id, text: hide ? stripPinyin(text) : text }))
        );
        return { id: q.id, type: q.type, question: hide ? stripPinyin(q.question) : q.question, questionMeaning: q.questionMeaning, chunks: shuffledChunks };
      }
      const picked = pickDisplayOptions(q);
      return { id: q.id, type: q.type, question: hide ? stripPinyin(q.question) : q.question, questionMeaning: q.questionMeaning, options: hide ? picked.options.map(stripPinyin) : picked.options, optionMeanings: picked.optionMeanings };
    }),
  };
}

// Teacher endpoints
app.get('/api/quizzes', requireTeacher, async (req, res) => res.json(await db.listQuizzes()));

app.post('/api/quizzes', requireTeacher, async (req, res) => {
  const errors = validateQuiz(req.body);
  if (errors.length) return res.status(400).json({ error: 'Invalid JSON format.', details: errors });
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

// Update quiz title endpoint
app.patch('/api/quizzes/:id/title', requireTeacher, async (req, res) => {
  const quiz = await db.getQuizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  const { title } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required.' });
  }
  res.json(await db.updateQuizSettings(quiz.id, { title: title.trim() }));
});

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
  const withTitles = attempts.map((a) => (
    a.submittedAt ? { ...a, title: computeTitle(a.accuracyScore, a.longestStreak, quiz.questions.length) } : a
  ));
  res.json({ quiz, attempts: withTitles });
});

// Student endpoints
app.get('/api/join/:code', async (req, res) => {
  const quiz = await db.findQuizByCode(req.params.code);
  if (!quiz) return res.status(404).json({ error: 'No quiz found.' });
  res.json({ title: quiz.title, description: quiz.description, questionCount: quiz.questions.length });
});

app.post('/api/join/:code', async (req, res) => {
  const { studentName } = req.body || {};
  const name = (studentName || '').trim();
  if (!name) return res.status(400).json({ error: 'Enter your name.' });

  const quiz = await db.findQuizByCode(req.params.code);
  if (!quiz) return res.status(404).json({ error: 'No quiz found.' });

  const attempt = await db.createAttempt({ id: nanoid(12), quizId: quiz.id, studentName: name });
  res.status(201).json({ attemptId: attempt.id, quiz: toStudentView(quiz) });
});

function isAnswerCorrect(q, value) {
  if (q.type === 'sentence_reorder') {
    const total = q.chunks.length;
    return Array.isArray(value) && value.length === total && value.every((id, idx) => id === idx);
  }
  return value === q.answer;
}

function recomputeScore(answers, answerOrderIn, quiz) {
  const limitMs = (quiz.timeLimitSeconds || 0) * 1000;
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
      bonusMultiplier += 0.5 * Math.min(1, remainingMs / limitMs);
    }
    bonusMultiplier += Math.min(0.5, Math.max(0, streak - 2) * 0.1);
    xp += base + base * bonusMultiplier;
  });

  return {
    accuracyScore: quiz.questions.length > 0 ? Math.round((correctCount / quiz.questions.length) * 100) : 0,
    xpScore: Math.round(xp * 100) / 100,
    longestStreak,
  };
}

app.post('/api/attempts/:attemptId/answer', async (req, res) => {
  const { questionId, value, usedMeaning, answeredAtMs } = req.body || {};
  const attempt = await db.getAttemptById(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: 'Attempt not found.' });
  const quiz = await db.getQuizById(attempt.quizId);
  const q = quiz.questions.find((qq) => qq.id === questionId);

  const given = { value, usedMeaning: !!usedMeaning, answeredAtMs: typeof answeredAtMs === 'number' ? answeredAtMs : null };
  await db.recordAnswer(attempt.id, questionId, given);

  res.json({ correct: isAnswerCorrect(q, value) });
});

app.post('/api/attempts/:attemptId/submit', async (req, res) => {
  const { answers } = req.body || {};
  const attempt = await db.getAttemptById(req.params.attemptId);
  const quiz = await db.getQuizById(attempt.quizId);

  const mergedAnswers = { ...attempt.answers, ...answers };
  const mergedOrder = attempt.answerOrder.slice();
  Object.keys(answers).forEach((qId) => {
    if (!mergedOrder.includes(qId)) mergedOrder.push(qId);
  });

  const scored = recomputeScore(mergedAnswers, mergedOrder, quiz);
  const title = computeTitle(scored.accuracyScore, scored.longestStreak, quiz.questions.length);
  await db.finalizeAttempt(attempt.id, mergedAnswers, mergedOrder, scored, title.name);

  res.json({
    accuracyScore: scored.accuracyScore,
    xpScore: scored.xpScore,
    longestStreak: scored.longestStreak,
    title,
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`App running at http://localhost:${PORT}`));
}

module.exports = app;
