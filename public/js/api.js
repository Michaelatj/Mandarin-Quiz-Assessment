// api.js
//
// Every request goes through here so the teacher passcode header and
// error handling live in one place.

const Api = (() => {
  function teacherKey() {
    return localStorage.getItem('teacherKey') || '';
  }
  
  function studentData() {
    const data = localStorage.getItem('studentData');
    return data ? JSON.parse(data) : null;
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
    registerTeacher: (name, username, password, ownerKey) => 
      request('POST', '/api/teacher/register', { name, username, password, ownerKey }),
    getTeachers: () => request('GET', '/api/teachers', undefined, { asTeacher: true }),
    deleteTeacher: (id) => request('DELETE', `/api/teachers/${id}`, undefined, { asTeacher: true }),

    // Student accounts
    registerStudent: (name, pin) => request('POST', '/api/students/register', { name, pin }),
    getStudents: () => request('GET', '/api/students', undefined, { asTeacher: true }),
    
    // Save/load student session data
    saveStudentSession: (studentId, name, hasPin) => {
      localStorage.setItem('studentData', JSON.stringify({ id: studentId, name, hasPin }));
    },
    getStudentSession: () => studentData(),
    clearStudentSession: () => localStorage.removeItem('studentData'),

    // Teacher quiz management
    listQuizzes: () => request('GET', '/api/quizzes', undefined, { asTeacher: true }),
    createQuiz: (quizJson) => request('POST', '/api/quizzes', quizJson, { asTeacher: true }),
    getQuiz: (id) => request('GET', `/api/quizzes/${id}`, undefined, { asTeacher: true }),
    deleteQuiz: (id) => request('DELETE', `/api/quizzes/${id}`, undefined, { asTeacher: true }),
    updateQuizSettings: (id, settings) => request('PATCH', `/api/quizzes/${id}/settings`, settings, { asTeacher: true }),
    getResults: (id) => request('GET', `/api/quizzes/${id}/results`, undefined, { asTeacher: true }),

    // Student flow
    peekQuiz: (code) => request('GET', `/api/join/${code}`),
    joinQuiz: (code, studentName, studentPin, studentId) => 
      request('POST', `/api/join/${code}`, { studentName, studentPin, studentId }),
    submitAttempt: (attemptId, answers) => request('POST', `/api/attempts/${attemptId}/submit`, { answers }),
  };
})();
