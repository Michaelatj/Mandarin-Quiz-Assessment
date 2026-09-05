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

// "listening_dictation" is deliberately NOT a third fully separate
// shape like sentence_reorder - it stores exactly the same fields as
// multiple_choice (options/optionMeanings/answer) and is graded the
// same way. The only place it behaves differently is toStudentView,
// which hands the client a pinyin-stripped copy of the answer as
// "audioText" for the browser to speak aloud, since the student is
// never shown the target text directly for this type.
const QUESTION_TYPES = ['multiple_choice', 'sentence_reorder', 'listening_dictation'];

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

// A sentence can genuinely have more than one correct word order (a
// time word that can front or stay put, etc). "chunks" always stores
// ONE correct order (as before - that's still what the student sees
// shuffled), and altOrders holds any additional accepted orderings,
// each as chunk INDEX arrays into that same "chunks" list, so
// grading never has to compare text - just index sequences.
//
// Both the "New quiz" JSON paste and the teacher's manual question
// editor supply altOrders as arrays of the actual chunk TEXT in the
// alternate order (easier for both an AI and a human to write than
// abstract indices) - this turns that into index arrays and drops
// anything that isn't an exact reordering of the same chunk set.
// errors is only populated for entries that don't validate, so the
// manual editor can surface a specific message; normalizeQuiz (for
// AI-generated quizzes) ignores errors and just keeps what's valid.
function validateAltOrders(chunks, rawAltOrders) {
  const errors = [];
  if (!Array.isArray(rawAltOrders) || rawAltOrders.length === 0) return { altOrders: undefined, errors };
  const altOrders = [];
  rawAltOrders.forEach((order, i) => {
    if (!Array.isArray(order) || order.length !== chunks.length) {
      errors.push(`alternate order ${i + 1} doesn't use the same number of chunks as above.`);
      return;
    }
    const remaining = chunks.map((text, idx) => ({ text, idx }));
    const indices = [];
    for (const rawText of order) {
      const text = String(rawText).trim();
      const pos = remaining.findIndex((r) => r.text === text);
      if (pos === -1) { indices.length = -1; break; }
      indices.push(remaining[pos].idx);
      remaining.splice(pos, 1);
    }
    if (indices.length !== chunks.length) {
      errors.push(`alternate order ${i + 1} doesn't use the exact same chunks as above, reordered.`);
      return;
    }
    altOrders.push(indices);
  });
  return { altOrders: altOrders.length ? altOrders : undefined, errors };
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
      const type = q.type === 'sentence_reorder'
        ? 'sentence_reorder'
        : q.type === 'listening_dictation'
          ? 'listening_dictation'
          : 'multiple_choice';
      const base = {
        id: nanoid(8),
        type,
        question: q.question.trim(),
        questionMeaning: q.questionMeaning ? String(q.questionMeaning).trim() : undefined,
        points: typeof q.points === 'number' ? q.points : 1,
      };
      if (type === 'sentence_reorder') {
        const chunks = q.chunks.map((c) => String(c).trim());
        const { altOrders } = validateAltOrders(chunks, q.altOrders);
        return { ...base, chunks, altOrders };
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
      return {
        id: q.id,
        type: q.type,
        question: hide ? stripPinyin(q.question) : q.question,
        questionMeaning: q.questionMeaning,
        options: hide ? picked.options.map(stripPinyin) : picked.options,
        optionMeanings: picked.optionMeanings,
        // Always pinyin-stripped, regardless of the hidePinyin setting -
        // this is fed straight to speechSynthesis, and reading "(nǐ)"
        // aloud as literal parenthesis-wrapped text sounds wrong no
        // matter what the pinyin display setting is.
        ...(q.type === 'listening_dictation' ? { audioText: stripPinyin(q.answer) } : {}),
      };
    }),
  };
}

// Small in-memory cache for full quiz objects (questions included).
// Quizzes are read constantly - once per answer check, all quiz
// long - but change rarely (a teacher editing a title, a setting,
// or a question). Caching cuts the answer-check endpoint down to
// zero extra database round trips on a cache hit. This is a plain
// in-process Map, not shared storage - on serverless deployments a
// cold function instance simply starts with an empty cache and
// falls back to a normal database read, so this can only help, never
// break anything.
const quizCache = new Map();
async function getQuizCached(id) {
  if (quizCache.has(id)) return quizCache.get(id);
  const quiz = await db.getQuizById(id);
  if (quiz) quizCache.set(id, quiz);
  return quiz;
}
function invalidateQuizCache(id) {
  quizCache.delete(id);
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
  invalidateQuizCache(quiz.id);
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
  const updated = await db.updateQuizSettings(quiz.id, { title: title.trim() });
  invalidateQuizCache(quiz.id);
  res.json(updated);
});

