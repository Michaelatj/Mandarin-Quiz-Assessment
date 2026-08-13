// app.js
//
// A small hash-router SPA. Each route has a render function that
// returns an HTML string for <main>. State that needs to survive
// between renders (like the quiz a student is mid-way through) lives
// in the `state` object below, not in the DOM.

const state = {
  studentAttemptId: null,
  studentQuiz: null,
  studentAnswers: {}, // { [questionId]: { value, usedMeaning, answeredAtMs, correct } }
  studentQuestionIndex: 0,
  studentHintsUsed: {}, // { [questionId]: true }
  studentReorderProgress: {}, // { [questionId]: [chunkId, ...] }
  studentQuizStartedAt: null,
  studentStreak: 0,
  studentBestStreak: 0,
};

let quizTimerInterval = null;
function clearQuizTimer() {
  if (quizTimerInterval) {
    clearInterval(quizTimerInterval);
    quizTimerInterval = null;
  }
}

// ---------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freq, startAt, durationSec, type = 'sine', peakGain = 0.12) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
  gain.gain.linearRampToValueAtTime(peakGain, ctx.currentTime + startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + durationSec);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + startAt);
  osc.stop(ctx.currentTime + startAt + durationSec + 0.02);
}

function playCorrectSound() {
  try { playTone(880, 0, 0.14, 'sine', 0.1); } catch (_) {}
}
function playIncorrectSound() {
  try { playTone(180, 0, 0.22, 'sawtooth', 0.06); } catch (_) {}
}
function playStreakSound(streak) {
  try {
    const notes = [660, 880, 1046, 1318, 1568];
    const tier = streak >= 10 ? 5 : streak >= 5 ? 4 : 3;
    for (let i = 0; i < tier; i++) playTone(notes[i], i * 0.07, 0.16, 'triangle', 0.1);
  } catch (_) {}
}

// ---------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------
let toastTimeout = null;
function showToast(text, variant = 'jade') {
  const el = document.getElementById('streak-banner');
  if (!el) return;
  clearTimeout(toastTimeout);
  el.textContent = text;
  el.classList.remove('show', 'toast-jade', 'toast-warn', 'toast-big');
  void el.offsetWidth;
  el.classList.add('show', variant === 'warn' ? 'toast-warn' : 'toast-jade');
  toastTimeout = setTimeout(() => el.classList.remove('show'), 1700);
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
    render();
  }
}

// ---------------------------------------------------------------------
// Theme switcher
// ---------------------------------------------------------------------

const THEMES = [
  { id: 'ricepaper', name: 'Rice Paper', swatch: '#8a5a35' },
  { id: 'ink-seal', name: 'Ink & Seal', swatch: '#c1442d' },
  { id: 'teahouse', name: 'Tea House', swatch: '#c88a35' },
  { id: 'midnightjade', name: 'Midnight Jade', swatch: '#5f9c7a' },
  { id: 'plumlantern', name: 'Plum Lantern', swatch: '#c0567a' },
];

