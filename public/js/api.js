// api.js
//
// Every request goes through here so the auth token and error
// handling live in one place. There's one shared "authToken" in
// localStorage - whichever account (teacher or student) most
// recently logged in - since a browser is only ever one person at a
// time in this app.

const Api = (() => {
  function authToken() {
    return localStorage.getItem('authToken') || '';
  }

  async function request(method, url, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (opts.auth !== false) {
      const token = authToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }

    if (!res.ok) {
      const message = (data && data.error) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.details = data && data.details;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    // Auth - shared by both roles, `role` is 'teacher' or 'student'
    signup: (username, password, role) => request('POST', '/api/auth/signup', { username, password, role }, { auth: false }),
    login: (username, password) => request('POST', '/api/auth/login', { username, password }, { auth: false }),
    me: () => request('GET', '/api/auth/me'),

    // Teacher quiz management
    listQuizzes: () => request('GET', '/api/quizzes'),
    createQuiz: (quizJson) => request('POST', '/api/quizzes', quizJson),
    getQuiz: (id) => request('GET', `/api/quizzes/${id}`),
    deleteQuiz: (id) => request('DELETE', `/api/quizzes/${id}`),
    updateQuizSettings: (id, settings) => request('PATCH', `/api/quizzes/${id}/settings`, settings),
    getResults: (id) => request('GET', `/api/quizzes/${id}/results`),

    // Student flow
    peekQuiz: (code) => request('GET', `/api/join/${code}`, undefined, { auth: false }),
    joinQuiz: (code) => request('POST', `/api/join/${code}`, {}),
    submitAttempt: (attemptId, answers) => request('POST', `/api/attempts/${attemptId}/submit`, { answers }),
    checkAnswer: (attemptId, questionId, value, usedMeaning, answeredAtMs) =>
      request('POST', `/api/attempts/${attemptId}/answer`, { questionId, value, usedMeaning, answeredAtMs }),
  };
})();
