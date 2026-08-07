// api.js
//
// Every request goes through here so the teacher passcode header and
// error handling live in one place.

const Api = (() => {
  function teacherKey() {
    return localStorage.getItem('teacherKey') || '';
  }

  async function request(method, url, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (opts.asTeacher) headers['x-teacher-key'] = teacherKey();

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
    // Teacher auth
    login: (passcode) => request('POST', '/api/teacher/login', { passcode }),

    // Teacher quiz management
    listQuizzes: () => request('GET', '/api/quizzes', undefined, { asTeacher: true }),
    createQuiz: (quizJson) => request('POST', '/api/quizzes', quizJson, { asTeacher: true }),
    getQuiz: (id) => request('GET', `/api/quizzes/${id}`, undefined, { asTeacher: true }),
    deleteQuiz: (id) => request('DELETE', `/api/quizzes/${id}`, undefined, { asTeacher: true }),
    updateQuizSettings: (id, settings) => request('PATCH', `/api/quizzes/${id}/settings`, settings, { asTeacher: true }),
    getResults: (id) => request('GET', `/api/quizzes/${id}/results`, undefined, { asTeacher: true }),

    // Student flow
    peekQuiz: (code) => request('GET', `/api/join/${code}`),
    joinQuiz: (code, studentName) => request('POST', `/api/join/${code}`, { studentName }),
    submitAttempt: (attemptId, answers) => request('POST', `/api/attempts/${attemptId}/submit`, { answers }),
  };
})();
