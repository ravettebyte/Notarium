'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { createApplication } = require('./server');
const bundledMedia = require('./seed-media');
const bundledCatalog = require('./seed-catalog');

test('full account, learning, media, attempt, exam, and notification API flow', async t => {
  const dataDir = path.join(__dirname, `.notarium-test-${process.pid}-${randomUUID()}`);
  const app = createApplication({ dataDir, examIdleMs: 1 });
  await app.initialize();
  const storeFile = path.join(dataDir, 'store.json');
  const legacyStore = JSON.parse(await fs.readFile(storeFile, 'utf8'));
  delete legacyStore.seeds;
  legacyStore.model.exerciseBlocks = [];
  legacyStore.model.exercises = [];
  await fs.writeFile(storeFile, JSON.stringify(legacyStore), 'utf8');
  await app.initialize();
  await app.initialize();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => app.server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const origin = `http://127.0.0.1:${app.server.address().port}`;
  async function request(method, route, { token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    if (payload) headers['Content-Length'] = payload.length;
    const response = await new Promise((resolve, reject) => {
      const url = new URL(route, origin);
      const clientRequest = http.request({
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers
      }, result => {
        const chunks = [];
        result.on('data', chunk => chunks.push(chunk));
        result.on('end', () => resolve({
          status: result.statusCode,
          headers: result.headers,
          body: Buffer.concat(chunks)
        }));
      });
      clientRequest.on('error', reject);
      if (payload) clientRequest.write(payload);
      clientRequest.end();
    });
    const contentType = response.headers['content-type'] || '';
    const result = contentType.includes('application/json')
      ? JSON.parse(response.body.toString('utf8'))
      : response.body;
    return { status: response.status, result, response };
  }

  const page = await request('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.response.headers['content-type'], /text\/html/);
  assert.match(page.result.toString(), /Notarium/);
  const chartBundle = await request('GET', '/chart.umd.js');
  assert.equal(chartBundle.status, 200);
  assert.match(chartBundle.response.headers['content-type'], /javascript/);
  assert.match(chartBundle.result.toString(), /Chart\.js/);
  assert.equal((await request('GET', '/node_modules/chart.js/dist/chart.umd.js')).status, 404);

  assert.deepEqual((await request('GET', '/api/setup')).result, { teacherExists: true });
  const teacherLogin = await request('POST', '/api/auth/login', {
    body: { username: 'professor', password: 'professor123' }
  });
  assert.equal(teacherLogin.status, 200);
  const teacherToken = teacherLogin.result.token;
  assert.equal(teacherLogin.result.user.role, 'teacher');
  assert.equal(teacherLogin.result.user.username, 'professor');
  const restoredTeacherSession = await request('GET', '/api/auth/session', { token: teacherToken });
  assert.equal(restoredTeacherSession.status, 200);
  assert.equal(restoredTeacherSession.result.user.id, teacherLogin.result.user.id);
  assert.equal(restoredTeacherSession.result.model.profile.role, 'teacher');
  assert.ok(Array.isArray(teacherLogin.result.model.lessons));
  assert.ok(Array.isArray(teacherLogin.result.model.trailSettings));
  assert.deepEqual(teacherLogin.result.model.exercises.map(item => item.id),
    bundledCatalog.exercises.map(item => item.id));
  assert.equal(teacherLogin.result.model.exerciseBlocks[0].title, 'Leitura rítmica');
  assert.equal(
    teacherLogin.result.model.exercises[0].questions.find(item => item.type === 'score').musicMediaId,
    bundledMedia[0].id
  );
  const bundledScore = await request('GET', '/api/media/c61679b6-f189-400a-8b47-1c33c11b7db9', {
    token: teacherToken
  });
  assert.equal(bundledScore.status, 200);
  assert.equal(bundledScore.result.length, 2087);
  assert.equal(bundledScore.response.headers['content-type'], 'application/vnd.recordare.musicxml');
  assert.equal(bundledScore.result.subarray(0, 4).toString('hex'), '504b0304');
  assert.equal((await request('POST', '/api/auth/bootstrap', {
    body: { name: 'Other', username: 'other.teacher', password: 'secure-password-2' }
  })).status, 409);

  const createdStudent = await request('POST', '/api/students', {
    token: teacherToken,
    body: { name: 'Estudante', username: 'student.one', password: 'student-password-1' }
  });
  assert.equal(createdStudent.status, 201);
  const studentId = createdStudent.result.student.id;
  assert.equal((await request('GET', '/api/students', { token: teacherToken })).result.students.length, 1);
  assert.equal((await request('GET', '/api/students')).status, 401);

  const login = await request('POST', '/api/auth/login', {
    body: { username: 'STUDENT.ONE', password: 'student-password-1' }
  });
  assert.equal(login.status, 200);
  let studentToken = login.result.token;
  assert.equal(login.result.user.id, studentId);
  assert.deepEqual(login.result.model.exercises.map(item => item.id),
    bundledCatalog.exercises.map(item => item.id));
  assert.equal((await request('GET', '/api/media/c61679b6-f189-400a-8b47-1c33c11b7db9', {
    token: studentToken
  })).status, 200);
  assert.equal((await request('GET', '/api/students', { token: studentToken })).status, 403);
  assert.equal((await request('PUT', '/api/model', {
    token: studentToken, body: { model: {} }
  })).status, 403);
  assert.equal((await request('POST', '/api/auth/login', {
    body: { username: 'student.one', password: 'incorrect-password' }
  })).status, 401);

  const secondStudent = await request('POST', '/api/students', {
    token: teacherToken,
    body: { name: 'Outro estudante', username: 'student.two', password: 'student-password-2' }
  });
  assert.equal(secondStudent.status, 201);
  const secondStudentId = secondStudent.result.student.id;
  const secondStudentLogin = await request('POST', '/api/auth/login', {
    body: { username: 'student.two', password: 'student-password-2' }
  });
  assert.equal(secondStudentLogin.status, 200);
  const secondStudentToken = secondStudentLogin.result.token;
  assert.equal((await request('POST', '/api/media', {
    token: teacherToken,
    body: { id: 'locked-lesson-media', name: 'material.txt', dataUrl: 'data:text/plain;base64,c2VjcmV0' }
  })).status, 201);
  assert.equal((await request('POST', '/api/media', {
    token: teacherToken,
    body: { id: 'published-question-prompt', name: 'enunciado.txt', dataUrl: 'data:text/plain;base64,cXVlc3Rpb24=' }
  })).status, 201);
  assert.equal((await request('POST', '/api/media', {
    token: teacherToken,
    body: { id: 'published-question-score', name: 'partitura.mxl', dataUrl: `data:${bundledMedia[0].type};base64,${bundledMedia[0].data}` }
  })).status, 201);

  const teacherModel = {
    profile: { displayName: 'Professora', username: 'music.teacher' },
    blocks: [{ id: 'block-1', title: 'Fundamentos', releaseMode: 'selected', releasedStudentIds: [] }],
    lessons: [
      { id: 'lesson-1', blockId: 'block-1', title: 'Aula publicada', published: true,
        releaseMode: 'selected', releasedStudentIds: [studentId], content: [{ type: 'text', text: 'Conteúdo liberado' }] },
      { id: 'lesson-status-only', blockId: 'block-1', title: 'Aula publicada por status',
        status: 'published', releaseMode: 'selected', releasedStudentIds: [studentId],
        content: [{ type: 'text', text: 'Conteúdo liberado pelo status' }] },
      { id: 'lesson-locked', blockId: 'block-1', title: 'Aula bloqueada', published: true,
        content: [{ type: 'text', text: 'Conteúdo protegido' }, { type: 'audio', mediaId: 'locked-lesson-media' }] },
      { id: 'lesson-draft', blockId: 'block-1', title: 'Rascunho', published: false }
    ],
    playlists: [
      { id: 'playlist-harmony', title: 'Harmonia', symbol: '♫', color: '#7658c8' },
      { id: 'playlist-empty', title: 'Sem atividades' }
    ],
    exerciseBlocks: [{
      id: 'exercise-block-1', title: 'Prática', playlistId: 'playlist-harmony',
      releaseMode: 'selected', releasedStudentIds: []
    }],
    exercises: [
      {
        id: 'practice-1', title: 'Prática', published: true,
        lessonIds: ['lesson-1'], exerciseBlockId: 'exercise-block-1',
        releaseMode: 'selected', releasedStudentIds: [studentId],
        questions: [{
          id: 'question-1', prompt: 'Quanto é 2 + 2?', type: 'written', points: 2,
          promptMediaId: 'published-question-prompt', promptScoreMediaId: 'published-question-score',
          promptScoreSource: 'upload', promptScoreMediaName: 'partitura.mxl', allowAudioResponse: true,
          requireAudioResponse: true
        }]
      },
      {
        id: 'practice-locked', title: 'Prática bloqueada', status: 'draft', published: true,
        exerciseBlockId: 'exercise-block-1',
        questions: [{ id: 'locked-question', prompt: 'Conteúdo oculto', type: 'written', points: 1 }]
      },
      {
        id: 'exam-1', title: 'Avaliação', published: true,
        releaseMode: 'selected', releasedStudentIds: [],
        assessment: { releaseAt: '2020-01-01T00:00:00.000Z', durationMinutes: 30 },
        questions: [{ id: 'exam-question-1', prompt: 'Resposta', type: 'written', points: 1 }]
      },
      {
        id: 'exam-no-lock', title: 'Avaliação sem bloqueio por inatividade', published: true,
        assessment: { durationMinutes: 30, lockOnExit: false },
        questions: [{ id: 'exam-no-lock-question', prompt: 'Resposta', type: 'written', points: 1 }]
      },
      { id: 'exercise-draft', title: 'Rascunho', published: false, questions: [] }
    ],
    trails: [],
    attempts: []
  };
  assert.equal((await request('PUT', '/api/model', {
    token: teacherToken, body: { model: teacherModel }
  })).status, 200);
  await app.initialize();
  const modelAfterRestart = (await request('GET', '/api/model', { token: teacherToken })).result.model;
  assert.equal(modelAfterRestart.exercises.some(item => item.id === bundledCatalog.exercises[0].id), false);
  const studentModel = (await request('GET', '/api/model', { token: studentToken })).result.model;
  assert.deepEqual(studentModel.lessons.map(item => item.id), ['lesson-1', 'lesson-status-only', 'lesson-locked']);
  assert.equal(studentModel.lessons.find(item => item.id === 'lesson-1').accessLocked, false);
  assert.equal(studentModel.lessons.find(item => item.id === 'lesson-status-only').accessLocked, false);
  assert.equal(studentModel.lessons.find(item => item.id === 'lesson-status-only').content[0].text,
    'Conteúdo liberado pelo status');
  assert.equal(studentModel.lessons.find(item => item.id === 'lesson-locked').accessLocked, true);
  assert.equal(studentModel.blocks.find(item => item.id === 'block-1').accessLocked, false);
  assert.deepEqual(studentModel.lessons.find(item => item.id === 'lesson-locked').content, []);
  assert.equal((await request('GET', '/api/media/locked-lesson-media', { token: studentToken })).status, 404);
  assert.equal('releasedStudentIds' in studentModel.lessons[0], false);
  assert.equal(studentModel.exercises.find(item => item.id === 'practice-1').accessLocked, false);
  assert.equal((await request('GET', '/api/media/published-question-prompt', {
    token: studentToken
  })).status, 200);
  assert.equal((await request('GET', '/api/media/published-question-score', {
    token: studentToken
  })).status, 200);
  assert.equal(studentModel.exercises.find(item => item.id === 'practice-1').questions[0].promptScoreMediaId,
    'published-question-score');
  assert.equal(studentModel.exercises.find(item => item.id === 'practice-locked').accessLocked, true);
  assert.equal(studentModel.exercises.find(item => item.id === 'practice-locked').status, 'draft');
  assert.equal(studentModel.exerciseBlocks.find(item => item.id === 'exercise-block-1').accessLocked, false);
  assert.deepEqual(studentModel.playlists.map(item => item.id), ['playlist-harmony']);
  assert.deepEqual(studentModel.exercises.find(item => item.id === 'practice-locked').questions, []);
  assert.equal(studentModel.exercises.find(item => item.id === 'practice-locked').questionCount, 1);
  assert.deepEqual(studentModel.exercises.find(item => item.id === 'practice-locked').questionTypes, ['written']);
  assert.equal(studentModel.exercises.find(item => item.id === 'exam-1').accessLocked, true);
  assert.equal('releasedStudentIds' in studentModel.exercises[0], false);
  const initialStudentNotifications = (await request('GET', '/api/notifications', { token: studentToken }))
    .result.notifications;
  assert.ok(initialStudentNotifications.some(item => item.type === 'new-lesson'
    && item.lessonId === 'lesson-1'));
  assert.equal(initialStudentNotifications.some(item => item.type === 'new-lesson'
    && item.lessonId === 'lesson-locked'), false);
  assert.ok(initialStudentNotifications.some(item => item.type === 'new-lesson'
    && item.lessonId === 'lesson-status-only'));
  assert.ok(initialStudentNotifications.some(item => item.type === 'new-exercise'
    && item.exerciseId === 'practice-1'));
  assert.equal(initialStudentNotifications.some(item => item.type === 'new-exercise'
    && item.exerciseId === 'practice-locked'), false);
  const secondStudentModel = (await request('GET', '/api/model', { token: secondStudentToken })).result.model;
  assert.equal(secondStudentModel.lessons.find(item => item.id === 'lesson-1').accessLocked, true);
  assert.equal(secondStudentModel.lessons.find(item => item.id === 'lesson-status-only').accessLocked, true);
  assert.equal(secondStudentModel.exercises.find(item => item.id === 'practice-1').accessLocked, true);
  assert.equal(secondStudentModel.exercises.find(item => item.id === 'exam-1').accessLocked, true);
  assert.equal((await request('GET', '/api/media/locked-lesson-media', { token: secondStudentToken })).status, 404);
  assert.equal((await request('POST', '/api/attempts', {
    token: secondStudentToken,
    body: { attempt: { exerciseId: 'practice-1', answers: [] } }
  })).status, 403);
  assert.equal((await request('GET', '/api/notifications', { token: secondStudentToken }))
    .result.notifications.some(item => item.type === 'new-lesson' || item.type === 'new-exercise'), false);
  assert.equal((await request('POST', '/api/practice/request', {
    token: studentToken, body: { lessonId: 'lesson-locked' }
  })).status, 403);
  assert.equal((await request('POST', '/api/attempts', {
    token: studentToken, body: { attempt: { exerciseId: 'practice-locked', answers: [] } }
  })).status, 403);
  assert.equal((await request('PUT', '/api/progress/exercise/practice-locked', {
    token: studentToken, body: { completed: true }
  })).status, 403);
  assert.equal((await request('PUT', '/api/progress/lesson/lesson-locked', {
    token: studentToken, body: { completed: true }
  })).status, 403);
  assert.equal((await request('GET', '/api/progress', { token: studentToken })).result.progress.length, 0);
  const lessonProgress = await request('PUT', '/api/progress/lesson/lesson-1', {
    token: studentToken, body: { completed: true }
  });
  assert.equal(lessonProgress.status, 200);
  assert.equal(lessonProgress.result.progress.contentType, 'lesson');
  assert.equal((await request('GET', '/api/progress', { token: studentToken }))
    .result.progress.some(item => item.contentId === 'lesson-1'), true);
  const lockedExam = await request('POST', '/api/exams/exam-1/open', {
    token: studentToken, body: {}
  });
  assert.equal(lockedExam.status, 200);
  assert.equal(lockedExam.result.notReleased, true);
  assert.equal('exercise' in lockedExam.result, false);
  teacherModel.exercises.find(item => item.id === 'exam-1').releasedStudentIds = [studentId];
  teacherModel.exercises.find(item => item.id === 'practice-locked').releaseMode = 'selected';
  teacherModel.exercises.find(item => item.id === 'practice-locked').releasedStudentIds = [studentId];
  teacherModel.lessons.find(item => item.id === 'lesson-locked').releaseMode = 'selected';
  teacherModel.lessons.find(item => item.id === 'lesson-locked').releasedStudentIds = [studentId];
  assert.equal((await request('PUT', '/api/model', {
    token: teacherToken, body: { model: teacherModel }
  })).status, 200);
  const savedReleases = JSON.parse(await fs.readFile(storeFile, 'utf8')).model.exercises;
  assert.deepEqual(savedReleases.find(item => item.id === 'exam-1').releasedStudentIds, [studentId]);
  const afterRelease = (await request('GET', '/api/model', { token: studentToken })).result.model;
  assert.equal(afterRelease.exercises.find(item => item.id === 'exam-1').accessLocked, false);
  assert.equal(afterRelease.exercises.find(item => item.id === 'practice-locked').accessLocked, false);
  const releasedLesson = afterRelease.lessons.find(item => item.id === 'lesson-locked');
  assert.equal(releasedLesson.accessLocked, false);
  assert.equal(releasedLesson.content[0].text, 'Conteúdo protegido');
  assert.equal((await request('PUT', '/api/progress/exercise/practice-locked', {
    token: studentToken, body: { completed: true }
  })).status, 200);
  assert.equal((await request('PUT', '/api/progress/exercise/practice-locked', {
    token: studentToken, body: { completed: false }
  })).result.completed, false);
  assert.equal((await request('GET', '/api/media/locked-lesson-media', { token: studentToken })).status, 200);
  const releasedActivityAttempt = await request('POST', '/api/attempts', {
    token: studentToken,
    body: {
      attempt: {
        exerciseId: 'practice-locked',
        answers: [{ questionId: 'locked-question', value: 'Minha resposta' }]
      }
    }
  });
  assert.equal(releasedActivityAttempt.status, 201);
  assert.ok((await request('GET', '/api/notifications', { token: studentToken })).result.notifications
    .some(item => item.type === 'content-released' && item.examId === 'exam-1'));
  const secondStudentAfterRelease = (await request('GET', '/api/model', { token: secondStudentToken })).result.model;
  assert.equal(secondStudentAfterRelease.exercises.find(item => item.id === 'exam-1').accessLocked, true);
  assert.equal(secondStudentAfterRelease.exercises.find(item => item.id === 'practice-locked').accessLocked, true);
  assert.equal(secondStudentAfterRelease.lessons.find(item => item.id === 'lesson-locked').accessLocked, true);
  assert.equal((await request('GET', '/api/media/published-question-prompt', {
    token: secondStudentToken
  })).status, 404);
  assert.equal((await request('GET', '/api/media/locked-lesson-media', { token: secondStudentToken })).status, 404);
  assert.equal((await request('GET', '/api/notifications', { token: secondStudentToken }))
    .result.notifications.some(item => item.type === 'content-released'), false);
  assert.equal(studentModel.exercises.some(item => item.id === 'exercise-draft'), false);

  const practice = await request('POST', '/api/practice/request', {
    token: studentToken, body: { lessonId: 'lesson-1' }
  });
  assert.equal(practice.status, 200);
  assert.equal(practice.result.exercise.questions.length, 1);
  assert.equal((await request('POST', '/api/practice/request', {
    token: studentToken, body: { lessonId: 'lesson-draft' }
  })).status, 404);

  const uploaded = await request('POST', '/api/media', {
    token: studentToken,
    body: { id: 'attachment-1', name: 'resposta.txt', dataUrl: 'data:text/plain;base64,SGVsbG8=' }
  });
  assert.equal(uploaded.status, 201);
  const uploadedAudio = await request('POST', '/api/media', {
    token: studentToken,
    body: {
      id: 'response-audio-1',
      name: 'resposta.webm',
      dataUrl: 'data:audio/webm;base64,SGVsbG8='
    }
  });
  assert.equal(uploadedAudio.status, 201);
  const uploadedScore = await request('POST', '/api/media', {
    token: studentToken,
    body: {
      id: 'uploaded-score',
      name: bundledMedia[0].name,
      dataUrl: `data:${bundledMedia[0].type};base64,${bundledMedia[0].data}`
    }
  });
  assert.equal(uploadedScore.status, 201);
  const teacherAttachment = await request('POST', '/api/media', {
    token: teacherToken,
    body: { id: 'teacher-return-1', name: 'correcao.txt', dataUrl: 'data:text/plain;base64,Q29ycmV0Y28=' }
  });
  assert.equal(teacherAttachment.status, 201);
  const media = await request('GET', '/api/media/attachment-1', { token: studentToken });
  assert.equal(media.status, 200);
  assert.equal(media.result.toString(), 'Hello');

  assert.equal((await request('POST', '/api/attempts', {
    token: studentToken,
    body: {
      attempt: {
        exerciseId: 'practice-1',
        answers: [{ questionId: 'question-1', value: '4' }]
      }
    }
  })).status, 400);
  const attempt = await request('POST', '/api/attempts', {
    token: studentToken,
    body: {
      attempt: {
        exerciseId: 'practice-1',
        score: 999,
        teacherRating: 5,
        gradedAt: new Date().toISOString(),
        answers: [{
          questionId: 'question-1', prompt: 'Enunciado manipulado', value: '4', points: 999,
          audioAttachment: { id: 'response-audio-1', name: 'spoofed.webm', type: 'text/plain', size: 1 }
        }]
      }
    }
  });
  assert.equal(attempt.status, 201);
  assert.equal(attempt.result.attempt.studentId, studentId);
  assert.equal(attempt.result.attempt.score, 0);
  assert.equal(attempt.result.attempt.maxScore, 2);
  assert.equal(attempt.result.attempt.answers[0].manual, true);
  assert.equal(attempt.result.attempt.answers[0].prompt, 'Quanto é 2 + 2?');
  assert.deepEqual(attempt.result.attempt.answers[0].audioAttachment, {
    id: 'response-audio-1', name: 'resposta.webm', type: 'audio/webm', size: 5
  });
  assert.equal('teacherRating' in attempt.result.attempt, false);
  assert.equal('gradedAt' in attempt.result.attempt, false);
  const grade = await request('POST', `/api/attempts/${attempt.result.attempt.id}/grade`, {
    token: teacherToken,
    body: { grades: { 'question-1': 1.5 } }
  });
  assert.equal(grade.status, 200);
  assert.equal(grade.result.attempt.score, 1.5);
  assert.equal(grade.result.attempt.answers[0].manualScore, 1.5);
  assert.ok(grade.result.attempt.gradedAt);
  const review = await request('POST', `/api/attempts/${attempt.result.attempt.id}/review`, {
    token: teacherToken,
    body: {
      teacherRating: 5,
      teacherNote: 'Muito bem.',
      attachments: [{ id: 'teacher-return-1', name: 'correcao.txt', type: 'text/plain', size: 7 }]
    }
  });
  assert.equal(review.status, 200);
  assert.equal(review.result.attempt.teacherRating, 5);
  assert.equal(review.result.attempt.teacherAttachments[0].id, 'teacher-return-1');
  const studentNotifications = await request('GET', '/api/notifications', { token: studentToken });
  assert.ok(studentNotifications.result.notifications.some(item => item.type === 'response-reviewed'));
  const teacherNotifications = await request('GET', '/api/notifications', { token: teacherToken });
  const submitted = teacherNotifications.result.notifications.find(item => item.type === 'response-submitted');
  assert.ok(submitted);
  assert.equal((await request('POST', `/api/notifications/${submitted.id}/read`, {
    token: teacherToken, body: {}
  })).result.notification.readAt !== null, true);

  assert.equal((await request('PUT', '/api/account/profile', {
    token: studentToken, body: { name: 'Estudante Atualizada', username: 'student.updated' }
  })).result.user.name, 'Estudante Atualizada');
  assert.equal((await request('POST', '/api/presence', {
    token: studentToken, body: {}
  })).status, 200);

  const opened = await request('POST', '/api/exams/exam-1/open', {
    token: studentToken, body: {}
  });
  assert.equal(opened.status, 200);
  assert.equal(opened.result.locked, false);
  assert.equal((await request('POST', '/api/exams/exam-no-lock/open', {
    token: studentToken, body: {}
  })).status, 200);
  assert.equal((await request('POST', '/api/exams/exam-no-lock/start', {
    token: studentToken, body: {}
  })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await request('POST', '/api/exams/exam-no-lock/heartbeat', {
    token: studentToken, body: {}
  })).status, 200);
  assert.equal((await request('POST', '/api/exams/exam-1/start', {
    token: studentToken, body: {}
  })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 10));
  const heartbeat = await request('POST', '/api/exams/exam-1/heartbeat', {
    token: studentToken, body: {}
  });
  assert.equal(heartbeat.status, 423);
  assert.equal((await request('POST', '/api/exams/exam-1/request-reopen', {
    token: studentToken, body: { reason: 'Minha conexão caiu.' }
  })).status, 200);
  const reopenNotice = (await request('GET', '/api/notifications', { token: teacherToken }))
    .result.notifications.find(item => item.type === 'exam-reopen-request');
  assert.ok(reopenNotice);
  assert.equal((await request('POST', '/api/exams/unlock', {
    token: teacherToken, body: { examId: 'exam-1', studentId }
  })).status, 200);
  assert.ok((await request('GET', '/api/notifications', { token: studentToken }))
    .result.notifications.some(item => item.type === 'exam-reopened'));

  const updatedStudent = await request('PUT', `/api/students/${studentId}`, {
    token: teacherToken,
    body: { name: 'Estudante Editado', username: 'student.edited', password: 'student-password-2' }
  });
  assert.equal(updatedStudent.status, 200);
  assert.equal(updatedStudent.result.student.username, 'student.edited');
  assert.equal(updatedStudent.result.passwordChanged, true);
  assert.equal((await request('POST', '/api/auth/login', {
    body: { username: 'student.one', password: 'student-password-1' }
  })).status, 401);
  const reloggedStudent = await request('POST', '/api/auth/login', {
    body: { username: 'student.edited', password: 'student-password-2' }
  });
  assert.equal(reloggedStudent.status, 200);
  studentToken = reloggedStudent.result.token;

  assert.equal((await request('POST', '/api/auth/logout', {
    token: studentToken, body: {}
  })).status, 200);
  assert.equal((await request('GET', '/api/model', { token: studentToken })).status, 401);
  assert.equal((await request('GET', '/api/auth/session', { token: studentToken })).status, 401);
  assert.equal((await request('DELETE', `/api/students/${studentId}`, {
    token: teacherToken
  })).status, 200);
  assert.equal((await request('GET', '/api/media/attachment-1', {
    token: teacherToken
  })).status, 404);
  const persisted = JSON.parse(await fs.readFile(path.join(dataDir, 'store.json'), 'utf8'));
  assert.equal(persisted.users.length, 2);
  assert.equal(persisted.users[0].passwordHash.length, 128);
  assert.equal('password' in persisted.users[0], false);
  assert.ok(persisted.sessions.every(item => item.tokenHash.length === 64));
});
