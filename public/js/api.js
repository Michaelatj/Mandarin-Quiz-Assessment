// api.js
const Api = (() => {
  function teacherKey() {
    return localStorage.getItem('teacherKey') || '';
  }

  async function request(method, url, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (opts.teacher) headers['x-teacher-key'] = teacherKey();

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch (_) {}

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
    login: (passcode) => request('POST', '/api/login', { passcode }),

    // Teacher quiz management
    listQuizzes: () => request('GET', '/api/quizzes', undefined, { teacher: true }),
    createQuiz: (quizJson) => request('POST', '/api/quizzes', quizJson, { teacher: true }),
    getQuiz: (id) => request('GET', `/api/quizzes/${id}`, undefined, { teacher: true }),
    deleteQuiz: (id) => request('DELETE', `/api/quizzes/${id}`, undefined, { teacher: true }),
    updateQuizTitle: (id, title) => request('PATCH', `/api/quizzes/${id}/title`, { title }, { teacher: true }),
    updateQuizSettings: (id, settings) => request('PATCH', `/api/quizzes/${id}/settings`, settings, { teacher: true }),
    updateQuizQuestions: (id, questions) => request('PATCH', `/api/quizzes/${id}/questions`, { questions }, { teacher: true }),
    getResults: (id) => request('GET', `/api/quizzes/${id}/results`, undefined, { teacher: true }),

    // Student flow
    peekQuiz: (code) => request('GET', `/api/join/${code}`),
    joinQuiz: (code, studentName) => request('POST', `/api/join/${code}`, { studentName }),
    submitAttempt: (attemptId, answers) => request('POST', `/api/attempts/${attemptId}/submit`, { answers }),
    checkAnswer: (attemptId, questionId, value, usedMeaning, answeredAtMs, quizId) =>
      request('POST', `/api/attempts/${attemptId}/answer`, { questionId, value, usedMeaning, answeredAtMs, quizId }),
  };
})();
