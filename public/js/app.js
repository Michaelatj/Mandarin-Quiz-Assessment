// app.js
//
// A small hash-router SPA. Each route has a render function that
// returns an HTML string for <main>. State that needs to survive
// between renders (like the quiz a student is mid-way through) lives
// in the `state` object below, not in the DOM.

const state = {
  studentAttemptId: null,
  studentQuiz: null,
  studentAnswers: {}, // { [questionId]: { value, usedMeaning, timeTakenMs } }
  studentQuestionIndex: 0,
  studentMeaningOn: false, // the "show meaning" toggle, on/off for the whole attempt
  studentQuestionStartTimes: {}, // { [questionId]: Date.now() when first shown } - for the speed bonus
};

// Handle for the currently-running per-question countdown, if the quiz
// has a time limit. Module-level (not in `state`) because it's a live
// timer handle, not data - always cleared at the top of every
// renderStudentQuiz() call so re-renders never leave a duplicate
// ticking in the background.
let questionTimerInterval = null;
function clearQuestionTimer() {
  if (questionTimerInterval) {
    clearInterval(questionTimerInterval);
    questionTimerInterval = null;
  }
}

const mainEl = () => document.getElementById('main');
const topActionsEl = () => document.getElementById('topbar-actions');

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function go(hash) {
  const before = window.location.hash;
  window.location.hash = hash;
  if (window.location.hash === before) {
    // The hash string didn't actually change (e.g. logging in while
    // already sitting on #teacher), so the browser won't fire
    // hashchange and render() would never run on its own. Force it.
    render();
  }
}

// ---------------------------------------------------------------------
// Theme switcher - 4 cozy palettes, remembered per browser
// ---------------------------------------------------------------------

const THEMES = [
  { id: 'ink-seal', name: 'Ink & Seal', swatch: '#c1442d' },
  { id: 'teahouse', name: 'Tea House', swatch: '#c88a35' },
  { id: 'midnightjade', name: 'Midnight Jade', swatch: '#5f9c7a' },
  { id: 'plumlantern', name: 'Plum Lantern', swatch: '#c0567a' },
];

function currentTheme() {
  return localStorage.getItem('appTheme') || 'ink-seal';
}

function applyTheme(id) {
  if (id === 'ink-seal') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', id);
  }
  localStorage.setItem('appTheme', id);
}

function renderThemeSwitcher() {
  const active = currentTheme();
  const wrap = document.createElement('div');
  wrap.className = 'theme-switcher';
  wrap.innerHTML = `
    <button class="theme-toggle" id="theme-toggle-btn" title="Theme">${icon('palette')}</button>
    <div class="theme-menu" id="theme-menu">
      ${THEMES.map((t) => `
        <div class="theme-option ${t.id === active ? 'active' : ''}" data-theme-id="${t.id}">
          <span class="theme-swatch" style="background:${t.swatch}"></span>
          <span>${t.name}</span>
        </div>
      `).join('')}
    </div>
  `;
  topActionsEl().appendChild(wrap);

  const menu = wrap.querySelector('#theme-menu');
  wrap.querySelector('#theme-toggle-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  wrap.querySelectorAll('.theme-option').forEach((el) => {
    el.addEventListener('click', () => {
      applyTheme(el.dataset.themeId);
      menu.classList.remove('open');
      renderThemeSwitcher_replace(wrap);
    });
  });
  document.addEventListener('click', () => menu.classList.remove('open'), { once: true });
}

