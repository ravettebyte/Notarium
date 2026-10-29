(() => {
  const storageKey = 'harmonette-lessons-v1';
  const lessonDialog = document.querySelector('#lesson-dialog');
  const detailDialog = document.querySelector('#lesson-detail-dialog');
  const lessonForm = document.querySelector('#lesson-form');
  const lessonsGrid = document.querySelector('#lesson-cards');
  const harmonyGrid = document.querySelector('#harmony-lesson-cards');
  const materialEditor = document.querySelector('#materials-editor');
  const questionEditor = document.querySelector('#questions-editor');
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  let lessons = loadLessons();
  let toastTimer;

  function loadLessons() {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); }
    catch { return []; }
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function saveLessons() {
    localStorage.setItem(storageKey, JSON.stringify(lessons));
    renderLessons();
  }

  function showToast(message) {
    const toast = document.querySelector('#toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  function navigate(viewName) {
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `view-${viewName}`));
    document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === viewName));
    const activeNav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    document.querySelector('#breadcrumb-current').textContent = activeNav?.textContent.trim() || 'Visão geral';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cardMarkup(lesson) {
    const harmony = lesson.topic === 'Harmonia';
    const materials = lesson.materials?.length || 0;
    const questions = lesson.questions?.length || 0;
    const count = materials + questions;
    return `<article class="lesson-card" data-created-lesson="${escapeHtml(lesson.id)}"><div class="lesson-cover ${harmony ? 'cover-teal' : 'cover-blue'}"><span>${escapeHtml(lesson.topic.toUpperCase())}</span><b>♫</b><i>♪</i></div><div class="lesson-card-body"><span class="tag published">Salva neste navegador</span><h3>${escapeHtml(lesson.title)}</h3><p>${escapeHtml(lesson.description || 'Conteúdo e prática musical.')}</p><div class="card-meta"><span>▤ ${count} ${count === 1 ? 'item' : 'itens'}</span><span>${materials} materiais · ${questions} perguntas</span></div><button class="outline-button lesson-open-created" data-id="${escapeHtml(lesson.id)}">Abrir aula →</button></div></article>`;
  }

  function renderLessons() {
    lessonsGrid.querySelectorAll('[data-created-lesson]').forEach(card => card.remove());
    lessonsGrid.insertAdjacentHTML('beforeend', lessons.map(cardMarkup).join(''));
    const harmonyLessons = lessons.filter(lesson => lesson.topic === 'Harmonia');
    harmonyGrid.innerHTML = harmonyLessons.map(cardMarkup).join('');
    document.querySelector('#harmony-count').textContent = `${harmonyLessons.length} ${harmonyLessons.length === 1 ? 'aula' : 'aulas'}`;
    document.querySelector('#harmony-empty').hidden = harmonyLessons.length > 0;
    document.querySelector('#lesson-count').textContent = `${3 + lessons.length} aulas`;
    filterLessons();
  }

  function filterLessons() {
    const query = document.querySelector('#lesson-search')?.value.trim().toLocaleLowerCase('pt-BR') || '';
    lessonsGrid.querySelectorAll('.lesson-card').forEach(card => {
      card.hidden = !card.textContent.toLocaleLowerCase('pt-BR').includes(query);
    });
  }

  function openLessonBuilder() {
    lessonForm.reset();
    materialEditor.innerHTML = '';
    questionEditor.innerHTML = '';
    document.querySelector('#lesson-topic').value = 'Harmonia';
    addMaterialRow();
    lessonDialog.showModal();
  }

  function addMaterialRow() {
    const row = document.createElement('div');
    row.className = 'editor-row material-editor';
    row.innerHTML = `<div><label>Tipo</label><select class="material-type-select"><option>PDF</option><option>Link</option></select></div><div><label>Nome</label><input class="material-name" maxlength="70" placeholder="Ex.: Apostila de acordes"></div><div><label>Endereço do material</label><input class="material-url" type="url" placeholder="https://..."></div><button type="button" class="remove-row" aria-label="Remover material">×</button>`;
    row.querySelector('.remove-row').addEventListener('click', () => row.remove());
    materialEditor.append(row);
  }

  function noteOptions(region) {
    const startOctave = Number(region.slice(1));
    return Array.from({ length: 24 }, (_, offset) => {
      const pitch = offset % 12;
      const octave = startOctave + Math.floor(offset / 12);
      return `${noteNames[pitch]}${octave}`;
    });
  }

  function addQuestion() {
    const row = document.createElement('div');
    row.className = 'editor-row question-editor';
    row.innerHTML = `<div class="question-top"><div><label>Enunciado</label><input class="question-prompt" maxlength="180" placeholder="Escreva sua pergunta" required></div><div><label>Tipo de resposta</label><select class="question-type"><option value="written">Resposta escrita</option><option value="choice">Múltipla escolha</option><option value="degree">Graus · piano</option></select></div><button type="button" class="remove-row" aria-label="Remover pergunta">×</button></div><div class="question-extra"></div>`;
    const typeSelect = row.querySelector('.question-type');
    typeSelect.addEventListener('change', () => renderQuestionFields(row));
    row.querySelector('.remove-row').addEventListener('click', () => row.remove());
    questionEditor.append(row);
    renderQuestionFields(row);
  }

  function renderQuestionFields(row) {
    const type = row.querySelector('.question-type').value;
    const extra = row.querySelector('.question-extra');
    if (type === 'choice') {
      extra.innerHTML = `<div class="wide-field"><label>Alternativas</label><div class="option-inputs">${[1, 2, 3, 4].map(number => `<input class="choice-option" maxlength="80" placeholder="Alternativa ${number}" ${number < 3 ? 'required' : ''}>`).join('')}</div></div><div><label>Alternativa correta</label><select class="correct-option"><option value="0">Alternativa 1</option><option value="1">Alternativa 2</option><option value="2">Alternativa 3</option><option value="3">Alternativa 4</option></select></div>`;
    } else if (type === 'degree') {
      extra.innerHTML = `<div><label>Região do piano (duas oitavas)</label><select class="piano-region">${['C2', 'C3', 'C4', 'C5'].map(region => `<option>${region}</option>`).join('')}</select></div><div><label>Nota que será tocada</label><select class="target-note"></select></div><label class="switch-line"><input class="play-on-open" type="checkbox" checked> Tocar a nota ao abrir a pergunta</label>`;
      const region = row.querySelector('.piano-region');
      const target = row.querySelector('.target-note');
      const updateNotes = () => { target.innerHTML = noteOptions(region.value).map(note => `<option>${note}</option>`).join(''); };
      region.addEventListener('change', updateNotes);
      updateNotes();
    } else {
      extra.innerHTML = `<div class="wide-field"><label>Resposta esperada (opcional, para correção automática)</label><input class="written-answer" maxlength="160" placeholder="Deixe em branco para revisar manualmente"></div>`;
    }
  }

  function collectMaterials() {
    return [...materialEditor.querySelectorAll('.material-editor')].map(row => ({
      type: row.querySelector('.material-type-select').value,
      name: row.querySelector('.material-name').value.trim(),
      url: row.querySelector('.material-url').value.trim()
    })).filter(item => item.url);
  }

  function collectQuestions() {
    return [...questionEditor.querySelectorAll('.question-editor')].map(row => {
      const type = row.querySelector('.question-type').value;
      const question = { prompt: row.querySelector('.question-prompt').value.trim(), type };
      if (type === 'choice') {
        question.options = [...row.querySelectorAll('.choice-option')].map(input => input.value.trim()).filter(Boolean);
        question.answer = Number(row.querySelector('.correct-option').value);
      } else if (type === 'degree') {
        question.region = row.querySelector('.piano-region').value;
        question.answer = row.querySelector('.target-note').value;
        question.playOnOpen = row.querySelector('.play-on-open').checked;
      } else {
        question.answer = row.querySelector('.written-answer').value.trim();
      }
      return question;
    }).filter(question => question.prompt);
  }

  function noteToMidi(note) {
    const match = note.match(/^([A-G]#?)(\d)$/);
    if (!match) return -1;
    return (Number(match[2]) + 1) * 12 + noteNames.indexOf(match[1]);
  }

  function playNote(note, duration = .7) {
    const midi = noteToMidi(note);
    if (midi < 0) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) { showToast('Este navegador não oferece reprodução de áudio.'); return; }
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * (2 ** ((midi - 69) / 12));
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.18, context.currentTime + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + .03);
    oscillator.onended = () => context.close();
  }

  function keyboardMarkup(region) {
    const startOctave = Number(region.slice(1));
    let markup = '';
    for (let offset = 0; offset < 24; offset += 1) {
      const pitch = offset % 12;
      const octave = startOctave + Math.floor(offset / 12);
      const note = `${noteNames[pitch]}${octave}`;
      if ([1, 3, 6, 8, 10].includes(pitch)) {
        const whiteIndex = Math.floor(offset / 12) * 7 + [1, 3, 6, 8, 10].indexOf(pitch) + [1, 2, 4, 5, 6][[1, 3, 6, 8, 10].indexOf(pitch)];
        const left = (whiteIndex / 14) * 100 - 2.05;
        markup += `<button type="button" class="piano-key black" style="left:${left}%" data-note="${note}" aria-label="${note}"></button>`;
      } else {
        markup += `<button type="button" class="piano-key white" data-note="${note}" aria-label="${note}"><span>${note}</span></button>`;
      }
    }
    return markup;
  }

  function openLesson(lesson) {
    const content = document.querySelector('#lesson-detail-content');
    const materials = lesson.materials?.length ? `<div class="detail-section"><h3>Materiais</h3>${lesson.materials.map(item => `<a class="resource-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><span>${item.type === 'PDF' ? 'PDF' : '↗'}</span>${escapeHtml(item.name || item.type)} <span>↗</span></a>`).join('')}</div>` : '';
    const questions = lesson.questions?.length ? `<div class="detail-section"><h3>Quiz da aula · ${lesson.questions.length} ${lesson.questions.length === 1 ? 'pergunta' : 'perguntas'}</h3><div class="quiz-area">${lesson.questions.map((question, index) => quizQuestionMarkup(question, index)).join('')}</div><button class="primary-button submit-quiz" type="button">Conferir respostas</button><div class="quiz-result" hidden></div></div>` : '';
    content.innerHTML = `<button type="button" class="modal-close detail-close" aria-label="Fechar">×</button><p class="eyebrow">${escapeHtml(lesson.topic.toUpperCase())}</p><h2>${escapeHtml(lesson.title)}</h2><p class="detail-description">${escapeHtml(lesson.description || 'Aula de prática musical.')}</p>${materials}${questions || '<p class="modal-note">Esta aula ainda não tem quiz.</p>'}`;
    content.querySelector('.detail-close').addEventListener('click', () => detailDialog.close());
    content.querySelectorAll('.piano').forEach(piano => {
      piano.addEventListener('click', event => {
        const key = event.target.closest('.piano-key');
        if (!key) return;
        piano.querySelectorAll('.piano-key').forEach(item => item.classList.remove('selected'));
        key.classList.add('selected');
        piano.closest('.quiz-question').dataset.response = key.dataset.note;
        piano.closest('.quiz-question').querySelector('.piano-response').textContent = `Sua resposta: ${key.dataset.note}`;
        playNote(key.dataset.note);
      });
    });
    content.querySelectorAll('.play-target').forEach(button => button.addEventListener('click', () => playNote(button.dataset.note)));
    content.querySelectorAll('.auto-play-target').forEach(button => playNote(button.dataset.note));
    content.querySelector('.submit-quiz')?.addEventListener('click', () => checkQuiz(content, lesson.questions));
    detailDialog.showModal();
  }

  function quizQuestionMarkup(question, index) {
    let response = '';
    if (question.type === 'choice') {
      response = (question.options || []).map((option, optionIndex) => `<label class="answer-option"><input type="radio" name="answer-${index}" value="${optionIndex}"> ${escapeHtml(option)}</label>`).join('');
    } else if (question.type === 'degree') {
      const region = question.region || 'C3';
      response = `<div class="piano-tools"><button type="button" class="play-target ${question.playOnOpen ? 'auto-play-target' : ''}" data-note="${escapeHtml(question.answer)}">▶ Ouvir nota indicada</button><span>Região: ${escapeHtml(region)} · duas oitavas</span></div><div class="piano" aria-label="Piano de duas oitavas">${keyboardMarkup(region)}</div><p class="piano-response muted">Escolha uma tecla para responder.</p>`;
    } else {
      response = question.answer ? `<input type="text" class="written-response" placeholder="Digite sua resposta">` : `<textarea class="written-response" rows="2" placeholder="Escreva sua resposta"></textarea>`;
    }
    return `<div class="quiz-question" data-index="${index}" data-type="${question.type}" data-answer="${escapeHtml(Array.isArray(question.answer) ? '' : question.answer ?? '')}"><strong>${index + 1}. ${escapeHtml(question.prompt)}</strong>${response}</div>`;
  }

  function checkQuiz(content, questions) {
    let correct = 0;
    let autoCount = 0;
    content.querySelectorAll('.quiz-question').forEach((item, index) => {
      const question = questions[index];
      if (question.type === 'written' && !question.answer) return;
      autoCount += 1;
      let isCorrect = false;
      if (question.type === 'choice') {
        const selected = item.querySelector('input[type="radio"]:checked');
        isCorrect = Boolean(selected && Number(selected.value) === question.answer);
      } else if (question.type === 'degree') {
        isCorrect = noteToMidi(item.dataset.response || '') === noteToMidi(question.answer);
      } else {
        const response = item.querySelector('.written-response').value.trim().toLocaleLowerCase('pt-BR');
        isCorrect = response === question.answer.trim().toLocaleLowerCase('pt-BR');
      }
      if (isCorrect) correct += 1;
    });
    const result = content.querySelector('.quiz-result');
    const manualCount = questions.filter(question => question.type === 'written' && !question.answer).length;
    result.hidden = false;
    result.textContent = `${correct} de ${autoCount} respostas automáticas corretas.${manualCount ? ` ${manualCount} resposta(s) aberta(s) para revisão.` : ''}`;
  }

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
  document.querySelector('#new-lesson').addEventListener('click', openLessonBuilder);
  document.querySelector('#new-harmony-lesson').addEventListener('click', openLessonBuilder);
  document.querySelector('#empty-create-lesson').addEventListener('click', openLessonBuilder);
  document.querySelector('#close-modal').addEventListener('click', () => lessonDialog.close());
  document.querySelector('#add-material-row').addEventListener('click', addMaterialRow);
  document.querySelector('#add-question').addEventListener('click', addQuestion);
  document.querySelector('#lesson-search').addEventListener('input', filterLessons);
  lessonForm.addEventListener('submit', event => {
    event.preventDefault();
    const lesson = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: document.querySelector('#lesson-title').value.trim(),
      description: document.querySelector('#lesson-description').value.trim(),
      topic: document.querySelector('#lesson-topic').value,
      materials: collectMaterials(),
      questions: collectQuestions(),
      createdAt: new Date().toISOString()
    };
    lessons.unshift(lesson);
    saveLessons();
    lessonDialog.close();
    navigate(lesson.topic === 'Harmonia' ? 'harmonia' : 'aulas');
    showToast('Aula salva neste navegador.');
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('.lesson-open-created');
    if (button) {
      const lesson = lessons.find(item => item.id === button.dataset.id);
      if (lesson) openLesson(lesson);
    }
  });
  document.querySelectorAll('.lesson-open').forEach(button => button.addEventListener('click', () => showToast(`Aula de demonstração: ${button.dataset.title}`)));
  document.querySelector('#student-search').addEventListener('input', event => {
    const query = event.target.value.trim().toLocaleLowerCase('pt-BR');
    document.querySelectorAll('.student-row').forEach(row => { row.hidden = !row.dataset.name.includes(query); });
  });
  document.querySelectorAll('#add-student, #new-activity, #add-material').forEach(button => button.addEventListener('click', () => showToast('Esta ação ficará disponível na próxima etapa da prévia.')));
  renderLessons();
})();