function currentTheme() {
  return localStorage.getItem('appTheme') || 'ricepaper';
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
    <nav class="nav-menu">
      <a href="#home-top">Home</a>
      <a href="#how-it-works">How It Works</a>
      <a href="#features">Features</a>
      <a href="#choose-role">Get Started</a>
    </nav>

    <div class="hero reveal" id="home-top">
      <div class="eyebrow">${icon('paper', 12)} A self-hosted classroom quiz tool</div>
      <h1>A quiet place to quiz</h1>
      <p class="lede">Bring questions your AI chatbot wrote, share a 6-digit code, and watch understanding show up in real time - no accounts required to take a quiz, no spreadsheets to grade by hand.</p>
    </div>

    <div class="section-title reveal" id="how-it-works">${icon('copy', 14)} How it works</div>
    <div class="use-case-grid">
      <div class="use-case-card reveal">
        <div class="step">01</div>
        <h4>Teacher writes a quiz in minutes</h4>
        <p>Paste your lesson material into any free AI chatbot with our ready-made prompt, then drop the JSON it returns straight into the app.</p>
      </div>
      <div class="use-case-card reveal">
        <div class="step">02</div>
        <h4>Students join with a code</h4>
        <p>No sign-up, no app download - just the 6-digit code and their name, then straight into the quiz with a single overall timer.</p>
      </div>
      <div class="use-case-card reveal">
        <div class="step">03</div>
        <h4>Everyone sees results instantly</h4>
        <p>Streaks and speed bonuses keep it fun while it's happening; the teacher's dashboard shows accuracy and full answer review right after.</p>
      </div>
    </div>

    <div class="section-title reveal" id="features">${icon('users', 14)} Built for a real classroom</div>
    <div class="use-case-grid">
      <div class="use-case-card reveal">
        <div class="step">${icon('clock', 16)}</div>
        <h4>One quiz-wide timer</h4>
        <p>A single countdown for the whole quiz, not per question - fairer for students who think longer on one hard character.</p>
      </div>
      <div class="use-case-card reveal">
        <div class="step">${icon('check', 16)}</div>
        <h4>Streaks that feel like a game</h4>
        <p>Consecutive correct answers trigger an on-screen streak animation, on top of a separate XP score built for fun, not grading.</p>
      </div>
      <div class="use-case-card reveal">
        <div class="step">${icon('paper', 16)}</div>
        <h4>Two scores, two purposes</h4>
        <p>An accuracy score out of 100 for the gradebook, and an uncapped XP score that rewards speed and streaks for the student.</p>
      </div>
    </div>

    <div class="section-title reveal" id="choose-role">${icon('arrowRight', 14)} Choose your role</div>
    <div class="choice-grid">
      <div class="choice-card reveal" onclick="go('teacher')">
        <div class="icon">${icon('chalkboard', 30)}</div>
        <h3>I'm the teacher</h3>
        <p>Create quizzes and review results</p>
      </div>
      <div class="choice-card reveal" onclick="go('student/join')">
        <div class="icon">${icon('student', 30)}</div>
        <h3>I'm a student</h3>
        <p>Enter a code and take a quiz</p>
      </div>
    </div>
  `;
  initScrollReveal();
}

function initScrollReveal() {
  if (window.__revealObserver) window.__revealObserver.disconnect();
  const groups = {};
  const els = Array.from(mainEl().querySelectorAll('.reveal'));
  els.forEach((el) => {
    const parentKey = el.parentElement;
    groups[parentKey] = groups[parentKey] || 0;
    el.style.setProperty('--delay', groups[parentKey]);
    groups[parentKey] += 1;
  });

  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('in-view'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  els.forEach((el) => io.observe(el));
  window.__revealObserver = io;
}

// ---------------------------------------------------------------------
// Teacher: Auth & Dashboard
// ---------------------------------------------------------------------

function isTeacherLoggedIn() {
  return !!localStorage.getItem('teacherKey');
}

function teacherLogout() {
  localStorage.removeItem('teacherKey');
  go('');
}

function renderTeacherLogin() {
  mainEl().innerHTML = `
    <button class="muted-link" style="margin-bottom: 18px;" onclick="go('')">${icon('arrowLeft')} Back home</button>
    <div class="card" style="max-width: 420px; margin: 20px auto;">
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

async function renderTeacherDashboard() {
  mainEl().innerHTML = `<div class="empty-state"><p>Loading your quizzes…</p></div>`;
  const quizzes = await Api.listQuizzes();

  const listHtml = quizzes.length ? quizzes.map((q) => `
    <div class="list-card" onclick="go('teacher/quiz/${q.id}')">
      <div>
        <div style="display:flex; align-items:center; gap:8px;">
          <div class="list-card-title">${escapeHtml(q.title)}</div>
          <button class="btn btn-ghost btn-sm" title="Edit Title" data-quiz-id="${q.id}" data-quiz-title="${escapeHtml(q.title)}" onclick="event.stopPropagation(); editQuizTitle(this)">${icon('paper', 12)} Edit Title</button>
        </div>
        <div class="list-card-meta">
          <span>${icon('paper', 14)} ${q.questionCount} questions</span>
          <span>${icon('users', 14)} ${q.attemptCount} responses</span>
          <span>${icon('clock', 14)} ${formatDate(q.createdAt)}</span>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="badge">${icon('key', 13)} ${q.code}</span>
        <button class="btn btn-danger btn-sm" title="Delete Quiz" onclick="event.stopPropagation(); deleteQuiz('${q.id}')">${icon('trash')}</button>
      </div>
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
// Modal - small centered dialog with a dimmed backdrop. Click the
// backdrop or press Escape to dismiss.
// ---------------------------------------------------------------------
function modalEscHandler(e) {
  if (e.key === 'Escape') closeModal();
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  document.removeEventListener('keydown', modalEscHandler);
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(() => overlay.remove(), 160);
}

function openModal(innerHtml, { onMount } = {}) {
  const prev = document.getElementById('modal-overlay');
  if (prev) prev.remove();
  document.removeEventListener('keydown', modalEscHandler);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-card">${innerHtml}</div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.body.appendChild(overlay);
  document.addEventListener('keydown', modalEscHandler);
  requestAnimationFrame(() => overlay.classList.add('show'));

  if (onMount) onMount(overlay);
}

// Edit quiz title - opens a small modal with the current name
// pre-filled and selected, ready to type over.
function editQuizTitle(btn) {
  const quizId = btn.dataset.quizId;
  const currentTitle = btn.dataset.quizTitle;

  openModal(`
    <div class="modal-icon">${icon('paper', 20)}</div>
    <h3 class="modal-title">Rename quiz</h3>
    <p class="modal-subtitle">Students see this title when they join with the quiz code.</p>
    <div class="field" style="margin-bottom: 4px;">
      <input class="input" id="modal-title-input" maxlength="120" value="${escapeHtml(currentTitle)}" />
    </div>
    <div class="error-text" id="modal-title-error"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" type="button" id="modal-cancel-btn">Cancel</button>
      <button class="btn btn-primary" type="button" id="modal-save-btn">${icon('check', 14)} Save name</button>
    </div>
  `, {
    onMount: (overlay) => {
      const input = overlay.querySelector('#modal-title-input');
      const errorEl = overlay.querySelector('#modal-title-error');
      const saveBtn = overlay.querySelector('#modal-save-btn');
      input.focus();
      input.select();

      const save = async () => {
        const newTitle = input.value.trim();
        errorEl.textContent = '';
        if (!newTitle) { errorEl.textContent = "Quiz name can't be empty."; return; }
        if (newTitle === currentTitle) { closeModal(); return; }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
          await Api.updateQuizTitle(quizId, newTitle);
          closeModal();
          render();
        } catch (err) {
          errorEl.textContent = err.message;
          saveBtn.disabled = false;
          saveBtn.innerHTML = `${icon('check', 14)} Save name`;
        }
      };

      overlay.querySelector('#modal-cancel-btn').addEventListener('click', closeModal);
      saveBtn.addEventListener('click', save);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    },
  });
}

// ---------------------------------------------------------------------
// Teacher: new quiz
// ---------------------------------------------------------------------

function renderTeacherNewQuiz() {
  mainEl().innerHTML = `
    <button class="muted-link" style="margin-bottom: 18px;" onclick="go('teacher')">${icon('arrowLeft')} Back to quizzes</button>
    <h1>New quiz</h1>
    <p>Two steps: get a quiz written for you by any free AI chatbot, then paste what it gives you below.</p>

    <div class="section-title">${icon('copy', 14)} Step 1 · Copy this prompt</div>
    <div class="row-between" style="align-items:flex-end; flex-wrap:wrap; gap:16px; margin-bottom:14px;">
      <div class="field" style="max-width:220px; margin-bottom:0;">
        <label>Student HSK level</label>
        <select class="input" id="hsk-level">
          ${[1, 2, 3, 4, 5, 6].map((lvl) => `<option value="${lvl}" ${lvl === 1 ? 'selected' : ''}>HSK ${lvl}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="max-width:140px; margin-bottom:0;">
        <label>Number of questions</label>
        <input class="input" type="number" id="question-count" min="4" max="30" value="10" />
      </div>
    </div>

    <div class="field" style="margin-bottom:14px;">
      <label>Question types to include</label>
      <div class="kind-grid">
        ${QUESTION_KINDS.map((k) => `
          <label class="kind-check">
            <input type="checkbox" data-kind-id="${k.id}" ${k.defaultOn ? 'checked' : ''} />
            <span>
              <span class="kind-check-label">${escapeHtml(k.label)}</span>
              <span class="kind-check-hint">${escapeHtml(k.hint)}</span>
            </span>
          </label>
        `).join('')}
      </div>
      <div id="kind-error" class="error-text"></div>
    </div>

    <p style="margin-bottom:10px;">Paste it into ChatGPT, Gemini, Grok, Claude, or any chatbot, with your lesson material dropped in where marked.</p>
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
  const countInput = document.getElementById('question-count');
  const kindCheckboxes = Array.from(document.querySelectorAll('[data-kind-id]'));
  const kindError = document.getElementById('kind-error');

  const updatePromptText = () => {
    const kindIds = kindCheckboxes.filter((c) => c.checked).map((c) => c.dataset.kindId);
    if (kindIds.length === 0) {
      kindError.textContent = 'Pick at least one question type.';
      promptBox.textContent = '';
      return;
    }
    kindError.textContent = '';
    let count = parseInt(countInput.value, 10);
    if (!Number.isFinite(count) || count < 1) count = 10;
    count = Math.min(30, Math.max(4, count));
    promptBox.textContent = buildQuizPrompt({ hskLevel: levelSelect.value, questionCount: count, kindIds });
  };
  updatePromptText();
  levelSelect.addEventListener('change', updatePromptText);
  countInput.addEventListener('input', updatePromptText);
  kindCheckboxes.forEach((c) => c.addEventListener('change', updatePromptText));

  document.getElementById('quiz-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('quiz-error');
    errorEl.innerHTML = '';
    let parsed;
    try {
      parsed = JSON.parse(document.getElementById('quiz-json').value);
    } catch (err) {
      errorEl.textContent = 'That is not valid JSON. Besides making sure you copied the whole { ... } block, the most common cause is a straight " character left inside a question or option - that breaks the format.';
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
        <div style="display:flex; align-items:center; gap:10px;">
          <h1 style="margin-bottom:4px;">${escapeHtml(quiz.title)}</h1>
          <button class="btn btn-ghost btn-sm" data-quiz-id="${quiz.id}" data-quiz-title="${escapeHtml(quiz.title)}" onclick="editQuizTitle(this)">${icon('paper', 12)} Edit Title</button>
        </div>
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
      <label>Total time limit for the whole quiz (seconds)</label>
      <input class="input" type="number" min="0" step="1" id="time-limit-input" value="${quiz.timeLimitSeconds || 0}" placeholder="0 = off" />
      <p style="margin:6px 0 0; font-size:12px;">0 turns the timer off.</p>
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
    : `<div class="seal ${attempt.accuracyScore >= 60 ? 'jade' : ''}"><span class="seal-score">${attempt.accuracyScore}</span><span class="seal-total">of 100</span></div>`;

  const reviewId = `review-${attempt.id}`;

  return `
    <div class="attempt-row" style="align-items:flex-start; flex-direction:column;">
      <div style="display:flex; align-items:center; gap:16px; width:100%;">
        ${seal}
        <div class="attempt-info">
          <div class="attempt-name">${escapeHtml(attempt.studentName)}${attempt.title ? ` <span class="badge">${icon(attempt.title.icon, 11)} ${escapeHtml(attempt.title.name)} (${escapeHtml(attempt.title.pinyin)})</span>` : ''}</div>
          <div class="attempt-meta">
            ${pending ? 'Started' : 'Submitted'} ${formatDate(attempt.submittedAt || attempt.startedAt)}
            ${!pending ? ` &middot; ${attempt.xpScore} XP${attempt.longestStreak >= 3 ? ` &middot; best streak ${attempt.longestStreak}` : ''}` : ''}
          </div>
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

    let isCorrect, answeredText, correctText;
    if (q.type === 'sentence_reorder') {
      const total = q.chunks.length;
      isCorrect = Array.isArray(value) && value.length === total && value.every((id, idx) => id === idx);
      answeredText = Array.isArray(value) ? value.map((id) => q.chunks[id]).join(' ') : '(no answer)';
      correctText = q.chunks.join(' ');
    } else {
      isCorrect = value === q.answer;
      answeredText = value ?? '(no answer)';
      correctText = q.answer;
    }

    return `
      <div class="answer-line">
        <span class="mark ${isCorrect ? 'correct' : 'incorrect'}">${icon(isCorrect ? 'check' : 'x', 15)}</span>
        <div>
          <div>${escapeHtml(q.question)}</div>
          <div style="color:var(--text-faint); font-size:12.5px; margin-top:2px;">
            Answered: ${escapeHtml(answeredText)}${!isCorrect ? ` · Correct: ${escapeHtml(correctText)}` : ''}
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
// Student: join & quiz
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
      state.studentHintsUsed = {};
      state.studentReorderProgress = {};
      state.studentQuizStartedAt = Date.now();
      state.studentStreak = 0;
      state.studentBestStreak = 0;
      go('student/quiz');
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

function studentSurrender() {
  if (confirm("Are you sure you want to surrender? Your progress will be cancelled.")) {
    clearQuizTimer();
    state.studentAttemptId = null;
    state.studentQuiz = null;
    state.studentAnswers = {};
    state.studentQuestionIndex = 0;
    go('student/join');
  }
}

function renderStudentQuiz() {
  if (!state.studentQuiz) return go('student/join');
  if (!state.studentQuiz.questions || state.studentQuiz.questions.length === 0) {
    mainEl().innerHTML = `
      <div class="empty-state">
        <p>This quiz has no questions - ask your teacher to check it.</p>
        <button class="btn btn-ghost" onclick="go('')">${icon('arrowLeft')} Back home</button>
      </div>
    `;
    return;
  }
  clearQuizTimer();

  const quiz = state.studentQuiz;
  const i = state.studentQuestionIndex;
  const q = quiz.questions[i];
  const total = quiz.questions.length;
  const isLast = i === total - 1;
  const hintUsed = !!state.studentHintsUsed[q.id];
  const showMeaning = hintUsed && !!q.questionMeaning;
  const timeLimitSeconds = quiz.timeLimitSeconds || 0;
  const answered = !!state.studentAnswers[q.id];

  const answerAreaHtml = q.type === 'sentence_reorder' ? renderReorderArea(q) : renderMultipleChoiceArea(q, hintUsed);

  // Two-step answering: picking an option only highlights it and can
  // still be changed. The first press of the primary button checks it
  // (revealing right/wrong) instead of moving on; only once it's been
  // checked (or was left blank) does the same button advance.
  const currentAnswer = state.studentAnswers[q.id];
  const isChecking = !!(currentAnswer && currentAnswer.checking);
  const hasUncheckedAnswer = !!currentAnswer && !currentAnswer.checked;
  const primaryLabel = isChecking
    ? 'Checking…'
    : hasUncheckedAnswer
      ? `Check answer ${icon('check')}`
      : (isLast ? `${icon('check')} Submit quiz` : `Next ${icon('arrowRight')}`);
  const primaryAction = 'studentCheckOrAdvance()';

  const qnavHtml = `
    <div class="qnav" id="qnav">
      ${quiz.questions.map((qq, idx) => {
        const a = state.studentAnswers[qq.id];
        let statusClass = '';
        if (a && a.checked) statusClass = a.correct === true ? 'qnav-correct' : 'qnav-incorrect';
        else if (a) statusClass = 'qnav-pending';
        return `<button type="button" class="qnav-item ${idx === i ? 'current' : ''} ${statusClass}" data-jump-index="${idx}" title="Question ${idx + 1}">${idx + 1}</button>`;
      }).join('')}
    </div>
  `;

  mainEl().innerHTML = `
    <div class="progress-track"><div class="progress-fill" style="width:${((i + 1) / total) * 100}%"></div></div>
    ${qnavHtml}

    ${timeLimitSeconds > 0 ? `
      <div class="timer-row">
        <span>${icon('clock', 14)} One timer for the whole quiz</span>
        <span id="timer-value">${timeLimitSeconds}s</span>
      </div>
      <div class="timer-track"><div class="timer-fill" id="timer-fill" style="width:100%"></div></div>
    ` : ''}

    ${state.studentStreak > 0 ? `
      <div class="streak-track"><span class="streak-flame">${icon('check', 14)}</span> ${state.studentStreak} in a row</div>
    ` : ''}

    <div class="question-block">
      <div class="row-between" style="margin-bottom: 2px;">
        <div class="question-index">Question ${i + 1} of ${total}</div>
        <button class="hint-lamp ${hintUsed ? 'lit' : ''}" id="hint-lamp-btn" type="button" ${answered ? 'disabled' : ''}>
          ${icon('lightbulb', 18)}
        </button>
      </div>
      <div class="question-text">${escapeHtml(q.question)}</div>
      ${showMeaning ? `<div class="meaning-text">${escapeHtml(q.questionMeaning)}</div>` : ''}
      ${answerAreaHtml}
    </div>
    <div class="row-between">
      <button class="btn btn-danger btn-sm" onclick="studentSurrender()">🏳️ Quit Quiz</button>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost" ${i === 0 || isChecking ? 'disabled' : ''} onclick="studentPrev()">${icon('arrowLeft')} Back</button>
        <button class="btn btn-primary" ${isChecking ? 'disabled' : ''} onclick="${primaryAction}">${primaryLabel}</button>
      </div>
    </div>
  `;

  mainEl().querySelectorAll('.qnav-item').forEach((el) => {
    el.addEventListener('click', () => {
      state.studentQuestionIndex = Number(el.dataset.jumpIndex);
      renderStudentQuiz();
    });
  });

  if (q.type === 'sentence_reorder') bindReorderEvents(q);
  else bindMultipleChoiceEvents(q);

  const hintBtn = document.getElementById('hint-lamp-btn');
  if (!answered) {
    hintBtn.addEventListener('click', () => {
      if (state.studentHintsUsed[q.id]) return;
      state.studentHintsUsed[q.id] = true;
      showToast('Hint shown - question now worth half credit', 'warn');
      renderStudentQuiz();
    });
  }

  if (timeLimitSeconds > 0) startQuizTimer(timeLimitSeconds, isLast);
}

function renderMultipleChoiceArea(q, hintUsed) {
  const currentAnswer = state.studentAnswers[q.id];
  const currentValue = currentAnswer ? currentAnswer.value : undefined;
  const showOptionMeanings = hintUsed && !!q.optionMeanings;
  // "locked" only kicks in once the answer has actually been checked -
  // before that, the student can freely tap a different option.
  const checked = !!(currentAnswer && currentAnswer.checked);
  const checking = !!(currentAnswer && currentAnswer.checking);

  const optionsHtml = q.options.map((opt, idx) => {
    let feedbackClass = '';
    if (checked && currentValue === opt) {
      feedbackClass = currentAnswer.correct === true ? 'answered-correct' : 'answered-incorrect';
    } else if (checking && currentValue === opt) {
      feedbackClass = 'checking';
    }
    return `
    <div class="option ${currentValue === opt ? 'selected' : ''} ${feedbackClass} ${checked || checking ? 'locked' : ''}" data-option-index="${idx}">
      <span class="option-marker"></span>
      <span>
        <span>${escapeHtml(opt)}</span>
        ${showOptionMeanings ? `<span class="option-meaning">${escapeHtml(q.optionMeanings[idx])}</span>` : ''}
      </span>
    </div>`;
  }).join('');

  return `<div class="option-list">${optionsHtml}</div>`;
}

function bindMultipleChoiceEvents(q) {
  const currentAnswer = state.studentAnswers[q.id];
  if (currentAnswer && (currentAnswer.checked || currentAnswer.checking)) return; // locked - checked or mid-check
  mainEl().querySelectorAll('.option').forEach((el) => {
    el.addEventListener('click', () => {
      const opt = q.options[Number(el.dataset.optionIndex)];
      selectOption(q.id, opt);
    });
  });
}

// Picking an option just records it as the pending choice - no server
// round trip, no lock. The student can tap a different option as many
// times as they like until they press "Check answer".
function selectOption(questionId, value) {
  const answeredAtMs = Date.now() - state.studentQuizStartedAt;
  const hintUsed = !!state.studentHintsUsed[questionId];
  state.studentAnswers[questionId] = { value, usedMeaning: hintUsed, answeredAtMs, correct: null, checked: false };
  renderStudentQuiz();
}

function renderReorderArea(q) {
  const currentAnswer = state.studentAnswers[q.id];
  const checked = !!(currentAnswer && currentAnswer.checked);
  const checking = !!(currentAnswer && currentAnswer.checking);
  const placed = currentAnswer ? currentAnswer.value : (state.studentReorderProgress[q.id] || []);
  const placedSet = new Set(placed);
  const pool = q.chunks.filter((c) => !placedSet.has(c.id));

  let assembledFeedbackClass = '';
  if (checked) {
    assembledFeedbackClass = currentAnswer.correct === true ? 'answered-correct' : 'answered-incorrect';
  } else if (checking) {
    assembledFeedbackClass = 'checking';
  }

  const chip = (chunk, kind) => `<div class="reorder-chip ${checked || checking ? 'locked' : ''}" data-chunk-id="${chunk.id}" data-chip-kind="${kind}">${escapeHtml(chunk.text)}</div>`;

  return `
    <div class="reorder-assembled ${assembledFeedbackClass}" id="reorder-assembled">
      ${placed.length === 0
        ? `<span class="reorder-placeholder">Tap words in order to build sentence</span>`
        : placed.map((id) => chip(q.chunks.find((c) => c.id === id), 'assembled')).join('')}
    </div>
    <div class="reorder-pool" id="reorder-pool">
      ${pool.map((c) => chip(c, 'pool')).join('')}
    </div>
    ${placed.length > 0 && !checked && !checking ? `<button type="button" class="muted-link" id="reorder-clear-btn" style="margin-top:8px;">Clear</button>` : ''}
  `;
}

function bindReorderEvents(q) {
  const total = q.chunks.length;
  const currentAnswer = state.studentAnswers[q.id];
  if (currentAnswer && (currentAnswer.checked || currentAnswer.checking)) return; // locked - checked or mid-check

  mainEl().querySelectorAll('.reorder-chip[data-chip-kind="pool"]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.chunkId);
      const placed = [...(state.studentReorderProgress[q.id] || []), id];
      if (placed.length === total) {
        // Fully assembled - becomes the pending answer, not checked yet.
        // The student can still hit Clear to rebuild it before checking.
        delete state.studentReorderProgress[q.id];
        const answeredAtMs = Date.now() - state.studentQuizStartedAt;
        const hintUsed = !!state.studentHintsUsed[q.id];
        state.studentAnswers[q.id] = { value: placed, usedMeaning: hintUsed, answeredAtMs, correct: null, checked: false };
      } else {
        state.studentReorderProgress[q.id] = placed;
      }
      renderStudentQuiz();
    });
  });

  mainEl().querySelectorAll('.reorder-chip[data-chip-kind="assembled"]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.chunkId);
      // If this was already the (unchecked) pending answer, tapping a
      // chip pulls it back out into the pool instead of clearing everything.
      const placed = (currentAnswer && !currentAnswer.checked ? currentAnswer.value : state.studentReorderProgress[q.id]) || [];
      const next = placed.filter((x) => x !== id);
      if (currentAnswer && !currentAnswer.checked) delete state.studentAnswers[q.id];
      state.studentReorderProgress[q.id] = next;
      renderStudentQuiz();
    });
  });

  const clearBtn = document.getElementById('reorder-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      delete state.studentReorderProgress[q.id];
      delete state.studentAnswers[q.id];
      renderStudentQuiz();
    });
  }
}

function startQuizTimer(timeLimitSeconds, isLast) {
  const limitMs = timeLimitSeconds * 1000;

  const tick = () => {
    const valueEl = document.getElementById('timer-value');
    const fillEl = document.getElementById('timer-fill');
    if (!valueEl || !fillEl) {
      clearQuizTimer();
      return;
    }
    const remainingMs = Math.max(0, limitMs - (Date.now() - state.studentQuizStartedAt));
    valueEl.textContent = `${Math.ceil(remainingMs / 1000)}s`;
    fillEl.style.width = `${(remainingMs / limitMs) * 100}%`;

    if (remainingMs <= 0) {
      clearQuizTimer();
      valueEl.textContent = "Time's up";
      setTimeout(() => studentSubmit(), 900);
    }
  };
  tick();
  quizTimerInterval = setInterval(tick, 250);
}

function explodeAt(el, emojis, count) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const container = document.createElement('div');
  container.className = 'fx-burst';
  container.style.left = `${cx}px`;
  container.style.top = `${cy}px`;
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span');
    span.className = 'fx-particle';
    span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    const angle = Math.random() * Math.PI * 2;
    const distance = 55 + Math.random() * 75;
    span.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    span.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
    span.style.setProperty('--rotate', `${Math.random() * 360 - 180}deg`);
    span.style.animationDelay = `${Math.random() * 0.06}s`;
    container.appendChild(span);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 900);
}

function sadPopAt(el) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const span = document.createElement('span');
  span.className = 'fx-sad';
  span.textContent = ['😢', '😔', '💧'][Math.floor(Math.random() * 3)];
  span.style.left = `${rect.left + rect.width / 2}px`;
  span.style.top = `${rect.top}px`;
  document.body.appendChild(span);
  setTimeout(() => span.remove(), 850);
}

// Sends the pending answer to the server and reveals right/wrong on
// screen. This only fires once the student has committed to an
// answer by pressing "Check answer" - not the moment they tap an
// option - so the correct/incorrect icon never appears early.
async function confirmCurrentAnswer(questionId) {
  const pending = state.studentAnswers[questionId];
  if (!pending || pending.checked || pending.checking) return;
  const { value, usedMeaning, answeredAtMs } = pending;

  // Optimistic "checking" state so the UI can show a pulse while waiting.
  state.studentAnswers[questionId] = { value, usedMeaning, answeredAtMs, correct: null, checked: false, checking: true };
  renderStudentQuiz();

  let correct = null;
  try {
    const res = await Api.checkAnswer(state.studentAttemptId, questionId, value, usedMeaning, answeredAtMs);
    correct = res.correct;
  } catch (err) {}

  state.studentAnswers[questionId] = { value, usedMeaning, answeredAtMs, correct, checked: true };

  if (correct === true) {
    state.studentStreak += 1;
    state.studentBestStreak = Math.max(state.studentBestStreak, state.studentStreak);
    if (state.studentStreak === 3 || state.studentStreak === 5 || (state.studentStreak >= 10 && state.studentStreak % 5 === 0)) {
      showToast(state.studentStreak >= 10 ? `${state.studentStreak} streak!!` : `${state.studentStreak} in a row!`, 'jade');
      playStreakSound(state.studentStreak);
    } else {
      showToast('Correct!', 'jade');
      playCorrectSound();
    }
  } else if (correct === false) {
    state.studentStreak = 0;
    playIncorrectSound();
  }

  if (state.studentQuiz.questions[state.studentQuestionIndex].id === questionId) {
    renderStudentQuiz();
    const q = state.studentQuiz.questions.find((qq) => qq.id === questionId);
    const el = q.type === 'sentence_reorder'
      ? document.getElementById('reorder-assembled')
      : mainEl().querySelector('.option.selected');
    if (correct === true) explodeAt(el, ['🎉', '✨', '⭐', '🎊'], 14);
    else if (correct === false) sadPopAt(el);
  }
}

// The single primary button on the quiz screen. First press on a
// freshly-picked answer checks it; press it again (or press it with
// nothing picked) and it moves on, submitting on the last question.
async function studentCheckOrAdvance() {
  const q = state.studentQuiz.questions[state.studentQuestionIndex];
  const current = state.studentAnswers[q.id];
  if (current && !current.checked) {
    await confirmCurrentAnswer(q.id);
    return;
  }
  const isLast = state.studentQuestionIndex === state.studentQuiz.questions.length - 1;
  if (isLast) {
    studentSubmit();
  } else {
    state.studentQuestionIndex++;
    renderStudentQuiz();
  }
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

  const isTopTitle = result.accuracyScore === 100 && result.longestStreak === state.studentQuiz.questions.length;

  mainEl().innerHTML = `
    <div style="text-align:center; padding-top: 30px;">
      <div class="title-reveal ${isTopTitle ? 'title-reveal-top' : ''}">
        <div class="title-reveal-label">You are</div>
        <div class="title-reveal-icon">${icon(result.title.icon, 34)}</div>
        <div class="title-reveal-name">${escapeHtml(result.title.name)} <span class="title-reveal-pinyin">(${escapeHtml(result.title.pinyin)})</span></div>
        <div class="title-reveal-meaning">${escapeHtml(result.title.meaning)}</div>
      </div>

      <div class="score-pair" style="margin:22px 0 20px;">
        <div class="score-block">
          <div class="seal ${result.accuracyScore >= 60 ? 'jade' : ''}">
            <span class="seal-score">${result.accuracyScore}</span>
            <span class="seal-total">of 100</span>
          </div>
          <div class="score-label">Accuracy</div>
        </div>
        <div class="score-block">
          <div class="xp-badge">${icon('check', 14)} ${result.xpScore} XP</div>
          <div class="score-label">Game score</div>
        </div>
      </div>

      <h2>Quiz submitted</h2>
      <p>Your teacher can see your result now.</p>
      <button class="btn btn-ghost" onclick="go('')">${icon('arrowLeft')} Back home</button>
    </div>
  `;

  if (isTopTitle) playStreakSound(10);
  else playCorrectSound();
}