function renderThemeSwitcher_replace(oldWrap) {
  oldWrap.remove();
  renderThemeSwitcher();
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------

async function render() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [rootSeg, ...rest] = hash.split('/').filter(Boolean);

  topActionsEl().innerHTML = '';
  renderThemeSwitcher();

  try {
    if (!rootSeg) return renderLanding();
    if (rootSeg === 'teacher') return renderTeacher(rest);
    if (rootSeg === 'student') return renderStudent(rest);
    return renderLanding();
  } catch (err) {
    mainEl().innerHTML = `
      <div class="empty-state">
        <div class="icon">${icon('x', 30)}</div>
        <h2>Something went wrong</h2>
        <p>${escapeHtml(err.message)}</p>
        <button class="btn btn-ghost" onclick="go('')">${icon('arrowLeft')} Back home</button>
      </div>`;
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

// ---------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------

function renderLanding() {
  mainEl().innerHTML = `
    <div style="text-align:center; padding-top: 20px;">
      <h1 style="font-size: 30px;">A quiet place to quiz</h1>
      <p>Bring questions your AI chatbot wrote, share a code, see who understood the lesson.</p>
    </div>
    <div class="choice-grid">
      <div class="choice-card" onclick="go('teacher')">
        <div class="icon">${icon('chalkboard', 30)}</div>
        <h3>I'm the teacher</h3>
        <p>Create quizzes and review results</p>
      </div>
      <div class="choice-card" onclick="go('student/join')">
        <div class="icon">${icon('student', 30)}</div>
        <h3>I'm a student</h3>
        <p>Enter a code and take a quiz</p>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Teacher: login
// ---------------------------------------------------------------------

function isTeacherLoggedIn() {
  return !!localStorage.getItem('teacherKey');
}

function renderTeacherTopActions() {
  topActionsEl().insertAdjacentHTML('beforeend', `
    <button class="btn btn-ghost btn-sm" onclick="teacherLogout()">${icon('logout')} Sign out</button>
  `);
}

async function renderTeacher(rest) {
  if (!isTeacherLoggedIn()) return renderTeacherLogin();
  renderTeacherTopActions();

  const page = rest[0];
  if (!page) return renderTeacherDashboard();
  if (page === 'new') return renderTeacherNewQuiz();
  if (page === 'quiz' && rest[1]) return renderTeacherResults(rest[1]);
  return renderTeacherDashboard();
}

function renderTeacherLogin() {
  mainEl().innerHTML = `
    <div class="card" style="max-width: 420px; margin: 40px auto;">
      <div class="icon" style="color: var(--accent); margin-bottom: 10px;">${icon('key', 26)}</div>
      <h2>Teacher passcode</h2>
      <p>The passcode you set in your .env file when you set up the app.</p>
      <form id="login-form">
        <div class="field">
          <input class="input" type="password" id="passcode" placeholder="Passcode" autofocus required />
        </div>
        <div id="login-error" class="error-text"></div>
        <button class="btn btn-primary btn-block" type="submit">${icon('arrowRight')} Enter dashboard</button>
      </form>
      <div style="margin-top: 14px; text-align:center;">
        <button class="muted-link" onclick="go('')">Back home</button>
      </div>
    </div>
  `;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const passcode = document.getElementById('passcode').value;
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';
    try {
      await Api.login(passcode);
      localStorage.setItem('teacherKey', passcode);
      go('teacher');
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function teacherLogout() {
  localStorage.removeItem('teacherKey');
  go('');
}

// ---------------------------------------------------------------------
// Teacher: dashboard
// ---------------------------------------------------------------------

async function renderTeacherDashboard() {
  mainEl().innerHTML = `<div class="empty-state"><p>Loading your quizzes…</p></div>`;
  const quizzes = await Api.listQuizzes();

  const listHtml = quizzes.length ? quizzes.map((q) => `
    <div class="list-card" onclick="go('teacher/quiz/${q.id}')">
      <div>
        <div class="list-card-title">${escapeHtml(q.title)}</div>
        <div class="list-card-meta">
          <span>${icon('paper', 14)} ${q.questionCount} questions</span>
          <span>${icon('users', 14)} ${q.attemptCount} responses</span>
          <span>${icon('clock', 14)} ${formatDate(q.createdAt)}</span>
        </div>
      </div>
      <span class="badge">${icon('key', 13)} ${q.code}</span>
    </div>
  `).join('') : `
    <div class="empty-state">
      <div class="icon">${icon('paper', 30)}</div>
      <h3>No quizzes yet</h3>
      <p>Generate one with an AI chatbot, then paste the JSON in.</p>
    </div>
  `;

  mainEl().innerHTML = `
    <div class="row-between" style="margin-bottom: 20px;">
      <h1 style="margin:0;">Your quizzes</h1>
      <button class="btn btn-primary" onclick="go('teacher/new')">${icon('plus')} New quiz</button>
    </div>
    ${listHtml}
  `;
}

// ---------------------------------------------------------------------
// Teacher: new quiz (prompt template + paste JSON)
// ---------------------------------------------------------------------

function renderTeacherNewQuiz() {
  mainEl().innerHTML = `
    <button class="muted-link" style="margin-bottom: 18px;" onclick="go('teacher')">${icon('arrowLeft')} Back to quizzes</button>
    <h1>New quiz</h1>
    <p>Two steps: get a quiz written for you by any free AI chatbot, then paste what it gives you below.</p>

    <div class="section-title">${icon('copy', 14)} Step 1 · Copy this prompt</div>
    <div class="field" style="max-width:220px;">
      <label>Student HSK level</label>
      <select class="input" id="hsk-level">
        ${[1, 2, 3, 4, 5, 6].map((lvl) => `<option value="${lvl}" ${lvl === 1 ? 'selected' : ''}>HSK ${lvl}</option>`).join('')}
      </select>
    </div>
    <p style="margin-bottom:10px;">Paste it into ChatGPT, Gemini, Grok, Claude, or any chatbot, with your lesson material dropped in where marked. The AI keeps the vocabulary near this level and uses Hanzi with pinyin, not full English.</p>
    <div class="prompt-box" id="prompt-box"></div>
    <button class="btn btn-ghost btn-sm" style="margin-top:10px;" onclick="copyPrompt()">${icon('copy')} Copy prompt</button>

    <div class="section-title">${icon('paper', 14)} Step 2 · Paste the JSON it gives you</div>
    <form id="quiz-form">
      <div class="field">
        <textarea class="input" id="quiz-json" placeholder='{ "title": "...", "questions": [ ... ] }' required></textarea>
      </div>
      <div id="quiz-error" class="error-text"></div>
      <button class="btn btn-primary" type="submit">${icon('check')} Create quiz</button>
    </form>
  `;

  const promptBox = document.getElementById('prompt-box');
  const levelSelect = document.getElementById('hsk-level');
  const updatePromptText = () => {
    promptBox.textContent = QUIZ_PROMPT_TEMPLATE.replaceAll('{{HSK_LEVEL}}', levelSelect.value);
  };
  updatePromptText();
  levelSelect.addEventListener('change', updatePromptText);

  document.getElementById('quiz-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('quiz-error');
    errorEl.innerHTML = '';
    let parsed;
    try {
      parsed = JSON.parse(document.getElementById('quiz-json').value);
    } catch (err) {
      errorEl.textContent = 'That is not valid JSON. Besides making sure you copied the whole { ... } block, the most common cause is a straight " character left inside a question or option (often from an English aside in parentheses) - that breaks the format. Ask the chatbot to redo it without any straight double quotes inside the text, or remove the stray one by hand.';
      return;
    }
    try {
      const quiz = await Api.createQuiz(parsed);
      go(`teacher/quiz/${quiz.id}`);
    } catch (err) {
      const details = err.details ? '<ul style="margin:6px 0 0 18px; padding:0;">' + err.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('') + '</ul>' : '';
      errorEl.innerHTML = `${escapeHtml(err.message)}${details}`;
    }
  });
}

function copyPrompt() {
  const promptBox = document.getElementById('prompt-box');
  navigator.clipboard.writeText(promptBox.textContent);
  const btn = Array.from(document.querySelectorAll('.btn-ghost.btn-sm')).find((b) => b.textContent.includes('Copy prompt'));
  if (btn) {
    const original = btn.innerHTML;
    btn.innerHTML = `${icon('check')} Copied`;
    setTimeout(() => { btn.innerHTML = original; }, 1600);
  }
}

// ---------------------------------------------------------------------
// Teacher: results
// ---------------------------------------------------------------------

async function renderTeacherResults(quizId) {
  mainEl().innerHTML = `<div class="empty-state"><p>Loading results…</p></div>`;
  const { quiz, attempts } = await Api.getResults(quizId);

  const joinUrl = `${window.location.origin}/#/student/join?code=${quiz.code}`;

  const attemptsHtml = attempts.length ? attempts.map((a) => renderAttemptRow(quiz, a)).join('') : `
    <div class="empty-state">
      <div class="icon">${icon('users', 28)}</div>
      <h3>No responses yet</h3>
      <p>Share the code below with your students.</p>
    </div>
  `;

  mainEl().innerHTML = `
    <button class="muted-link" style="margin-bottom: 18px;" onclick="go('teacher')">${icon('arrowLeft')} Back to quizzes</button>

    <div class="row-between" style="align-items:flex-start;">
      <div>
        <h1 style="margin-bottom:4px;">${escapeHtml(quiz.title)}</h1>
        <p style="margin:0;">${escapeHtml(quiz.description || '')}</p>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteQuiz('${quiz.id}')">${icon('trash')} Delete</button>
    </div>

    <div class="card" style="margin-top:18px; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
      <div>
        <div style="font-size:12px; color:var(--text-faint); margin-bottom:6px;">Share this code with your students</div>
        <div style="font-family:var(--font-mono); font-size:26px; letter-spacing:0.3em; color:var(--accent);">${quiz.code}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="copyText('${joinUrl}', this)">${icon('copy')} Copy join link</button>
    </div>

    <label class="switch-label" id="pinyin-toggle-label">
      <input type="checkbox" id="pinyin-toggle" ${quiz.hidePinyin ? 'checked' : ''} />
      <span class="switch-track"></span>
      <span>Hide pinyin from students - they'll only see Hanzi</span>
    </label>

    <label class="switch-label" id="retakes-toggle-label">
      <input type="checkbox" id="retakes-toggle" ${quiz.allowRetakes ? 'checked' : ''} />
      <span class="switch-track"></span>
      <span>Allow retakes - same name can join more than once</span>
    </label>

    <div class="field" style="max-width:260px; margin-bottom:24px;">
      <label>Time limit per question (seconds)</label>
      <input class="input" type="number" min="0" step="1" id="time-limit-input" value="${quiz.timeLimitSeconds || 0}" placeholder="0 = off" />
      <p style="margin:6px 0 0; font-size:12px;">0 turns the timer off. When set, a correct answer scores up to 50% bonus for answering quickly - like a game.</p>
    </div>

    <div class="section-title">${icon('users', 14)} ${attempts.length} response${attempts.length === 1 ? '' : 's'}</div>
    ${attemptsHtml}
  `;

  document.getElementById('pinyin-toggle').addEventListener('change', async (e) => {
    await Api.updateQuizSettings(quiz.id, { hidePinyin: e.target.checked });
  });
  document.getElementById('retakes-toggle').addEventListener('change', async (e) => {
    await Api.updateQuizSettings(quiz.id, { allowRetakes: e.target.checked });
  });
  const timeLimitInput = document.getElementById('time-limit-input');
  let timeLimitDebounce;
  timeLimitInput.addEventListener('input', () => {
    clearTimeout(timeLimitDebounce);
    timeLimitDebounce = setTimeout(async () => {
      const seconds = Math.max(0, Number(timeLimitInput.value) || 0);
      await Api.updateQuizSettings(quiz.id, { timeLimitSeconds: seconds });
    }, 500);
  });
}

function renderAttemptRow(quiz, attempt) {
  const pending = !attempt.submittedAt;
  const seal = pending
    ? `<div class="seal"><span class="seal-score">…</span><span class="seal-total">in progress</span></div>`
    : `<div class="seal ${attempt.score / attempt.total >= 0.6 ? 'jade' : ''}"><span class="seal-score">${attempt.score}</span><span class="seal-total">of ${attempt.total}</span></div>`;

  const reviewId = `review-${attempt.id}`;

  return `
    <div class="attempt-row" style="align-items:flex-start; flex-direction:column;">
      <div style="display:flex; align-items:center; gap:16px; width:100%;">
        ${seal}
        <div class="attempt-info">
          <div class="attempt-name">${escapeHtml(attempt.studentName)}</div>
          <div class="attempt-meta">${pending ? 'Started' : 'Submitted'} ${formatDate(attempt.submittedAt || attempt.startedAt)}</div>
        </div>
        ${!pending ? `<button class="btn btn-ghost btn-sm" onclick="toggleReview('${reviewId}')">${icon('paper', 14)} Review</button>` : ''}
      </div>
      ${!pending ? `<div id="${reviewId}" class="answer-review" style="display:none; width:100%;">${renderAnswerReview(quiz, attempt)}</div>` : ''}
    </div>
  `;
}

function renderAnswerReview(quiz, attempt) {
  return quiz.questions.map((q) => {
    const given = attempt.answers[q.id];
    const value = given ? given.value : undefined;
    const usedMeaning = given && given.usedMeaning === true;
    const isCorrect = value === q.answer;
    return `
      <div class="answer-line">
        <span class="mark ${isCorrect ? 'correct' : 'incorrect'}">${icon(isCorrect ? 'check' : 'x', 15)}</span>
        <div>
          <div>${escapeHtml(q.question)}</div>
          <div style="color:var(--text-faint); font-size:12.5px; margin-top:2px;">
            Answered: ${escapeHtml(value ?? '(no answer)')}${!isCorrect ? ` · Correct: ${escapeHtml(q.answer)}` : ''}
            ${usedMeaning && isCorrect ? ' · meaning was shown, half credit' : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

function toggleReview(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function deleteQuiz(id) {
  if (!confirm('Delete this quiz and all of its responses? This cannot be undone.')) return;
  await Api.deleteQuiz(id);
  go('teacher');
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (!btn) return;
    const original = btn.innerHTML;
    btn.innerHTML = `${icon('check')} Copied`;
    setTimeout(() => { btn.innerHTML = original; }, 1600);
  });
}

// ---------------------------------------------------------------------
// Student: join
// ---------------------------------------------------------------------

function getQueryParam(name) {
  const match = window.location.hash.match(new RegExp(`[?&]${name}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function renderStudent(rest) {
  const page = rest[0];
  if (page === 'quiz') return renderStudentQuiz();
  if (page === 'done') return renderStudentDone();
  return renderStudentJoin();
}

function renderStudentJoin() {
  const prefillCode = getQueryParam('code');
  mainEl().innerHTML = `
    <button class="muted-link" style="margin-bottom: 18px;" onclick="go('')">${icon('arrowLeft')} Back home</button>
    <div class="card" style="max-width: 420px; margin: 20px auto;">
      <div class="icon" style="color: var(--accent); margin-bottom: 10px;">${icon('student', 26)}</div>
      <h2>Join a quiz</h2>
      <p>Ask your teacher for the 6-digit code.</p>
      <form id="join-form">
        <div class="field">
          <label>Quiz code</label>
          <input class="input input-code" id="join-code" maxlength="6" inputmode="numeric" placeholder="000000" value="${escapeHtml(prefillCode)}" required />
        </div>
        <div class="field">
          <label>Your name</label>
          <input class="input" id="join-name" placeholder="e.g. Wei Ling" required maxlength="60" />
        </div>
        <div id="join-error" class="error-text"></div>
        <button class="btn btn-primary btn-block" type="submit">${icon('arrowRight')} Start quiz</button>
      </form>
    </div>
  `;

  document.getElementById('join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('join-code').value.trim();
    const name = document.getElementById('join-name').value.trim();
    const errorEl = document.getElementById('join-error');
    errorEl.textContent = '';
    try {
      const { attemptId, quiz } = await Api.joinQuiz(code, name);
      state.studentAttemptId = attemptId;
      state.studentQuiz = quiz;
      state.studentAnswers = {};
      state.studentQuestionIndex = 0;
      state.studentMeaningOn = false;
      state.studentQuestionStartTimes = {};
      go('student/quiz');
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

// ---------------------------------------------------------------------
// Student: taking the quiz (one question at a time)
// ---------------------------------------------------------------------

function renderStudentQuiz() {
  if (!state.studentQuiz) return go('student/join');
  clearQuestionTimer();

  const quiz = state.studentQuiz;
  const i = state.studentQuestionIndex;
  const q = quiz.questions[i];
  const total = quiz.questions.length;
  const isLast = i === total - 1;
  const currentAnswer = state.studentAnswers[q.id];
  const currentValue = currentAnswer ? currentAnswer.value : undefined;
  const showMeaning = state.studentMeaningOn && (q.questionMeaning || q.optionMeanings);
  const timeLimitSeconds = quiz.timeLimitSeconds || 0;

  // Only stamped the first time this question is shown - re-renders
  // from selecting an option, toggling meaning, etc. don't reset it.
  if (timeLimitSeconds > 0 && state.studentQuestionStartTimes[q.id] === undefined) {
    state.studentQuestionStartTimes[q.id] = Date.now();
  }

  const optionsHtml = q.options.map((opt, idx) => `
    <div class="option ${currentValue === opt ? 'selected' : ''}" data-option-index="${idx}">
      <span class="option-marker"></span>
      <span>
        <span>${escapeHtml(opt)}</span>
        ${showMeaning && q.optionMeanings ? `<span class="option-meaning">${escapeHtml(q.optionMeanings[idx])}</span>` : ''}
      </span>
    </div>`).join('');

  mainEl().innerHTML = `
    <div class="progress-track"><div class="progress-fill" style="width:${((i + 1) / total) * 100}%"></div></div>

    ${timeLimitSeconds > 0 ? `
      <div class="timer-row">
        <span>${icon('clock', 14)} Answer quickly for a speed bonus</span>
        <span id="timer-value">${timeLimitSeconds}s</span>
      </div>
      <div class="timer-track"><div class="timer-fill" id="timer-fill" style="width:100%"></div></div>
    ` : ''}

    <label class="switch-label" id="meaning-toggle-label">
      <input type="checkbox" id="meaning-toggle" ${state.studentMeaningOn ? 'checked' : ''} />
      <span class="switch-track"></span>
      <span>Show meaning - correct answers earn half credit while it's on</span>
    </label>

    <div class="question-block">
      <div class="question-index">Question ${i + 1} of ${total}</div>
      <div class="question-text">${escapeHtml(q.question)}</div>
      ${showMeaning && q.questionMeaning ? `<div class="meaning-text">${escapeHtml(q.questionMeaning)}</div>` : ''}
      <div class="option-list">${optionsHtml}</div>
    </div>
    <div class="row-between">
      <button class="btn btn-ghost" ${i === 0 ? 'disabled' : ''} onclick="studentPrev()">${icon('arrowLeft')} Back</button>
      ${isLast
        ? `<button class="btn btn-primary" onclick="studentSubmit()">${icon('check')} Submit quiz</button>`
        : `<button class="btn btn-primary" onclick="studentNext()">Next ${icon('arrowRight')}</button>`}
    </div>
  `;

  // Bound with addEventListener (not inline onclick) so option text -
  // Hanzi, pinyin, quotes, anything - never has to survive being
  // embedded inside an HTML attribute string.
  mainEl().querySelectorAll('.option').forEach((el) => {
    el.addEventListener('click', () => {
      const opt = q.options[Number(el.dataset.optionIndex)];
      selectAnswer(q.id, opt);
    });
  });

  document.getElementById('meaning-toggle').addEventListener('change', (e) => {
    state.studentMeaningOn = e.target.checked;
    renderStudentQuiz();
  });

  if (timeLimitSeconds > 0) startQuestionTimer(q.id, timeLimitSeconds, isLast);
}

// Ticks the visible countdown for the current question. Reads the
// fixed start time stamped in renderStudentQuiz rather than counting
// its own elapsed time, so re-renders (selecting an option, toggling
// meaning) never reset or double-count the clock.
function startQuestionTimer(questionId, timeLimitSeconds, isLast) {
  const startedAt = state.studentQuestionStartTimes[questionId];
  const limitMs = timeLimitSeconds * 1000;

  const tick = () => {
    const valueEl = document.getElementById('timer-value');
    const fillEl = document.getElementById('timer-fill');
    if (!valueEl || !fillEl) {
      // The student navigated away from this question already -
      // nothing left to update, stop ticking.
      clearQuestionTimer();
      return;
    }
    const remainingMs = Math.max(0, limitMs - (Date.now() - startedAt));
    valueEl.textContent = `${Math.ceil(remainingMs / 1000)}s`;
    fillEl.style.width = `${(remainingMs / limitMs) * 100}%`;

    if (remainingMs <= 0) {
      clearQuestionTimer();
      valueEl.textContent = "Time's up";
      setTimeout(() => { isLast ? studentSubmit() : studentNext(); }, 900);
    }
  };
  tick();
  questionTimerInterval = setInterval(tick, 250);
}

function selectAnswer(questionId, value) {
  const startedAt = state.studentQuestionStartTimes[questionId];
  const timeTakenMs = typeof startedAt === 'number' ? Date.now() - startedAt : undefined;
  state.studentAnswers[questionId] = { value, usedMeaning: state.studentMeaningOn, timeTakenMs };
  renderStudentQuiz();
}

function studentNext() {
  state.studentQuestionIndex++;
  renderStudentQuiz();
}

function studentPrev() {
  state.studentQuestionIndex--;
  renderStudentQuiz();
}

async function studentSubmit() {
  const result = await Api.submitAttempt(state.studentAttemptId, state.studentAnswers);
  state.studentResult = result;
  go('student/done');
}

function renderStudentDone() {
  const result = state.studentResult;
  if (!result) return go('');

  mainEl().innerHTML = `
    <div style="text-align:center; padding-top: 30px;">
      <div class="seal ${result.score / result.total >= 0.6 ? 'jade' : ''}" style="margin: 0 auto 20px;">
        <span class="seal-score">${result.score}</span>
        <span class="seal-total">of ${result.total}</span>
      </div>
      <h2>Quiz submitted</h2>
      <p>
        Your teacher can see your result now.
        ${result.score > result.total ? ' Nice - you answered fast enough to earn a speed bonus.' : ''}
        ${result.meaningUsedCount ? ` Meaning was shown on ${result.meaningUsedCount} question${result.meaningUsedCount === 1 ? '' : 's'}, so those only earned half credit if correct.` : ''}
      </p>
      <button class="btn btn-ghost" onclick="go('')">${icon('arrowLeft')} Back home</button>
    </div>
  `;
}
