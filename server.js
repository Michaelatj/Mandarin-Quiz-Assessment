// server.js
//
// One Express app that serves both the API and the static frontend
// (the public/ folder). Nothing else to run - one process, one port.

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const TEACHER_PASSCODE = process.env.TEACHER_PASSCODE || 'change-me-please';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------
// Teacher auth - supports both single passcode (legacy) and multi-teacher
// ---------------------------------------------------------------------

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function requireTeacher(req, res, next) {
  const key = req.get('x-teacher-key');
  // Legacy single-teacher mode
  if (key && key === TEACHER_PASSCODE && TEACHER_PASSCODE !== 'change-me-please') {
    return next();
  }
  // Multi-teacher mode with session token
  if (!key) {
    return res.status(401).json({ error: 'Missing authentication.' });
  }
  const state = db.load();
  const teacher = state.teachers.find(t => t.sessionToken === key);
  if (!teacher) {
    return res.status(401).json({ error: 'Invalid session.' });
  }
  req.teacher = teacher;
  next();
}

app.post('/api/teacher/login', (req, res) => {
  const { passcode, username, password } = req.body || {};
  
  // Legacy single passcode login
  if (passcode && passcode === TEACHER_PASSCODE && TEACHER_PASSCODE !== 'change-me-please') {
    return res.json({ ok: true, legacyMode: true, teacherKey: passcode });
  }
  
  // Multi-teacher login
  if (username && password) {
    const state = db.load();
    const teacher = state.teachers.find(t => t.username === username);
    if (!teacher) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    if (teacher.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const sessionToken = nanoid(32);
    db.update(state => {
      const t = state.teachers.find(tea => tea.id === teacher.id);
      t.sessionToken = sessionToken;
    });
    return res.json({ 
      ok: true, 
      teacher: { id: teacher.id, name: teacher.name, username: teacher.username },
      teacherKey: sessionToken 
    });
  }
  
  return res.status(400).json({ error: 'Invalid login request.' });
});

app.post('/api/teacher/register', (req, res) => {
  const { name, username, password, ownerKey } = req.body || {};
  
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username, and password are required.' });
  }
  if (username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Username must be 3+ chars, password 4+ chars.' });
  }
  
  const state = db.load();
  
  // Check if owner exists and validate ownerKey for first registration
  const owners = state.teachers.filter(t => t.isOwner);
  if (owners.length === 0) {
    // First teacher becomes owner
    const teacher = {
      id: nanoid(12),
      name: name.trim(),
      username: username.trim().toLowerCase(),
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      isOwner: true,
      sessionToken: nanoid(32)
    };
    state.teachers.push(teacher);
    db.save(state);
    return res.status(201).json({ 
      ok: true, 
      teacher: { id: teacher.id, name: teacher.name, username: teacher.username },
      teacherKey: teacher.sessionToken 
    });
  }
  
  // Subsequent teachers need owner approval via ownerKey
  if (ownerKey !== TEACHER_PASSCODE) {
    return res.status(403).json({ error: 'Owner passcode required to add new teachers.' });
  }
  
  if (state.teachers.some(t => t.username === username.toLowerCase())) {
    return res.status(409).json({ error: 'Username already taken.' });
  }
  
  const teacher = {
    id: nanoid(12),
    name: name.trim(),
    username: username.trim().toLowerCase(),
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    isOwner: false,
    sessionToken: nanoid(32)
  };
  state.teachers.push(teacher);
  db.save(state);
  return res.status(201).json({ 
    ok: true, 
    teacher: { id: teacher.id, name: teacher.name, username: teacher.username },
    teacherKey: teacher.sessionToken 
  });
});

app.get('/api/teachers', requireTeacher, (req, res) => {
  const state = db.load();
  const teachers = state.teachers.map(t => ({
    id: t.id,
    name: t.name,
    username: t.username,
    isOwner: t.isOwner,
    createdAt: t.createdAt
  }));
  res.json(teachers);
});