app.patch('/api/quizzes/:id/settings', requireTeacher, async (req, res) => {
  const quiz = await db.getQuizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  const { hidePinyin, timeLimitSeconds, allowRetakes } = req.body || {};
  const updated = await db.updateQuizSettings(quiz.id, { hidePinyin, timeLimitSeconds, allowRetakes });
  invalidateQuizCache(quiz.id);
  res.json(updated);
});

// Edit the questions themselves - text, options, correct answer, or
// reorder chunks. Lets a teacher fix a bad distractor or an
// ambiguous question the AI generated without deleting the whole
// quiz and starting over. Every question keeps its original id, so
// existing student attempts and their saved answers still line up.
app.patch('/api/quizzes/:id/questions', requireTeacher, async (req, res) => {
  const quiz = await db.getQuizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  const { questions } = req.body || {};
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Missing a "questions" array.' });
  }

  const byId = new Map(quiz.questions.map((q) => [q.id, q]));
  const errors = [];
  const patches = questions.map((q, i) => {
    const existing = byId.get(q.id);
    if (!existing) { errors.push(`Question ${i + 1}: unknown question id.`); return null; }
    if (existing.type === 'sentence_reorder') {
      if (!Array.isArray(q.chunks) || q.chunks.length < 2) {
        errors.push(`Question ${i + 1}: needs at least 2 chunks.`);
        return null;
      }
      const chunks = q.chunks.map((c) => String(c).trim());
      const { altOrders, errors: altErrors } = validateAltOrders(chunks, q.altOrders);
      altErrors.forEach((msg) => errors.push(`Question ${i + 1}: ${msg}`));
      return { id: existing.id, type: existing.type, question: String(q.question || '').trim(), questionMeaning: q.questionMeaning ? String(q.questionMeaning).trim() : undefined, chunks, altOrders };
    }
    if (!Array.isArray(q.options) || q.options.length < 2) {
      errors.push(`Question ${i + 1}: needs at least 2 options.`);
      return null;
    }
    if (!q.answer || !q.options.includes(q.answer)) {
      errors.push(`Question ${i + 1}: the correct answer must exactly match one of the options.`);
      return null;
    }
    return {
      id: existing.id,
      type: existing.type,
      question: String(q.question || '').trim(),
      questionMeaning: q.questionMeaning ? String(q.questionMeaning).trim() : undefined,
      options: q.options.map((o) => String(o).trim()),
      optionMeanings: Array.isArray(q.optionMeanings) ? q.optionMeanings.map((m) => String(m || '').trim()) : undefined,
      answer: String(q.answer).trim(),
    };
  });
  if (errors.length) return res.status(400).json({ error: 'Could not save.', details: errors });

  await db.updateQuestions(quiz.id, patches);
  invalidateQuizCache(quiz.id);
  res.json(await db.getQuizById(quiz.id));
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

function chunkOrderMatches(value, order) {
  return Array.isArray(order) && order.length === value.length && value.every((id, idx) => id === order[idx]);
}

function isAnswerCorrect(q, value) {
  if (q.type === 'sentence_reorder') {
    const total = q.chunks.length;
    if (!Array.isArray(value) || value.length !== total) return false;
    // "chunks" is itself stored in its own correct order, so the
    // "primary" accepted order is always [0, 1, 2, ...]; altOrders
    // (if any) are additional accepted permutations of the same set.
    if (value.every((id, idx) => id === idx)) return true;
    return Array.isArray(q.altOrders) && q.altOrders.some((order) => chunkOrderMatches(value, order));
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

// Checking an answer needs to feel instant - this used to chain 5
// sequential database round trips before responding (load the
// attempt, then the quiz in two more round trips, then read-then-
// write the saved answer in two more), which is exactly where a
// 2+ second delay on every "Check answer" tap was coming from.
// Now: the client already has the quiz id (it's part of the quiz
// object it got when joining), so we skip the attempt lookup
// entirely, fetch the quiz through a small in-memory cache, and
// respond with right/wrong before writing the answer to the
// database at all - that write happens in the background and never
// makes the student wait. If it fails, nothing is lost: the final
// submit() call sends the complete answer set again and rescoring
// happens from scratch server-side either way.
app.post('/api/attempts/:attemptId/answer', async (req, res) => {
  const { questionId, value, usedMeaning, answeredAtMs, quizId } = req.body || {};

  const quiz = quizId ? await getQuizCached(quizId) : await db.getQuizById((await db.getAttemptById(req.params.attemptId))?.quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  const q = quiz.questions.find((qq) => qq.id === questionId);
  if (!q) return res.status(404).json({ error: 'Question not found.' });

  res.json({ correct: isAnswerCorrect(q, value) });

  const given = { value, usedMeaning: !!usedMeaning, answeredAtMs: typeof answeredAtMs === 'number' ? answeredAtMs : null };
  db.recordAnswer(req.params.attemptId, questionId, given).catch((err) => {
    console.error(`Failed to persist answer (attempt ${req.params.attemptId}, question ${questionId}):`, err.message);
  });
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
  invalidateQuizCache(quiz.id);

  // A quiz is now safe to hand back with its correct answers included
  // (the attempt is locked in) so the student can review right/wrong
  // on the spot, the same way a teacher can from the results page.
  const review = quiz.questions.map((q) => {
    const given = mergedAnswers[q.id];
    const value = given ? given.value : undefined;
    return {
      id: q.id,
      type: q.type,
      question: q.question,
      questionMeaning: q.questionMeaning,
      given: value ?? null,
      correctAnswer: q.type === 'sentence_reorder' ? q.chunks : q.answer,
      chunkLabels: q.type === 'sentence_reorder' ? q.chunks : undefined,
      correct: isAnswerCorrect(q, value),
    };
  });

  res.json({
    accuracyScore: scored.accuracyScore,
    xpScore: scored.xpScore,
    longestStreak: scored.longestStreak,
    title,
    review,
  });
});

// ---------------------------------------------------------------------
// Mandarin audio (upgrade from the browser's built-in Web Speech API)
//
// Web Speech API voice quality is entirely dependent on whatever the
// student's own browser/OS ships, and short single-syllable audio
// (tone-check questions) is prone to getting clipped right at the
// end - exactly where a Mandarin tone's pitch movement lives. This
// route generates real audio instead, through Google Translate's
// public text-to-speech endpoint (the same one translate.google.com
// itself uses for its speaker icon - no API key or signup, so it's
// free, but it's unofficial: Google could change or rate-limit it
// without notice, which is why the client (see speakMandarin in
// app.js) keeps the old Web Speech API as an automatic fallback if a
// request to this route ever fails).
//
// Every distinct piece of text is generated once and cached - in
// memory for this server process, and in Supabase so a cold start or
// a second server instance doesn't have to regenerate a word that
// was already fetched before. After the first time any student hears
// a given word, every later playback of that same word, in any quiz,
// is instant and free.
const ttsMemoryCache = new Map();
const MAX_TTS_TEXT_LENGTH = 60; // generously covers any single question's audio text

async function fetchGoogleTranslateTts(text) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-CN&q=${encodeURIComponent(text)}`;
  const response = await fetch(url, {
    headers: {
      // This endpoint 403s any request that doesn't look like it came
      // from a real browser tab.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://translate.google.com/',
    },
  });
  if (!response.ok) throw new Error(`Google Translate TTS responded ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

app.get('/api/tts', async (req, res) => {
  const text = (req.query.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'Missing "text" query param.' });
  if (text.length > MAX_TTS_TEXT_LENGTH) return res.status(400).json({ error: 'Text too long.' });

  const sendAudio = (buffer) => {
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  };

  if (ttsMemoryCache.has(text)) return sendAudio(ttsMemoryCache.get(text));

  try {
    const cachedBase64 = await db.getCachedTts(text);
    if (cachedBase64) {
      const buffer = Buffer.from(cachedBase64, 'base64');
      ttsMemoryCache.set(text, buffer);
      return sendAudio(buffer);
    }

    const buffer = await fetchGoogleTranslateTts(text);
    ttsMemoryCache.set(text, buffer);
    db.saveCachedTts(text, buffer.toString('base64')).catch((err) => {
      console.error(`Failed to persist TTS cache for "${text}":`, err.message);
    });
    sendAudio(buffer);
  } catch (err) {
    console.error(`TTS generation failed for "${text}":`, err.message);
    res.status(502).json({ error: 'TTS generation failed.' });
  }
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