app.delete('/api/teachers/:id', requireTeacher, (req, res) => {
  const state = db.load();
  const currentTeacher = state.teachers.find(t => t.sessionToken === req.get('x-teacher-key'));
  if (!currentTeacher || !currentTeacher.isOwner) {
    return res.status(403).json({ error: 'Only the owner can delete teachers.' });
  }
  if (req.params.id === currentTeacher.id) {
    return res.status(400).json({ error: 'Cannot delete yourself.' });
  }
  state.teachers = state.teachers.filter(t => t.id !== req.params.id);
  db.save(state);
  res.json({ ok: true });
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

function normalizeQuiz(payload) {
  return {
    id: nanoid(10),
    code: crypto.randomInt(100000, 999999).toString(), // 6-digit join code, easy for students to type
    title: payload.title.trim(),
    description: (payload.description || '').trim(),
    createdAt: new Date().toISOString(),
    hidePinyin: false,
    timeLimitSeconds: 0, // 0 = no per-question timer / speed bonus
    allowRetakes: true,
    questions: payload.questions.map((q) => ({
      id: nanoid(8),
      type: 'multiple_choice',
      question: q.question.trim(),
      questionMeaning: q.questionMeaning ? String(q.questionMeaning).trim() : undefined,
      options: q.options,
      optionMeanings: Array.isArray(q.optionMeanings) ? q.optionMeanings : undefined,
      answer: q.answer,
      explanation: q.explanation || undefined,
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

// Strip answers/explanations before sending a quiz to a student. The
// English meaning fields are included - they're not a secret, just
// hidden behind a toggle in the UI - so the student's own browser can
// show/hide them instantly with no extra request. Pinyin is removed
// here on the server, before the quiz ever reaches the student's
// browser, when the teacher has hidePinyin turned on for this quiz.
//
// This also randomizes: question order is shuffled, and each question
// shows a random 4 of its full option pool (the correct answer plus 3
// random distractors), also shuffled. Called fresh on every join, so
// a student retaking a quiz - or two students taking it back to back -
// don't see the same order or the same wrong answers next to it.

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

app.get('/api/quizzes', requireTeacher, (req, res) => {
  const state = db.load();
  const summaries = state.quizzes
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((quiz) => ({
      id: quiz.id,
      code: quiz.code,
      title: quiz.title,
      description: quiz.description,
      createdAt: quiz.createdAt,
      questionCount: quiz.questions.length,
      attemptCount: state.attempts.filter((a) => a.quizId === quiz.id).length,
    }));
  res.json(summaries);
});

app.post('/api/quizzes', requireTeacher, (req, res) => {
  const errors = validateQuiz(req.body);
  if (errors.length) {
    return res.status(400).json({ error: 'That JSON does not match the expected quiz format.', details: errors });
  }
  const quiz = normalizeQuiz(req.body);
  db.update((state) => state.quizzes.push(quiz));
  res.status(201).json(quiz);
});

app.get('/api/quizzes/:id', requireTeacher, (req, res) => {
  const state = db.load();
  const quiz = state.quizzes.find((q) => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  res.json(quiz);
});

app.delete('/api/quizzes/:id', requireTeacher, (req, res) => {
  db.update((state) => {
    state.quizzes = state.quizzes.filter((q) => q.id !== req.params.id);
    state.attempts = state.attempts.filter((a) => a.quizId !== req.params.id);
  });
  res.json({ ok: true });
});

// Per-quiz settings a teacher can flip any time, including for a quiz
// students are already using - the next student to join just gets the
// updated view.
app.patch('/api/quizzes/:id/settings', requireTeacher, (req, res) => {
  const { hidePinyin, timeLimitSeconds, allowRetakes } = req.body || {};
  const result = db.update((state) => {
    const quiz = state.quizzes.find((q) => q.id === req.params.id);
    if (!quiz) return { notFound: true };
    if (typeof hidePinyin === 'boolean') quiz.hidePinyin = hidePinyin;
    if (typeof timeLimitSeconds === 'number' && timeLimitSeconds >= 0) {
      quiz.timeLimitSeconds = Math.round(timeLimitSeconds);
    }
    if (typeof allowRetakes === 'boolean') quiz.allowRetakes = allowRetakes;
    return { quiz };
  });
  if (result.notFound) return res.status(404).json({ error: 'Quiz not found.' });
  res.json(result.quiz);
});

app.get('/api/quizzes/:id/results', requireTeacher, (req, res) => {
  const state = db.load();
  const quiz = state.quizzes.find((q) => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
  const attempts = state.attempts
    .filter((a) => a.quizId === req.params.id)
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  res.json({ quiz, attempts });
});

// ---------------------------------------------------------------------
// Student routes - now with simple PIN-based accounts for retake history
// ---------------------------------------------------------------------

app.get('/api/students', requireTeacher, (req, res) => {
  const state = db.load();
  const students = state.students.map(s => ({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    attemptCount: state.attempts.filter(a => a.studentId === s.id).length
  }));
  res.json(students);
});

app.post('/api/students/register', (req, res) => {
  const { name, pin } = req.body || {};
  if (!name || !pin) {
    return res.status(400).json({ error: 'Name and PIN are required.' });
  }
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be exactly 4 digits.' });
  }
  if (name.length > 60) {
    return res.status(400).json({ error: 'Name is too long.' });
  }
  
  const state = db.load();
  const existing = state.students.find(s => 
    s.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
  
  if (existing) {
    // Return existing student if PIN matches
    if (existing.pin === pin) {
      return res.json({ student: { id: existing.id, name: existing.name }, existing: true });
    }
    return res.status(409).json({ error: 'A student with this name already exists. Please choose a different name or check your PIN.' });
  }
  
  const student = {
    id: nanoid(12),
    name: name.trim(),
    pin: pin,
    createdAt: new Date().toISOString()
  };
  state.students.push(student);
  db.save(state);
  res.status(201).json({ student: { id: student.id, name: student.name }, existing: false });
});

app.get('/api/join/:code', (req, res) => {
  const state = db.load();
  const quiz = state.quizzes.find((q) => q.code === req.params.code);
  if (!quiz) return res.status(404).json({ error: 'No quiz found for that code. Double-check it with your teacher.' });
  res.json({ title: quiz.title, description: quiz.description, questionCount: quiz.questions.length });
});

app.post('/api/join/:code', (req, res) => {
  const { studentName, studentPin, studentId } = req.body || {};
  
  let student = null;
  const state = db.load();
  
  // If studentId provided, they're logging in to existing account
  if (studentId) {
    student = state.students.find(s => s.id === studentId);
    if (!student) {
      return res.status(404).json({ error: 'Student account not found.' });
    }
    if (student.pin !== studentPin) {
      return res.status(401).json({ error: 'Incorrect PIN.' });
    }
  } else {
    // New student session - just name entry for quick joins
    const name = (studentName || '').trim();
    if (!name) return res.status(400).json({ error: 'Enter your name to start.' });
    if (name.length > 60) return res.status(400).json({ error: 'That name is too long.' });
    
    // Find or create student record
    student = state.students.find(s => s.name.trim().toLowerCase() === name.toLowerCase());
    if (!student) {
      // Create temporary student without PIN for one-time joins
      student = {
        id: nanoid(12),
        name: name,
        pin: null,
        createdAt: new Date().toISOString()
      };
      state.students.push(student);
      db.save(state);
    }
  }
  
  const quiz = state.quizzes.find((q) => q.code === req.params.code);
  if (!quiz) return res.status(404).json({ error: 'No quiz found for that code.' });

  if (quiz.allowRetakes === false) {
    const alreadyDone = state.attempts.some(
      (a) => a.quizId === quiz.id && a.submittedAt && a.studentId === student.id
    );
    if (alreadyDone) {
      return res.status(409).json({ error: 'You already completed this quiz. Ask your teacher if you need another attempt.' });
    }
  }

  const attempt = {
    id: nanoid(12),
    quizId: quiz.id,
    studentId: student.id,
    studentName: student.name,
    answers: {},
    score: null,
    total: quiz.questions.reduce((sum, q) => sum + q.points, 0),
    submittedAt: null,
    startedAt: new Date().toISOString(),
  };
  db.update((s) => s.attempts.push(attempt));

  res.status(201).json({ 
    attemptId: attempt.id, 
    quiz: toStudentView(quiz),
    student: { id: student.id, name: student.name, hasPin: !!student.pin }
  });
});

function recomputeScore(attempt, quiz) {
  let score = 0;
  const limitMs = (quiz.timeLimitSeconds || 0) * 1000;
  quiz.questions.forEach((q) => {
    const given = attempt.answers[q.id];
    if (!given) return;
    const value = typeof given === 'object' ? given.value : given;
    const usedMeaning = typeof given === 'object' && given.usedMeaning === true;
    const timeTakenMs = typeof given === 'object' && typeof given.timeTakenMs === 'number' ? given.timeTakenMs : null;
    if (value !== q.answer) return;

    const base = usedMeaning ? q.points * 0.5 : q.points;
    if (limitMs > 0 && timeTakenMs !== null) {
      // Up to +50% bonus for an instant correct answer, tapering to
      // +0% right at the time limit. Bonus isn't part of "total", so
      // a fast student's score can (deliberately) beat the max.
      const speedFraction = Math.max(0, Math.min(1, 1 - timeTakenMs / limitMs));
      score += base + base * 0.5 * speedFraction;
    } else {
      score += base;
    }
  });
  // Round to 2 decimals so halved points and speed bonuses don't
  // accumulate floating-point noise like 7.499999999999999.
  attempt.score = Math.round(score * 100) / 100;
}

app.post('/api/attempts/:attemptId/submit', (req, res) => {
  const { answers } = req.body || {};
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Missing answers.' });
  }

  const result = db.update((state) => {
    const attempt = state.attempts.find((a) => a.id === req.params.attemptId);
    if (!attempt) return { notFound: true };
    if (attempt.submittedAt) return { alreadySubmitted: true, attempt };
    const quiz = state.quizzes.find((q) => q.id === attempt.quizId);
    if (!quiz) return { notFound: true };

    attempt.answers = answers;
    attempt.submittedAt = new Date().toISOString();
    recomputeScore(attempt, quiz);
    return { attempt, quiz };
  });

  if (result.notFound) return res.status(404).json({ error: 'Attempt not found.' });

  const meaningUsedCount = Object.values(answers).filter((a) => a && typeof a === 'object' && a.usedMeaning).length;
  res.json({ score: result.attempt.score, total: result.attempt.total, meaningUsedCount });
});

// Fallback to the SPA for any non-API route so deep links (e.g. a
// shared /?join=123456 link) still load the frontend.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Mandarin quiz app running at http://localhost:${PORT}`);
  if (TEACHER_PASSCODE === 'change-me-please') {
    console.log('Reminder: set TEACHER_PASSCODE in your .env file before sharing this with students.');
  }
});
