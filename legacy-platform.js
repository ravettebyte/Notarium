(() => {
  const authScreen = document.querySelector('#auth-screen');
  const appShell = document.querySelector('#app-shell');
  const authPanel = document.querySelector('#auth-panel');
  const tokenKey = 'harmonette-session-v2';
  const sessionEpochKey = 'harmonette-session-epoch';
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  let token = localStorage.getItem(tokenKey) || '';
  let user = null;
  let blocks = [];
  let students = [];
  let groupMembers = [];
  let invites = [];
  let submissions = [];
  let activeBlock = null;
  let currentView = 'inicio';
  let toastTimer;
  let serverSessionEpoch = '';
  let avatarImage = null;
  let avatarOffset = { x: 0, y: 0 };
  let avatarDrag = null;
  let presenceTimer = null;
  let groupChart = null;
  let completedLessonIds = new Set();
  let studyTab = 'aulas';
  let assistantMessages = [{ role: 'assistant', text: 'Olá! Sou Melo, seu companheiro musical. Posso dar pistas e explicar conceitos para você chegar às respostas por conta própria.' }];
  const themeKey = 'harmonette-theme-v1';

  function applyTheme(theme) {
    const activeTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = activeTheme;
    const toggle = document.querySelector('#theme-toggle');
    if (toggle) {
      toggle.textContent = activeTheme === 'dark' ? '☀ Tema claro' : '☾ Tema escuro';
      toggle.setAttribute('aria-label', activeTheme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
    }
  }

  applyTheme(localStorage.getItem(themeKey));

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  async function api(url, options = {}) {
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
    const response = await fetch(url, { ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a solicitação.');
    return result;
  }

  function showAuthMessage(message, type = 'error') {
    const element = authPanel.querySelector(type === 'error' ? '.auth-error' : '.auth-success');
    if (!element) return;
    element.textContent = message;
    element.classList.add('visible');
  }

  function bindAuthSwitches() {
    authPanel.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => renderLogin(button.dataset.authMode)));
  }

  function renderBootstrap() {
    renderLogin('teacher');
  }

  function renderLogin(role = 'teacher') {
    authPanel.innerHTML = `<p class="eyebrow">BEM-VINDO DE VOLTA</p><h2>Entre no seu espaço</h2><p>O professor usa a conta administrativa. Alunos entram com o acesso criado pelo professor.</p><div class="auth-error"></div><form class="auth-form" id="login-form"><div class="field"><label for="login-role">Perfil</label><select id="login-role" name="role"><option value="teacher" ${role === 'teacher' ? 'selected' : ''}>Professor</option><option value="student" ${role === 'student' ? 'selected' : ''}>Aluno</option></select></div><div class="field"><label for="login-username">Nome de usuário</label><input id="login-username" name="username" autocomplete="username" required placeholder="@seuusuario"></div><div class="field"><label for="login-password">Senha</label><input id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="Sua senha"></div><button class="button primary full" type="submit">Entrar</button></form><div class="auth-switch">Acesso de aluno criado pelo professor.</div>`;
    bindAuthSwitches();
    const invitedUsername = new URLSearchParams(location.search).get('username');
    if (invitedUsername) authPanel.querySelector('#login-username').value = invitedUsername;
    authPanel.querySelector('#login-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const requestedRole = form.get('role');
      try {
        const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
        if (result.user.role !== requestedRole) throw new Error(`Esta conta é de ${result.user.role === 'teacher' ? 'professor' : 'aluno'}. Selecione o perfil correto.`);
        startSession(result);
      } catch (error) { showAuthMessage(error.message); }
    });
  }

  async function renderJoin(inviteToken) {
    authPanel.innerHTML = `<p class="eyebrow">CONVITE PARA ESTUDAR</p><h2>Entre no seu espaço</h2><p>Use o usuário e a senha que o professor criou para você.</p><div class="auth-error"></div><form class="auth-form" id="join-form"><div class="field"><label for="join-username">Nome de usuário</label><input id="join-username" name="username" autocomplete="username" required maxlength="30" placeholder="@seuusuario"></div><div class="field"><label for="join-password">Senha</label><input id="join-password" name="password" type="password" autocomplete="current-password" required></div><button class="button primary full" type="submit">Entrar como aluno</button></form><button class="auth-link" type="button" data-auth-mode="login">Voltar ao login</button>`;
    bindAuthSwitches();
    try {
      const { invite } = await api(`/api/invites/${encodeURIComponent(inviteToken)}`);
      authPanel.querySelector('p:not(.eyebrow)').textContent = invite.blockTitle ? `O professor convidou você para o bloco “${invite.blockTitle}”.` : 'O professor convidou você para acessar seus blocos.';
      authPanel.querySelector('#join-form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        try {
          const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
          history.replaceState({}, '', '/');
          startSession(result);
        } catch (error) { showAuthMessage(error.message); }
      });
    } catch (error) {
      authPanel.querySelector('#join-form').hidden = true;
      showAuthMessage(error.message);
    }
  }

  function startSession(result) {
    token = result.token;
    user = result.user;
    localStorage.setItem(tokenKey, token);
    if (serverSessionEpoch) localStorage.setItem(sessionEpochKey, serverSessionEpoch);
    authScreen.hidden = true;
    mountApp();
    startPresenceHeartbeat();
    loadDashboard();
  }

  function startPresenceHeartbeat() {
    clearInterval(presenceTimer);
    const heartbeat = async () => {
      if (document.visibilityState !== 'visible') return;
      await api('/api/presence', { method: 'POST' }).catch(() => {});
      if (currentView === 'grupo') {
        try {
          groupMembers = (await api('/api/group')).members;
          renderView();
        } catch { showToast('Não foi possível atualizar o grupo.'); }
      }
    };
    heartbeat();
    presenceTimer = setInterval(heartbeat, 30_000);
  }

  function signOut() {
    api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem(tokenKey);
    token = '';
    user = null;
    clearInterval(presenceTimer);
    appShell.hidden = true;
    document.querySelector('#assistant-launch')?.setAttribute('hidden', '');
    document.querySelector('#back-to-top')?.setAttribute('hidden', '');
    authScreen.hidden = false;
    localStorage.removeItem(sessionEpochKey);
    renderLogin();
  }

  function openProfileDialog() {
    avatarImage = null;
    avatarOffset = { x: 0, y: 0 };
    document.querySelector('#profile-display-name').value = user.name || '';
    document.querySelector('#profile-username').value = user.username || '';
    document.querySelector('#avatar-file').value = '';
    document.querySelector('#avatar-zoom').value = '1';
    drawAvatarCrop();
    document.querySelector('#profile-dialog').showModal();
    if (user.avatarDataUrl) {
      avatarImage = new Image();
      avatarImage.onload = drawAvatarCrop;
      avatarImage.src = user.avatarDataUrl;
    }
  }

  function loadAvatarImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8_000_000) {
      showToast('Escolha uma imagem JPG, PNG ou WebP de até 8 MB.');
      event.target.value = '';
      return;
    }
    const image = new Image();
    image.onload = () => {
      avatarImage = image;
      avatarOffset = { x: 0, y: 0 };
      document.querySelector('#avatar-zoom').value = '1';
      drawAvatarCrop();
      URL.revokeObjectURL(image.src);
    };
    image.src = URL.createObjectURL(file);
  }

  function drawAvatarCrop() {
    const canvas = document.querySelector('#avatar-canvas');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#eaf3ff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!avatarImage?.naturalWidth) {
      context.fillStyle = '#5e7d9e';
      context.font = '15px Trebuchet MS';
      context.textAlign = 'center';
      context.fillText('Escolha uma foto', canvas.width / 2, canvas.height / 2);
      return;
    }
    const zoom = Number(document.querySelector('#avatar-zoom').value || 1);
    const scale = Math.max(canvas.width / avatarImage.naturalWidth, canvas.height / avatarImage.naturalHeight) * zoom;
    const width = avatarImage.naturalWidth * scale;
    const height = avatarImage.naturalHeight * scale;
    const x = Math.min(0, Math.max(canvas.width - width, (canvas.width - width) / 2 + avatarOffset.x));
    const y = Math.min(0, Math.max(canvas.height - height, (canvas.height - height) / 2 + avatarOffset.y));
    context.save();
    context.beginPath();
    context.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
    context.clip();
    context.drawImage(avatarImage, x, y, width, height);
    context.restore();
    canvas.dataset.cropX = String(x);
    canvas.dataset.cropY = String(y);
    canvas.dataset.cropWidth = String(width);
    canvas.dataset.cropHeight = String(height);
  }

  function beginAvatarDrag(event) {
    if (!avatarImage) return;
    const canvas = event.currentTarget;
    canvas.setPointerCapture(event.pointerId);
    avatarDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function moveAvatarDrag(event) {
    if (!avatarDrag || event.pointerId !== avatarDrag.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    avatarOffset.x += (event.clientX - avatarDrag.x) * (event.currentTarget.width / rect.width);
    avatarOffset.y += (event.clientY - avatarDrag.y) * (event.currentTarget.height / rect.height);
    avatarDrag.x = event.clientX;
    avatarDrag.y = event.clientY;
    drawAvatarCrop();
  }

  function endAvatarDrag() {
    avatarDrag = null;
  }

  function refreshProfileDisplay() {
    const control = document.querySelector('#profile-open');
    const avatar = control?.querySelector('.profile-avatar');
    if (control) {
      control.querySelector('strong').textContent = user.name || user.username;
      control.querySelector('small').textContent = user.username || '';
      control.setAttribute('aria-label', `Perfil de ${user.name || user.username}`);
    }
    if (avatar) avatar.innerHTML = user.avatarDataUrl ? `<img src="${user.avatarDataUrl}" alt="">` : escapeHtml((user.name || user.username || 'H').slice(0, 1).toUpperCase());
    if (currentView === 'inicio') renderView();
  }

  async function updateProfile(changes, message) {
    try {
      const result = await api('/api/profile', { method: 'PUT', body: JSON.stringify(changes) });
      user = result.user;
      refreshProfileDisplay();
      document.querySelector('#profile-dialog').close();
      showToast(message);
    } catch (error) { showToast(error.message); }
  }

  function persistAvatar(avatarDataUrl) {
    updateProfile({ avatarDataUrl }, avatarDataUrl ? 'Foto de perfil salva.' : 'Foto de perfil removida.');
  }

  function saveDisplayName() {
    const name = document.querySelector('#profile-display-name').value.trim();
    if (!name) { showToast('Informe um nome para exibição.'); return; }
    updateProfile({ name }, 'Nome de exibição atualizado.');
  }

  function saveAvatar() {
    if (!avatarImage) { showToast('Escolha uma imagem antes de salvar.'); return; }
    drawAvatarCrop();
    const canvas = document.querySelector('#avatar-canvas');
    persistAvatar(canvas.toDataURL('image/jpeg', .82));
  }

  function mountApp() {
    const isTeacher = user.role === 'teacher';
    const avatar = user.avatarDataUrl ? `<img src="${user.avatarDataUrl}" alt="">` : escapeHtml((user.name || user.username || 'H').slice(0, 1).toUpperCase());
    appShell.innerHTML = `<header class="sidebar app-header"><a class="brand" href="#" aria-label="Harmonette início"><span class="brand-mark">♫</span><span class="brand-copy"><strong>Harmonette</strong><small>Ensino musical, no seu ritmo</small></span></a><nav class="nav"><button class="nav-item active" data-view="inicio"><span>⌂</span> Visão geral</button><button class="nav-item" data-view="blocos"><span>▤</span> ${isTeacher ? 'Meus blocos' : 'Minha trilha'}</button><button class="nav-item" data-view="grupo"><span>♙</span> Grupo</button>${isTeacher ? '<button class="nav-item" data-view="atividades"><span>✓</span> Respostas</button>' : ''}</nav><span class="role-chip">${isTeacher ? 'Professor' : 'Aluno'}</span><button class="profile-control" id="profile-open" type="button" title="Editar foto e perfil"><span class="avatar profile-avatar">${avatar}</span><span><strong>${escapeHtml(user.username || user.name)}</strong><small>Meu perfil</small></span><span class="profile-caret">⌄</span></button><button class="button quiet sign-out-top" id="top-sign-out">Sair</button></header><main class="main"><header class="topbar"><div class="breadcrumb">Harmonette <span>/</span> <strong id="breadcrumb-current">Visão geral</strong></div><span class="local-label">● Salvo neste computador</span></header><div class="app-content" id="app-content"></div></main>`;
    const nav = appShell.querySelector('.nav');
    const groupNav = nav.querySelector('[data-view="grupo"]');
    const exercisesNav = document.createElement('button');
    exercisesNav.className = 'nav-item';
    exercisesNav.dataset.view = 'exercicios';
    exercisesNav.innerHTML = '<span>✓</span> Exercícios';
    nav.insertBefore(exercisesNav, groupNav);
    const assistantNav = document.createElement('button');
    assistantNav.className = 'nav-item';
    assistantNav.dataset.view = 'assistente';
    assistantNav.innerHTML = '<span>♫</span> Assistente';
    nav.append(assistantNav);
    nav.querySelector('[data-view="blocos"]').innerHTML = '<span>▤</span> Aulas';

    const themeToggle = document.createElement('button');
    themeToggle.type = 'button';
    themeToggle.id = 'theme-toggle';
    themeToggle.className = 'button secondary theme-toggle';
    appShell.querySelector('.role-chip').insertAdjacentElement('afterend', themeToggle);
    themeToggle.addEventListener('click', () => {
      const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(themeKey, nextTheme);
      applyTheme(nextTheme);
    });
    applyTheme(localStorage.getItem(themeKey));
    const logoImage = document.createElement('img');
    logoImage.src = 'assets/icone.png';
    logoImage.alt = '';
    appShell.querySelector('.brand-mark').replaceChildren(logoImage);

    appShell.hidden = false;
    appShell.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    appShell.querySelector('#top-sign-out').addEventListener('click', signOut);
    appShell.querySelector('#profile-open').addEventListener('click', openProfileDialog);
    addDialogs();
    refreshProfileDisplay();
    if (!document.querySelector('#assistant-launch')) {
      document.body.insertAdjacentHTML('beforeend', '<button class="assistant-launch" id="assistant-launch" type="button" aria-label="Conversar com Melo, assistente musical"><span class="music-buddy-mini" aria-hidden="true">♫</span><span>Conversar com Melo</span></button><button class="back-to-top" id="back-to-top" type="button" aria-label="Voltar ao topo" hidden>↑</button>');
      document.querySelector('#assistant-launch').addEventListener('click', () => {
        if (isExerciseActive()) { showToast('Melo fica em silêncio enquanto você pratica.'); return; }
        setView('assistente');
      });
      const backToTop = document.querySelector('#back-to-top');
      backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
      window.addEventListener('scroll', () => { backToTop.hidden = window.scrollY < 260; }, { passive: true });
    }
    document.querySelector('#assistant-launch').hidden = false;
  }

  function addDialogs() {
    document.querySelector('#block-dialog')?.remove();
    document.querySelector('#lesson-dialog')?.remove();
    document.querySelector('#student-dialog')?.remove();
    document.querySelector('#profile-dialog')?.remove();
    document.querySelector('#lesson-detail-dialog')?.remove();
    document.querySelector('#quiz-preview-dialog')?.remove();
    document.querySelector('#toast')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<dialog id="block-dialog" class="modal"><div class="dialog-content"><button type="button" class="modal-close" data-close-dialog>×</button><p class="eyebrow">ORGANIZAÇÃO DO CURSO</p><h2 id="block-dialog-title">Criar bloco</h2><p class="modal-intro">Dê uma identidade ao bloco e organize nele as aulas que você for criando.</p><form id="block-form" class="auth-form"><input type="hidden" name="id" id="block-id"><div class="field"><label for="block-title">Nome do bloco</label><input id="block-title" name="title" required maxlength="80" placeholder="Ex.: Teoria musical · Turma A"></div><div class="field"><label for="block-description">Descrição</label><textarea id="block-description" name="description" maxlength="240" placeholder="O que será estudado neste bloco?"></textarea></div><div class="field"><label>Cor do bloco</label><div class="swatch-row"><label class="swatch-option"><input type="radio" name="color" value="blue" checked><span class="swatch blue-swatch"></span> Azul</label><label class="swatch-option"><input type="radio" name="color" value="sky"><span class="swatch sky-swatch"></span> Céu</label><label class="swatch-option"><input type="radio" name="color" value="navy"><span class="swatch navy-swatch"></span> Marinho</label></div></div><div class="field"><label for="block-symbol">Símbolo</label><select id="block-symbol" name="symbol"><option>♫</option><option>♪</option><option>♬</option><option>𝄞</option><option>♭</option></select></div><button class="button primary full" id="save-block" type="submit">Criar bloco</button><button class="button danger full" id="delete-block" type="button" hidden>Excluir bloco e conteúdo</button></form></div></dialog><dialog id="lesson-dialog" class="modal"><div class="dialog-content"><button type="button" class="modal-close" data-close-dialog>×</button><p class="eyebrow">CONTEÚDO DO BLOCO</p><h2>Adicionar aula</h2><p class="modal-intro" id="lesson-block-context"></p><form id="lesson-form" class="auth-form"><input type="hidden" name="blockId" id="lesson-block"><div class="field"><label for="lesson-title">Título</label><input id="lesson-title" name="title" required maxlength="80" placeholder="Ex.: Intervalos musicais"></div><div class="field"><label for="lesson-description">Descrição</label><textarea id="lesson-description" name="description" maxlength="300" placeholder="Resumo da aula"></textarea></div><div class="builder-section"><div class="builder-heading"><div><h3>Materiais de apoio</h3><p>PDFs, partituras, vídeos ou outros links.</p></div><button class="button secondary" type="button" id="add-material">＋ Adicionar material</button></div><div id="material-editor"></div></div><div class="builder-section quiz-builder"><div class="builder-heading"><div><h3>Construtor do quiz</h3><p>Monte perguntas, alternativas, pontuação e notas musicais.</p></div><button class="button secondary" type="button" id="add-question">＋ Adicionar pergunta</button></div><div class="quiz-progress-line"><span id="quiz-question-count">0 perguntas</span><span id="quiz-total-points">0 pontos</span><button class="button quiet" type="button" id="preview-quiz">Pré-visualizar quiz</button></div><div id="question-editor"></div></div><label class="checkbox-line"><input id="lesson-published" type="checkbox" checked> Publicar esta aula no bloco</label><button class="button primary full" type="submit">Salvar aula no bloco</button></form></div></dialog><dialog id="student-dialog" class="modal"><div class="dialog-content"><button type="button" class="modal-close" data-close-dialog>×</button><p class="eyebrow">NOVO ACESSO</p><h2>Criar conta de aluno</h2><p class="modal-intro">Defina o nome de usuário e a senha e compartilhe o endereço de acesso com o aluno.</p><div class="auth-error"></div><form id="student-form" class="auth-form"><div class="field"><label for="student-username">Nome de usuário</label><input id="student-username" name="username" required maxlength="30" placeholder="@aluno"></div><div class="field"><label for="student-password">Senha inicial</label><input id="student-password" name="password" type="text" minlength="8" required placeholder="Pelo menos 8 caracteres"></div><div class="field"><label for="student-block">Bloco liberado</label><select id="student-block" name="blockId"></select></div><button class="button primary full" type="submit">Criar acesso</button></form><div id="created-student" class="result-banner" hidden></div></div></dialog><dialog id="profile-dialog" class="modal profile-modal"><div class="dialog-content"><button type="button" class="modal-close" data-close-dialog>×</button><p class="eyebrow">MINHA CONTA</p><h2>Foto de perfil</h2><p class="modal-intro">Escolha uma imagem e ajuste o enquadramento antes de salvar.</p><div class="crop-stage"><canvas id="avatar-canvas" width="240" height="240" aria-label="Prévia do recorte da foto"></canvas></div><div class="field"><label for="avatar-file">Escolher foto</label><input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp"></div><div class="field"><label for="avatar-zoom">Zoom</label><input id="avatar-zoom" type="range" min="1" max="3" step="0.01" value="1"></div><div class="crop-hint">Arraste a foto para ajustar o corte.</div><button class="button primary full" type="button" id="save-avatar">Salvar foto de perfil</button><button class="button secondary full" type="button" id="remove-avatar">Remover foto</button></div></dialog><dialog id="lesson-detail-dialog" class="modal"><div id="lesson-detail-content" class="dialog-content"></div></dialog><dialog id="quiz-preview-dialog" class="modal"><div id="quiz-preview-content" class="dialog-content"></div></dialog><div class="toast" id="toast" role="status" aria-live="polite"></div>`);
    const profileDialog = document.querySelector('#profile-dialog');
    profileDialog.querySelector('h2').textContent = 'Perfil e foto';
    const identityFields = document.createElement('div');
    identityFields.className = 'profile-identity';
    identityFields.innerHTML = '<div class="field"><label for="profile-display-name">Nome de exibição</label><input id="profile-display-name" maxlength="60" autocomplete="name" placeholder="Como você quer ser chamado"></div><div class="field"><label for="profile-username">Nome de usuário</label><input id="profile-username" readonly aria-describedby="profile-username-note"><small id="profile-username-note">Seu usuário continua separado e serve para entrar.</small></div><button class="button secondary full" type="button" id="save-profile-name">Salvar nome de exibição</button>';
    profileDialog.querySelector('h2').insertAdjacentElement('afterend', identityFields);
    const displayNameField = document.createElement('div');
    displayNameField.className = 'field';
    displayNameField.innerHTML = '<label for="student-display-name">Nome de exibição</label><input id="student-display-name" name="name" required maxlength="60" placeholder="Nome do aluno">';
    document.querySelector('#student-username').parentElement.before(displayNameField);
    document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    document.querySelector('#block-form').addEventListener('submit', createBlock);
    document.querySelector('#delete-block').addEventListener('click', deleteBlock);
    document.querySelector('#lesson-form').addEventListener('submit', createLesson);
    document.querySelector('#student-form').addEventListener('submit', createStudent);
    document.querySelector('#add-material').addEventListener('click', addMaterialRow);
    document.querySelector('#add-question').addEventListener('click', addQuestionRow);
    document.querySelector('#preview-quiz').addEventListener('click', previewQuiz);
    document.querySelector('#avatar-file').addEventListener('change', loadAvatarImage);
    document.querySelector('#avatar-zoom').addEventListener('input', drawAvatarCrop);
    document.querySelector('#avatar-canvas').addEventListener('pointerdown', beginAvatarDrag);
    document.querySelector('#avatar-canvas').addEventListener('pointermove', moveAvatarDrag);
    document.querySelector('#avatar-canvas').addEventListener('pointerup', endAvatarDrag);
    document.querySelector('#avatar-canvas').addEventListener('pointercancel', endAvatarDrag);
    document.querySelector('#save-avatar').addEventListener('click', saveAvatar);
    document.querySelector('#remove-avatar').addEventListener('click', () => persistAvatar(null));
    document.querySelector('#save-profile-name').addEventListener('click', saveDisplayName);
  }

  function showToast(message) {
    const toast = document.querySelector('#toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  async function loadDashboard() {
    try {
      const result = await api('/api/blocks');
      blocks = await Promise.all(result.blocks.map(async block => {
        const detail = await api(`/api/blocks/${encodeURIComponent(block.id)}`);
        return { ...detail.block, lessonCount: block.lessonCount };
      }));
      if (user.role === 'teacher') {
        const [studentResult, inviteResult, submissionResult, groupResult] = await Promise.all([api('/api/students'), api('/api/invites'), api('/api/submissions'), api('/api/group')]);
        students = studentResult.students;
        invites = inviteResult.invites;
        submissions = submissionResult.submissions;
        groupMembers = groupResult.members;
      } else {
        const [groupResult, progressResult] = await Promise.all([api('/api/group'), api('/api/progress')]);
        groupMembers = groupResult.members;
        completedLessonIds = new Set(progressResult.completedLessonIds);
      }
      renderView();
    } catch (error) {
      showToast(error.message);
      if (error.message.includes('Entre na sua conta')) signOut();
    }
  }

  function setView(view) {
    if (view === 'assistente' && isExerciseActive()) {
      showToast('Melo fica em silêncio enquanto você pratica.');
      return;
    }
    currentView = view;
    activeBlock = null;
    appShell.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    const names = { inicio: 'Visão geral', blocos: 'Aulas', exercicios: 'Exercícios', assistente: 'Assistente musical', grupo: 'Grupo', atividades: 'Respostas', detalhe: 'Aulas' };
    document.querySelector('#breadcrumb-current').textContent = names[view] || 'Harmonette';
    renderView();
  }

  function pageHeading(eyebrow, title, description, button = '') {
    return `<div class="view-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div>${button}</div>`;
  }

  function blockCardMarkup(block) {
    return `<article class="block-card" data-block-color="${escapeHtml(block.color || 'blue')}"><div class="block-card-body"><div class="block-top"><span class="block-icon">${escapeHtml(block.symbol || '♫')}</span><span class="tag">${block.lessonCount} ${block.lessonCount === 1 ? 'aula' : 'aulas'}</span></div><h3>${escapeHtml(block.title)}</h3><p>${escapeHtml(block.description || 'Bloco de estudo musical.')}</p><div class="card-actions"><button class="button primary" type="button" data-open-block="${escapeHtml(block.id)}">Abrir bloco <span>→</span></button>${user.role === 'teacher' ? `<button class="icon-action" type="button" title="Editar bloco" aria-label="Editar ${escapeHtml(block.title)}" data-edit-block="${escapeHtml(block.id)}">✎</button>` : ''}</div></div></article>`;
  }

  function renderView() {
    const content = document.querySelector('#app-content');
    if (!content) return;
    if (currentView === 'inicio') content.innerHTML = renderHome();
    else if (currentView === 'blocos') content.innerHTML = renderBlocksPage();
    else if (currentView === 'exercicios') content.innerHTML = renderExercisesPage();
    else if (currentView === 'assistente') content.innerHTML = renderAssistantPage();
    else if (currentView === 'grupo') content.innerHTML = renderGroupPage();
    else if (currentView === 'atividades' && user.role === 'teacher') content.innerHTML = renderSubmissionsPage();
    else if (currentView === 'detalhe' && activeBlock) content.innerHTML = renderBlockDetail(activeBlock);
    else content.innerHTML = renderHome();
    content.querySelectorAll('[data-open-block]').forEach(button => button.addEventListener('click', () => openBlock(button.dataset.openBlock)));
    content.querySelectorAll('[data-study-tab]').forEach(button => button.addEventListener('click', () => {
      studyTab = button.dataset.studyTab;
      renderView();
    }));
    content.querySelector('#new-block')?.addEventListener('click', () => openBlockDialog());
    content.querySelector('#new-lesson')?.addEventListener('click', () => openLessonBuilder(activeBlock?.id));
    content.querySelector('[data-edit-active-block]')?.addEventListener('click', () => openBlockDialog(activeBlock));
    content.querySelector('#invite-student')?.addEventListener('click', () => openStudentDialog(activeBlock?.id));
    content.querySelector('#create-student')?.addEventListener('click', () => openStudentDialog());
    content.querySelector('#group-chart-type')?.addEventListener('change', updateGroupChart);
    content.querySelectorAll('[data-delete-student]').forEach(button => button.addEventListener('click', () => deleteStudent(button.dataset.deleteStudent)));
    content.querySelectorAll('[data-edit-block]').forEach(button => button.addEventListener('click', () => {
      const block = blocks.find(item => item.id === button.dataset.editBlock);
      if (block) openBlockDialog(block);
    }));
    content.querySelectorAll('[data-open-lesson]').forEach(button => button.addEventListener('click', () => openLesson(button.dataset.blockId, button.dataset.openLesson, button.dataset.lessonMode || 'aula')));
    bindAssistantChat(content);
    if (currentView === 'grupo') updateGroupChart();
  }

  function renderHome() {
    const teacher = user.role === 'teacher';
    const lessonCount = blocks.reduce((sum, block) => sum + block.lessonCount, 0);
    const exerciseCount = blocks.reduce((sum, block) => sum + block.lessons.filter(lesson => lesson.questions?.length && (teacher || lesson.published)).length, 0);
    const studentsCount = students.length;
    const responseCount = submissions.length;
    const items = blocks.slice(0, 3).map(blockCardMarkup).join('');
    return `${pageHeading(teacher ? 'ÁREA DO PROFESSOR' : 'ÁREA DO ALUNO', `Olá, ${escapeHtml((user.name || user.username || 'músico').split(' ')[0])}`, teacher ? 'Organize o conteúdo e crie os acessos dos alunos.' : 'Continue seus estudos nos blocos compartilhados com você.', teacher ? '<button class="button primary" id="new-block">＋ Criar bloco</button>' : '')}
      <section class="hero-panel"><div><p class="eyebrow">HARMONETTE</p><h2>${teacher ? 'Seu método, sua sala de aula.' : 'Um passo de cada vez.'}</h2><p>${teacher ? 'Crie blocos, organize aulas e libere acessos individuais para seus alunos.' : 'Acesse as aulas que seu professor compartilhou com você.'}</p><button class="hero-action" type="button" data-view-link="${teacher ? 'blocos' : 'exercicios'}">${teacher ? 'Organizar minhas aulas' : 'Explorar exercícios'} <span aria-hidden="true">→</span></button></div><span class="hero-note" aria-hidden="true">♫</span></section>
      <div class="stat-grid"><article class="stat-card"><span>Blocos</span><strong>${blocks.length}</strong></article><article class="stat-card"><span>Aulas</span><strong>${lessonCount}</strong></article><article class="stat-card"><span>${teacher ? 'Alunos' : 'Exercícios disponíveis'}</span><strong>${teacher ? studentsCount : exerciseCount}</strong></article><article class="stat-card"><span>${teacher ? 'Respostas recebidas' : 'Exercícios concluídos'}</span><strong>${teacher ? responseCount : completedLessonIds.size}</strong></article></div>
      <div class="section-heading"><div><h2>${teacher ? 'Seus blocos' : 'Sua trilha'}</h2><p>${teacher ? 'Acesse e organize cada grupo de conteúdo.' : 'Conteúdo liberado pelo seu professor.'}</p></div><button class="button quiet" data-view-link="blocos">Ver todos →</button></div>
      ${items ? `<div class="block-grid">${items}</div>` : `<div class="empty-state"><span class="empty-icon">▤</span><h3>${teacher ? 'Comece criando um bloco' : 'Nenhum bloco compartilhado ainda'}</h3><p>${teacher ? 'Blocos podem representar uma turma, assunto ou etapa do curso.' : 'Quando seu professor liberar um bloco, ele aparecerá aqui.'}</p>${teacher ? '<button class="button primary" id="new-block-empty">＋ Criar primeiro bloco</button>' : ''}</div>`}`;
  }

  function renderBlocksPage() {
    const teacher = user.role === 'teacher';
    const items = blocks.map(blockCardMarkup).join('');
    return `${pageHeading(teacher ? 'ORGANIZAÇÃO DO CURSO' : 'CONTEÚDO COMPARTILHADO', teacher ? 'Meus blocos' : 'Minha trilha', teacher ? 'Crie blocos separados por turma, tema ou etapa de aprendizagem.' : 'Blocos e aulas que seu professor disponibilizou.', teacher ? '<button class="button primary" id="new-block">＋ Criar bloco</button>' : '')}${items ? `<div class="block-grid">${items}</div>` : `<div class="empty-state"><span class="empty-icon">▤</span><h3>${teacher ? 'Nenhum bloco criado' : 'Sua trilha está vazia'}</h3><p>${teacher ? 'Crie o primeiro bloco e depois adicione aulas e convites.' : 'Peça ao professor para compartilhar um bloco com você.'}</p>${teacher ? '<button class="button primary" id="new-block-empty">＋ Criar bloco</button>' : ''}</div>`}`;
  }

  function renderExercisesPage() {
    const availableLessons = blocks.flatMap(block => block.lessons
      .filter(lesson => lesson.questions?.length && (user.role === 'teacher' || lesson.published))
      .map(lesson => ({ block, lesson })));
    const cards = availableLessons.map(({ block, lesson }) => renderLessonCard(block, lesson, true)).join('');
    return `${pageHeading('PRÁTICA MUSICAL', 'Exercícios', 'Pratique separadamente das aulas e acompanhe o que já concluiu.')}${cards ? `<div class="lesson-grid">${cards}</div>` : `<div class="empty-state"><span class="empty-icon">♫</span><h3>Nenhum exercício disponível</h3><p>${user.role === 'teacher' ? 'Adicione perguntas a uma aula para que elas apareçam nesta área.' : 'Quando uma aula com atividade for compartilhada, ela aparecerá aqui.'}</p></div>`}`;
  }

  function renderAssistantPage() {
    return `${pageHeading('TIRA-DÚVIDAS MUSICAL', 'Melo, seu companheiro de estudos', 'Converse sobre teoria, ritmo, notas e leitura musical. Ele oferece pistas, não gabaritos.')}<div class="assistant-layout"><section class="assistant-character-card"><div class="music-buddy" aria-hidden="true"><span class="music-buddy-note">♫</span><span class="music-buddy-eyes"><i></i><i></i></span><span class="music-buddy-flute"></span></div><h2>Olá, ${escapeHtml((user.name || 'músico').split(' ')[0])}!</h2><p>Vamos aprender música juntos? Pergunte sobre um conceito e eu ajudo você a encontrar o caminho.</p></section>${assistantChatMarkup('assistant-page')}</div>`;
  }

  function assistantChatMarkup(id) {
    return `<section class="assistant-chat" aria-label="Conversa com Melo"><header class="assistant-chat-heading"><span class="avatar-small">♫</span><span><strong>Melo · assistente musical</strong><small>Disponível fora dos exercícios</small></span></header><div class="assistant-messages" id="${id}-messages" aria-live="polite"></div><div class="assistant-suggestions"><button type="button" data-assistant-prompt="Como identifico um intervalo musical?">Intervalos</button><button type="button" data-assistant-prompt="Como se forma um acorde?">Acordes</button><button type="button" data-assistant-prompt="Como leio o ritmo de um compasso?">Ritmo</button></div><form class="assistant-form" id="${id}-form"><textarea name="message" rows="1" maxlength="400" required aria-label="Sua dúvida musical" placeholder="Escreva sua dúvida musical..."></textarea><button class="button primary" type="submit" aria-label="Enviar mensagem">Enviar</button></form><p class="assistant-disclaimer">Assistente local de estudos: suas mensagens não saem deste computador. As respostas dão pistas; não fornecem o gabarito dos exercícios.</p></section>`;
  }

  function isExerciseActive() {
    const dialog = document.querySelector('#lesson-detail-dialog');
    return Boolean(dialog?.open && dialog.dataset.activeTab === 'exercicios');
  }

  function assistantReply(message) {
    const question = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    if (/interval|semitom|tom/.test(question)) return 'Uma boa pista: compare primeiro os nomes das notas e conte as letras de uma até a outra. Depois confira a distância em tons e semitons. Tente cantar as duas notas e descreva o que percebeu.';
    if (/acorde|triade|tríade|harmon/.test(question)) return 'Comece encontrando a nota fundamental. Em seguida, organize as outras notas em terças e observe a distância entre elas. Monte o acorde no piano e escute se o resultado soa maior, menor ou diferente.';
    if (/ritmo|compasso|pulso/.test(question)) return 'Marque um pulso regular com a mão antes de ler as figuras. O número de cima do compasso indica quantos tempos contar; depois some a duração de cada figura sem acelerar.';
    if (/piano|tecla|nota|escala/.test(question)) return 'No piano, use os grupos de duas e três teclas pretas para se orientar. Encontre a nota de referência e siga a sequência musical uma tecla de cada vez; diga em voz alta o nome de cada nota.';
    if (/partitura|clave|pauta/.test(question)) return 'Leia a clave primeiro e localize uma nota que você já conhece. A partir dela, alterne entre linhas e espaços para identificar as próximas; só depois confira a armadura e o compasso.';
    return 'Vamos por partes: qual conceito musical está envolvido e o que você já tentou? Conte o primeiro passo do seu raciocínio; eu posso sugerir uma pista sem entregar a resposta pronta.';
  }

  function renderAssistantMessages(container) {
    const messages = container.querySelector('.assistant-messages');
    if (!messages) return;
    messages.innerHTML = assistantMessages.map(message => `<div class="assistant-bubble ${message.role === 'user' ? 'user' : ''}">${escapeHtml(message.text)}</div>`).join('');
    messages.scrollTop = messages.scrollHeight;
  }

  function bindAssistantChat(container) {
    const chat = container.querySelector('.assistant-chat');
    if (!chat) return;
    renderAssistantMessages(chat);
    chat.querySelector('.assistant-form').addEventListener('submit', event => {
      event.preventDefault();
      if (isExerciseActive()) { showToast('Melo fica em silêncio enquanto você pratica.'); return; }
      const input = event.currentTarget.elements.message;
      const message = input.value.trim();
      if (!message) return;
      assistantMessages.push({ role: 'user', text: message });
      assistantMessages.push({ role: 'assistant', text: assistantReply(message) });
      input.value = '';
      renderAssistantMessages(chat);
    });
    chat.querySelectorAll('[data-assistant-prompt]').forEach(button => button.addEventListener('click', () => {
      const input = chat.querySelector('textarea[name="message"]');
      input.value = button.dataset.assistantPrompt;
      chat.querySelector('.assistant-form').requestSubmit();
    }));
  }

  function renderLessonCard(block, lesson, exercise = false) {
    const completed = completedLessonIds.has(lesson.id);
    const status = exercise
      ? user.role === 'student' && completed ? '<span class="tag success exercise-status">✓ Concluído</span>' : '<span class="tag pending exercise-status">Exercício</span>'
      : `<span class="tag ${lesson.published ? 'success' : 'neutral'}">${lesson.published ? 'Compartilhada' : 'Privada'}</span>`;
    return `<article class="lesson-card ${exercise ? 'exercise-card' : ''}"><div class="lesson-cover"><span>${exercise ? 'PRÁTICA' : lesson.published ? 'AULA DISPONÍVEL' : 'RASCUNHO'}</span><b>${exercise ? '♫' : '♪'}</b></div><div class="lesson-card-body">${status}<h3>${escapeHtml(lesson.title)}</h3><p>${escapeHtml(lesson.description || (exercise ? 'Responda e conclua esta prática musical.' : 'Aula de prática musical.'))}</p><div class="card-meta"><span>${exercise ? `${lesson.questions?.length || 0} questões · ${escapeHtml(block.title)}` : `${lesson.materials?.length || 0} materiais · ${lesson.questions?.length || 0} perguntas`}</span><button class="button quiet" data-open-lesson="${escapeHtml(lesson.id)}" data-block-id="${escapeHtml(block.id)}" data-lesson-mode="${exercise ? 'exercicios' : 'aula'}">${exercise ? completed ? 'Rever →' : 'Começar →' : 'Abrir →'}</button></div></div></article>`;
  }

  function renderBlockDetail(block) {
    const lessons = user.role === 'teacher' ? block.lessons : block.lessons.filter(lesson => lesson.published);
    const exerciseLessons = lessons.filter(lesson => lesson.questions?.length);
    const lessonCards = lessons.map(lesson => renderLessonCard(block, lesson)).join('');
    const exerciseCards = exerciseLessons.map(lesson => renderLessonCard(block, lesson, true)).join('');
    const actions = user.role === 'teacher' ? '<div class="heading-actions"><button class="button secondary" data-edit-active-block>✎ Editar bloco</button><button class="button primary" id="new-lesson">＋ Adicionar aula</button></div>' : '';
    return `${pageHeading(user.role === 'teacher' ? 'BLOCO DE CONTEÚDO' : 'BLOCO COMPARTILHADO', escapeHtml(block.title), escapeHtml(block.description || 'Aulas, materiais e atividades deste bloco.'), actions)}<div class="block-detail-head"><div><h2>${escapeHtml(block.title)}</h2><p>${escapeHtml(block.description || 'Conteúdo organizado pelo professor.')}</p></div>${user.role === 'teacher' ? `<button class="button secondary" id="invite-student">＋ Criar acesso de aluno</button>` : ''}</div><div class="study-tabs" role="tablist" aria-label="Conteúdo do bloco"><button class="study-tab" type="button" role="tab" data-study-tab="aulas" aria-selected="${studyTab === 'aulas'}">Aulas · ${lessons.length}</button><button class="study-tab" type="button" role="tab" data-study-tab="exercicios" aria-selected="${studyTab === 'exercicios'}">Exercícios · ${exerciseLessons.length}</button></div><section class="study-panel" data-study-panel="aulas" ${studyTab !== 'aulas' ? 'hidden' : ''}>${lessonCards ? `<div class="lesson-grid">${lessonCards}</div>` : `<div class="empty-state"><span class="empty-icon">♪</span><h3>${user.role === 'teacher' ? 'Adicione a primeira aula' : 'Ainda não há aulas publicadas'}</h3><p>${user.role === 'teacher' ? 'Inclua materiais e quizzes para compartilhar com os alunos do bloco.' : 'Seu professor ainda não publicou conteúdo neste bloco.'}</p>${user.role === 'teacher' ? '<button class="button primary" data-new-lesson>＋ Adicionar aula</button>' : ''}</div>`}</section><section class="study-panel" data-study-panel="exercicios" ${studyTab !== 'exercicios' ? 'hidden' : ''}>${exerciseCards ? `<div class="lesson-grid">${exerciseCards}</div>` : `<div class="empty-state"><span class="empty-icon">♫</span><h3>Nenhum exercício neste bloco</h3><p>${user.role === 'teacher' ? 'Crie perguntas no construtor de uma aula para montar exercícios.' : 'As atividades das aulas aparecerão aqui quando forem publicadas.'}</p></div>`}</section>`;
  }

  function renderStudentsPage() {
    const studentRows = students.map(student => `<tr><td><span class="student-name-cell"><span class="avatar-small">${escapeHtml((student.name || student.username || '?').slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(student.name || student.username)}</strong><small>${escapeHtml(student.username)}</small></span></span></td><td><span class="tag success">Acesso ativo</span></td><td><button class="icon-action" type="button" title="Revogar acesso" aria-label="Revogar acesso de ${escapeHtml(student.username)}" data-delete-student="${escapeHtml(student.id)}">×</button></td></tr>`).join('');
    return `${pageHeading('ACESSOS DA TURMA', 'Contas de alunos', 'Crie o usuário e a senha e compartilhe o endereço de acesso.', '<button class="button primary" id="create-student">＋ Criar acesso</button>')}<section class="surface surface-pad"><div class="panel-heading"><div><h2>Alunos cadastrados</h2><p>Os acessos e blocos liberados ficam neste computador.</p></div><span class="tag">${students.length} alunos</span></div>${studentRows ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Nome de usuário</th><th>Acesso</th><th></th></tr></thead><tbody>${studentRows}</tbody></table></div>` : '<div class="empty-state"><span class="empty-icon">♙</span><h3>Nenhuma conta de aluno</h3><p>Use “Criar acesso” para cadastrar o primeiro aluno.</p></div>'}</section>`;
  }

  function groupLastSeen(member) {
    if (member.isOnline) return 'Online agora';
    if (!member.lastSeenAt) return 'Ainda não acessou';
    const elapsed = Math.max(0, Date.now() - Date.parse(member.lastSeenAt));
    if (elapsed < 60_000) return 'Visto há menos de 1 min';
    if (elapsed < 3_600_000) return `Visto há ${Math.floor(elapsed / 60_000)} min`;
    if (elapsed < 86_400_000) return `Visto há ${Math.floor(elapsed / 3_600_000)} h`;
    return `Visto em ${new Date(member.lastSeenAt).toLocaleDateString('pt-BR')}`;
  }

  function renderGroupPage() {
    const memberRows = groupMembers.map(member => `<article class="group-member-row"><span class="avatar-small">${escapeHtml((member.name || member.username || '?').slice(0, 1).toUpperCase())}</span><div class="group-member-main"><strong>${escapeHtml(member.name || member.username)}</strong><small>${escapeHtml(member.username)} · ${groupLastSeen(member)}</small></div><span class="presence-indicator ${member.isOnline ? 'online' : ''}">${member.isOnline ? 'Online' : 'Offline'}</span><span class="group-activity"><strong>${member.submissionCount}</strong><small>envios</small></span><span class="group-accuracy">${member.averageAccuracy === null ? '—' : `${member.averageAccuracy}%`}</span>${user.role === 'teacher' ? `<button class="icon-action" type="button" title="Revogar acesso" aria-label="Revogar ${escapeHtml(member.username)}" data-delete-student="${escapeHtml(member.id)}">×</button>` : ''}</article>`).join('');
    const online = groupMembers.filter(member => member.isOnline).length;
    const chart = groupMembers.length ? '<canvas id="group-chart" aria-label="Gráfico de atividade por aluno"></canvas>' : '<div class="chart-empty">As respostas aparecerão aqui quando os alunos concluírem um quiz.</div>';
    const empty = '<div class="empty-state"><span class="empty-icon">♙</span><h3>O grupo ainda está vazio</h3><p>Crie acessos e associe os alunos a um bloco para formar a turma.</p></div>';
    return `${pageHeading('TURMA E ACOMPANHAMENTO', 'Grupo', 'Veja quem está ativo e acompanhe a prática musical da turma.', user.role === 'teacher' ? '<button class="button primary" id="create-student">＋ Criar acesso</button>' : '')}<div class="group-summary"><article class="group-summary-card"><span>Membros</span><strong>${groupMembers.length}</strong></article><article class="group-summary-card"><span>Online agora</span><strong>${online}</strong></article><article class="group-summary-card"><span>Respostas enviadas</span><strong>${groupMembers.reduce((sum, member) => sum + member.submissionCount, 0)}</strong></article></div><section class="surface group-chart-panel"><div class="panel-heading"><div><h2>Atividade do grupo</h2><p>Respostas enviadas por aluno.</p></div><div class="chart-mode"><label for="group-chart-type">Visualização</label><select id="group-chart-type"><option value="bar">Barras</option><option value="pie">Pizza</option></select></div></div><div class="group-chart-wrap">${chart}</div></section><section class="surface group-roster"><div class="panel-heading"><div><h2>Membros</h2><p>Status e último acesso.</p></div><span class="tag">${online} online</span></div>${memberRows || empty}</section>`;
  }

  function updateGroupChart() {
    const canvas = document.querySelector('#group-chart');
    if (!canvas || !window.Chart) return;
    if (groupChart) groupChart.destroy();
    const type = document.querySelector('#group-chart-type')?.value || 'bar';
    const palette = ['#2874c8', '#42a2cf', '#44628c', '#75b9df', '#6592c5', '#294a70', '#9acde8'];
    groupChart = new window.Chart(canvas, {
      type: type === 'pie' ? 'pie' : 'bar',
      data: {
        labels: groupMembers.map(member => member.username),
        datasets: [{ label: 'Respostas enviadas', data: groupMembers.map(member => member.submissionCount), backgroundColor: groupMembers.map((_, index) => palette[index % palette.length]), borderRadius: type === 'pie' ? 0 : 6, borderWidth: type === 'pie' ? 2 : 0, borderColor: '#ffffff' }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: type === 'pie', position: 'bottom' } }, scales: type === 'pie' ? {} : { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#edf2f7' } } } }
    });
  }

  function renderSubmissionsPage() {
    const rows = submissions.map(item => `<tr><td>${escapeHtml(item.studentName)}</td><td>${escapeHtml(item.blockTitle)}</td><td>${escapeHtml(item.lessonTitle)}</td><td>${item.correct}/${item.graded}${item.manual ? ` · ${item.manual} para revisar` : ''}</td><td>${new Date(item.createdAt).toLocaleString('pt-BR')}</td></tr>`).join('');
    return `${pageHeading('ACOMPANHAMENTO', 'Respostas dos alunos', 'Resultados enviados pelos alunos ao concluir os quizzes.')}${rows ? `<section class="surface surface-pad table-wrap"><table class="data-table"><thead><tr><th>Aluno</th><th>Bloco</th><th>Aula</th><th>Resultado</th><th>Enviado em</th></tr></thead><tbody>${rows}</tbody></table></section>` : '<div class="empty-state"><span class="empty-icon">✓</span><h3>Nenhuma resposta recebida</h3><p>Os resultados aparecerão aqui quando os alunos responderem aos quizzes.</p></div>'}`;
  }

  async function openBlock(blockId) {
    try {
      const result = await api(`/api/blocks/${encodeURIComponent(blockId)}`);
      activeBlock = result.block;
      studyTab = 'aulas';
      currentView = 'detalhe';
      appShell.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === 'blocos'));
      document.querySelector('#breadcrumb-current').textContent = activeBlock.title;
      renderView();
    } catch (error) { showToast(error.message); }
  }

  function openBlockDialog(block = null) {
    const form = document.querySelector('#block-form');
    form.reset();
    document.querySelector('#block-dialog-title').textContent = block ? 'Editar bloco' : 'Criar bloco';
    document.querySelector('#block-id').value = block?.id || '';
    document.querySelector('#block-title').value = block?.title || '';
    document.querySelector('#block-description').value = block?.description || '';
    document.querySelector(`#block-form input[name="color"][value="${block?.color || 'blue'}"]`).checked = true;
    document.querySelector('#block-symbol').value = block?.symbol || '♫';
    document.querySelector('#save-block').textContent = block ? 'Salvar alterações' : 'Criar bloco';
    document.querySelector('#delete-block').hidden = !block;
    document.querySelector('#block-dialog').showModal();
  }

  async function createBlock(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const blockId = form.get('id');
    const payload = Object.fromEntries(form);
    delete payload.id;
    try {
      await api(blockId ? `/api/blocks/${encodeURIComponent(blockId)}` : '/api/blocks', { method: blockId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      document.querySelector('#block-dialog').close();
      formElement.reset();
      await loadDashboard();
      if (blockId && currentView === 'detalhe' && activeBlock?.id === blockId) await openBlock(blockId);
      else setView('blocos');
      showToast(blockId ? 'Bloco atualizado.' : 'Bloco criado.');
    } catch (error) { showToast(error.message); }
  }

  async function deleteBlock() {
    const blockId = document.querySelector('#block-id').value;
    const block = blocks.find(item => item.id === blockId);
    if (!block || !window.confirm(`Excluir “${block.title}”, suas aulas e respostas? Esta ação não pode ser desfeita.`)) return;
    try {
      await api(`/api/blocks/${encodeURIComponent(blockId)}`, { method: 'DELETE' });
      document.querySelector('#block-dialog').close();
      activeBlock = null;
      await loadDashboard();
      setView('blocos');
      showToast('Bloco e conteúdo excluídos.');
    } catch (error) { showToast(error.message); }
  }

  function openLessonBuilder(blockId) {
    if (!blockId) { showToast('Abra um bloco para adicionar uma aula.'); return; }
    const block = blocks.find(item => item.id === blockId) || activeBlock;
    if (!block) { showToast('Bloco não encontrado.'); return; }
    document.querySelector('#lesson-form').reset();
    document.querySelector('#lesson-block').value = blockId;
    document.querySelector('#lesson-block-context').textContent = `Esta aula será adicionada a “${block.title}”.`;
    document.querySelector('#material-editor').innerHTML = '';
    document.querySelector('#question-editor').innerHTML = '';
    document.querySelector('#lesson-published').checked = true;
    document.querySelector('#lesson-dialog').showModal();
  }

  function openStudentDialog(blockId = '') {
    const select = document.querySelector('#student-block');
    select.innerHTML = '<option value="">Todos os blocos</option>' + blocks.map(block => `<option value="${escapeHtml(block.id)}">${escapeHtml(block.title)}</option>`).join('');
    select.value = blockId || '';
    document.querySelector('#student-form').reset();
    select.value = blockId || '';
    document.querySelector('#created-student').hidden = true;
    document.querySelector('#student-dialog').showModal();
  }

  async function createStudent(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const password = values.password;
    try {
      const result = await api('/api/students', { method: 'POST', body: JSON.stringify(values) });
      const output = document.querySelector('#created-student');
      output.innerHTML = `<strong>Acesso criado</strong><span>Nome: <b>${escapeHtml(result.student.name)}</b><br>Usuário: <b>${escapeHtml(result.student.username)}</b><br>Senha inicial: <b>${escapeHtml(password)}</b></span><a class="student-login-link" href="${escapeHtml(result.url)}" target="_blank" rel="noopener">Abrir tela de acesso</a><button type="button" class="button secondary" data-copy-credentials="${escapeHtml(`${result.student.name}\n${result.student.username}\n${password}\n${result.url}`)}">Copiar acesso</button><small>Compartilhe esses dados diretamente com o aluno. A senha não será exibida novamente.</small>`;
      output.hidden = false;
      form.reset();
      await loadDashboard();
    } catch (error) { showToast(error.message); }
  }

  async function deleteStudent(studentId) {
    const student = students.find(item => item.id === studentId);
    if (!student || !window.confirm(`Revogar o acesso de ${student.username}? As respostas associadas também serão removidas.`)) return;
    try {
      await api(`/api/students/${encodeURIComponent(studentId)}`, { method: 'DELETE' });
      await loadDashboard();
      showToast('Acesso do aluno revogado.');
    } catch (error) { showToast(error.message); }
  }

  function addMaterialRow() {
    const row = document.createElement('div');
    row.className = 'editor-row material-editor';
    row.innerHTML = `<div class="field"><label>Tipo</label><select class="material-type"><option>PDF</option><option>Link</option></select></div><div class="field"><label>Nome</label><input class="material-name" maxlength="70" placeholder="Apostila"></div><div class="field"><label>Endereço</label><input class="material-url" type="url" placeholder="https://..."></div><button type="button" class="remove-row" aria-label="Remover material">×</button>`;
    row.querySelector('.remove-row').addEventListener('click', () => row.remove());
    document.querySelector('#material-editor').append(row);
  }

  function addQuestionRow() {
    const row = document.createElement('div');
    row.className = 'editor-row question-editor';
    row.innerHTML = `<div class="question-top"><div class="field"><label>Enunciado</label><input class="question-prompt" required maxlength="180" placeholder="Escreva a pergunta"></div><div class="field"><label>Tipo</label><select class="question-type"><option value="written">Resposta escrita</option><option value="choice">Múltipla escolha</option><option value="boolean">Verdadeiro ou falso</option><option value="degree">Identificar nota</option><option value="chord">Montar acorde</option><option value="score">Partitura MusicXML</option></select></div><div class="field"><label>Pontos</label><input class="question-points" type="number" min="1" max="20" value="1"></div><div class="question-order-actions"><button class="icon-action move-question-up" type="button" aria-label="Mover pergunta para cima">↑</button><button class="icon-action move-question-down" type="button" aria-label="Mover pergunta para baixo">↓</button></div><button class="remove-row" type="button" aria-label="Remover pergunta">×</button></div><div class="question-extra"></div><div class="field explanation-field"><label>Explicação após resposta (opcional)</label><textarea class="question-explanation" rows="2" maxlength="500" placeholder="Explique por que a resposta está correta"></textarea></div>`;
    row.querySelector('.question-type').addEventListener('change', () => renderQuestionFields(row));
    row.querySelector('.question-points').addEventListener('input', updateQuizSummary);
    row.querySelector('.remove-row').addEventListener('click', () => { row.remove(); updateQuizSummary(); });
    row.querySelector('.move-question-up').addEventListener('click', () => {
      if (row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
    });
    row.querySelector('.move-question-down').addEventListener('click', () => {
      if (row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
    });
    document.querySelector('#question-editor').append(row);
    renderQuestionFields(row);
    updateQuizSummary();
  }

  function updateQuizSummary() {
    const questions = [...document.querySelectorAll('#question-editor .question-editor')];
    const total = questions.reduce((sum, row) => sum + Math.max(1, Number(row.querySelector('.question-points')?.value) || 1), 0);
    document.querySelector('#quiz-question-count').textContent = `${questions.length} ${questions.length === 1 ? 'pergunta' : 'perguntas'}`;
    document.querySelector('#quiz-total-points').textContent = `${total} ${total === 1 ? 'ponto' : 'pontos'}`;
  }

  function noteOptions(region) {
    const startOctave = Number(region.slice(1));
    return Array.from({ length: 24 }, (_, offset) => `${noteNames[offset % 12]}${startOctave + Math.floor(offset / 12)}`);
  }

  function renderQuestionFields(row) {
    const type = row.querySelector('.question-type').value;
    const extra = row.querySelector('.question-extra');
    if (type === 'choice') {
      extra.innerHTML = `<div class="wide-field"><div class="field"><label>Alternativas</label><div class="option-inputs"><input class="choice-option" maxlength="100" placeholder="Alternativa 1" required><input class="choice-option" maxlength="100" placeholder="Alternativa 2" required></div><button class="button quiet add-option" type="button">＋ Adicionar alternativa</button></div></div><div class="field"><label>Resposta correta</label><select class="correct-option"><option value="0">Alternativa 1</option><option value="1">Alternativa 2</option></select></div>`;
      const addOption = extra.querySelector('.add-option');
      addOption.addEventListener('click', () => {
        const options = extra.querySelector('.option-inputs');
        const count = options.querySelectorAll('.choice-option').length;
        if (count >= 6) { showToast('Cada pergunta pode ter até 6 alternativas.'); return; }
        const index = count;
        options.insertAdjacentHTML('beforeend', `<div class="option-entry"><input class="choice-option" maxlength="100" placeholder="Alternativa ${index + 1}"><button class="remove-option" type="button" aria-label="Remover alternativa ${index + 1}">×</button></div>`);
        const entry = options.lastElementChild;
        entry.querySelector('.remove-option').addEventListener('click', () => {
          entry.remove();
          updateChoiceAnswerOptions(extra);
        });
        updateChoiceAnswerOptions(extra);
      });
    } else if (type === 'boolean') {
      extra.innerHTML = `<div class="field"><label>Resposta correta</label><select class="boolean-answer"><option value="0">Verdadeiro</option><option value="1">Falso</option></select></div>`;
    } else if (type === 'degree') {
      extra.innerHTML = `<div class="field"><label>Início das duas oitavas</label><select class="piano-region">${['C2', 'C3', 'C4', 'C5'].map(note => `<option>${note}</option>`).join('')}</select></div><div class="field"><label>Nota tocada para o aluno</label><select class="target-note"></select></div><label class="checkbox-line"><input type="checkbox" class="play-on-open" checked> Tocar automaticamente ao abrir</label>`;
      const region = row.querySelector('.piano-region');
      const target = row.querySelector('.target-note');
      const fillNotes = () => { target.innerHTML = noteOptions(region.value).map(note => `<option>${note}</option>`).join(''); };
      region.addEventListener('change', fillNotes);
      fillNotes();
    } else if (type === 'chord') {
      extra.innerHTML = `<div class="form-grid"><div class="field"><label>Região do teclado</label><select class="piano-region">${['C2', 'C3', 'C4', 'C5'].map(note => `<option>${note}</option>`).join('')}</select></div><label class="checkbox-line"><input type="checkbox" class="play-on-open"> Tocar o acorde de referência ao abrir</label></div><p class="muted chord-help">Marque todas as notas do acorde esperado. O aluno poderá tocar várias teclas e ouvir o acorde montado.</p><div class="piano chord-authoring-piano" aria-label="Escolha as notas esperadas do acorde">${pianoMarkup('C3')}</div><div class="chord-authoring-footer"><span class="chord-answer-summary">Nenhuma nota escolhida</span><button class="button secondary play-author-chord" type="button">▶ Ouvir acorde</button><button class="button quiet clear-author-chord" type="button">Limpar</button></div><input class="chord-answer" type="hidden" value="[]">`;
      const authorPiano = extra.querySelector('.chord-authoring-piano');
      extra.querySelector('.piano-region').value = 'C3';
      const updateChord = () => {
        const answer = [...authorPiano.querySelectorAll('.selected')].map(key => key.dataset.note);
        row.querySelector('.chord-answer').value = JSON.stringify(answer);
        row.querySelector('.chord-answer-summary').textContent = answer.length ? answer.join(' · ') : 'Nenhuma nota escolhida';
      };
      extra.querySelector('.piano-region').addEventListener('change', event => {
        authorPiano.innerHTML = pianoMarkup(event.target.value);
        updateChord();
      });
      authorPiano.addEventListener('click', event => {
        const key = event.target.closest('.piano-key');
        if (!key) return;
        key.classList.toggle('selected');
        updateChord();
        playNote(key.dataset.note);
      });
      extra.querySelector('.play-author-chord').addEventListener('click', () => playChord(JSON.parse(row.querySelector('.chord-answer').value || '[]')));
      extra.querySelector('.clear-author-chord').addEventListener('click', () => {
        authorPiano.querySelectorAll('.selected').forEach(key => key.classList.remove('selected'));
        updateChord();
      });
    } else if (type === 'score') {
      extra.innerHTML = `<div class="field score-upload-field"><label>Arquivo de partitura MusicXML</label><input class="score-file" type="file" accept=".xml,.musicxml,application/xml,text/xml"><small class="muted">Os compassos e pautas serão lidos localmente. Limite de 700 KB.</small></div><div class="score-meta" hidden></div><div class="score-render" aria-label="Prévia da partitura"></div><p class="muted score-instruction" hidden>Marque os compassos em que o aluno deverá identificar e escrever o acorde.</p><div class="score-measures"></div><button class="button secondary play-score" type="button" disabled>▶ Ouvir partitura</button>`;
      extra.querySelector('.score-file').addEventListener('change', event => loadMusicXml(event, row));
      extra.querySelector('.play-score').addEventListener('click', () => playMusicXml(row.dataset.musicXml || ''));
    } else {
      extra.innerHTML = `<div class="field wide-field"><label>Resposta esperada (opcional)</label><input class="written-answer" maxlength="180" placeholder="Em branco: revisar manualmente"></div>`;
    }
  }

  async function loadMusicXml(event, row) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 700_000) { showToast('O arquivo MusicXML deve ter até 700 KB.'); event.target.value = ''; return; }
    try {
      const xml = await file.text();
      const score = musicXmlData(xml);
      await renderMusicXml(xml, row.querySelector('.score-render'));
      row._musicXml = xml;
      row.dataset.musicXml = xml;
      row.dataset.staffCount = String(score.staffCount);
      const measures = row.querySelector('.score-measures');
      measures.innerHTML = [...new Set(score.measureNumbers)].map(number => `<label class="score-measure-row" data-measure="${escapeHtml(number)}"><input type="checkbox" checked><span>Compasso ${escapeHtml(number)}</span><input class="score-measure-answer" type="text" maxlength="80" placeholder="Acorde esperado (opcional)"></label>`).join('');
      const meta = row.querySelector('.score-meta');
      meta.textContent = `${score.measureNumbers.length} compassos · ${score.staffCount === 1 ? 'uma pauta' : 'duas pautas'}`;
      meta.hidden = false;
      row.querySelector('.score-instruction').hidden = false;
      row.querySelector('.play-score').disabled = false;
      updateQuizSummary();
    } catch (error) {
      row._musicXml = '';
      row.querySelector('.score-render').innerHTML = '';
      showToast(error.message);
    }
  }

  function bindScoreRenders(container, questions) {
    container.querySelectorAll('.score-student-render').forEach(async render => {
      const index = Number(render.closest('.quiz-question').dataset.index);
      const question = questions[index];
      if (!question?.musicXml) return;
      try { await renderMusicXml(question.musicXml, render); }
      catch (error) { render.textContent = error.message; }
    });
  }

  function updateChoiceAnswerOptions(extra) {
    const select = extra.querySelector('.correct-option');
    const oldValue = Number(select.value) || 0;
    const count = extra.querySelectorAll('.choice-option').length;
    select.innerHTML = Array.from({ length: count }, (_, index) => `<option value="${index}">Alternativa ${index + 1}</option>`).join('');
    select.value = String(Math.min(oldValue, count - 1));
  }

  function collectMaterials() {
    return [...document.querySelectorAll('#material-editor .material-editor')].map(row => ({
      type: row.querySelector('.material-type').value,
      name: row.querySelector('.material-name').value.trim(),
      url: row.querySelector('.material-url').value.trim()
    })).filter(item => item.url);
  }

  function collectQuestions() {
    return [...document.querySelectorAll('#question-editor .question-editor')].map(row => {
      const type = row.querySelector('.question-type').value;
      const item = {
        type, prompt: row.querySelector('.question-prompt').value.trim(),
        points: Math.max(1, Number(row.querySelector('.question-points').value) || 1),
        explanation: row.querySelector('.question-explanation').value.trim()
      };
      if (type === 'choice') {
        item.options = [...row.querySelectorAll('.choice-option')].map(input => input.value.trim()).filter(Boolean);
        item.answer = Number(row.querySelector('.correct-option').value);
      } else if (type === 'boolean') {
        item.type = 'choice';
        item.options = ['Verdadeiro', 'Falso'];
        item.answer = Number(row.querySelector('.boolean-answer').value);
      } else if (type === 'degree') {
        item.region = row.querySelector('.piano-region').value;
        item.answer = row.querySelector('.target-note').value;
        item.playOnOpen = row.querySelector('.play-on-open').checked;
      } else if (type === 'chord') {
        item.region = row.querySelector('.piano-region').value;
        item.answer = JSON.parse(row.querySelector('.chord-answer').value || '[]');
        item.playOnOpen = row.querySelector('.play-on-open').checked;
      } else if (type === 'score') {
        item.musicXml = row.dataset.musicXml || '';
        item.staffCount = Number(row.dataset.staffCount) || 1;
        item.scoreMeasures = [...row.querySelectorAll('.score-measure-row input[type="checkbox"]:checked')].map(input => {
          const measureRow = input.closest('.score-measure-row');
          return { number: measureRow.dataset.measure, answer: measureRow.querySelector('.score-measure-answer').value.trim() };
        });
      } else {
        item.answer = row.querySelector('.written-answer').value.trim();
      }
      return item;
    }).filter(question => question.prompt);
  }

  async function createLesson(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const blockId = form.get('blockId');
    const payload = {
      title: form.get('title'), description: form.get('description'), materials: collectMaterials(),
      questions: collectQuestions(), published: document.querySelector('#lesson-published').checked
    };
    try {
      await api(`/api/blocks/${encodeURIComponent(blockId)}/lessons`, { method: 'POST', body: JSON.stringify(payload) });
      document.querySelector('#lesson-dialog').close();
      formElement.reset();
      await openBlock(blockId);
      showToast('Aula salva no bloco.');
    } catch (error) { showToast(error.message); }
  }

  function openInviteDialog() {
    const select = document.querySelector('#invite-block');
    select.innerHTML = '<option value="">Todos os blocos</option>' + blocks.map(block => `<option value="${escapeHtml(block.id)}">${escapeHtml(block.title)}</option>`).join('');
    document.querySelector('#created-invite').hidden = true;
    document.querySelector('#invite-dialog').showModal();
  }

  async function createInvite(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    if (!payload.blockId) delete payload.blockId;
    try {
      const result = await api('/api/invites', { method: 'POST', body: JSON.stringify(payload) });
      const container = document.querySelector('#created-invite');
      container.innerHTML = `<strong>Link individual pronto</strong><br><span class="invite-url">${escapeHtml(result.url)}</span><button type="button" class="button secondary" id="copy-new-invite">Copiar link</button><small>O link pode ser usado uma vez. Envie-o ao aluno pela sua forma habitual de contato.</small>`;
      container.hidden = false;
      container.querySelector('#copy-new-invite').addEventListener('click', async () => {
        await navigator.clipboard.writeText(result.url);
        showToast('Link copiado.');
      });
      await loadDashboard();
    } catch (error) { showAuthMessage(error.message); }
  }

  async function copyInvite(url) {
    try { await navigator.clipboard.writeText(url); showToast('Link copiado.'); }
    catch { showToast(url); }
  }

  function midiForNote(note) {
    const match = /^([A-G]#?)(\d)$/.exec(String(note || ''));
    return match ? (Number(match[2]) + 1) * 12 + noteNames.indexOf(match[1]) : -1;
  }

  function playNote(note, duration = .65) {
    const midi = midiForNote(note);
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (midi < 0 || !Audio) return;
    const context = new Audio();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.16, context.currentTime + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + .03);
    oscillator.onended = () => context.close();
  }

  function playChord(notes, duration = 1.05) {
    const midiNotes = [...new Set((notes || []).map(midiForNote).filter(midi => midi >= 0))];
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!midiNotes.length || !Audio) return;
    const context = new Audio();
    const now = context.currentTime;
    midiNotes.forEach((midi, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.11, now + .025);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + index * .008);
      oscillator.stop(now + duration + .03);
      oscillator.onended = () => { if (index === midiNotes.length - 1) context.close(); };
    });
  }

  function musicXmlData(xml) {
    const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
    if (documentXml.querySelector('parsererror') || !documentXml.querySelector('score-partwise, score-timewise')) throw new Error('O arquivo não parece ser um MusicXML válido.');
    const measures = [...documentXml.getElementsByTagNameNS('*', 'measure')];
    if (!measures.length) throw new Error('Não encontrei compassos nesse MusicXML.');
    const staffCounts = [...documentXml.getElementsByTagNameNS('*', 'staves')].map(element => Number(element.textContent) || 1);
    const explicitStaves = [...documentXml.getElementsByTagNameNS('*', 'staff')].map(element => Number(element.textContent) || 1);
    const staffCount = Math.max(1, ...staffCounts, ...explicitStaves);
    const measureNumbers = measures.map((measure, index) => measure.getAttribute('number') || String(index + 1));
    return { staffCount: Math.min(2, staffCount), measureNumbers };
  }

  function musicXmlEvents(xml) {
    const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
    const tempoValue = Number(documentXml.querySelector('sound[tempo]')?.getAttribute('tempo')) || 90;
    const quarterSeconds = 60 / tempoValue;
    const events = [];
    for (const part of [...documentXml.getElementsByTagNameNS('*', 'part')]) {
      let absoluteQuarter = 0;
      let divisions = 1;
      for (const measure of [...part.getElementsByTagNameNS('*', 'measure')]) {
        const newDivisions = Number(measure.querySelector('attributes divisions')?.textContent);
        if (newDivisions > 0) divisions = newDivisions;
        let cursor = 0;
        let previousOnset = 0;
        for (const element of [...measure.children]) {
          if (element.localName === 'backup' || element.localName === 'forward') {
            const duration = Number(element.querySelector('duration')?.textContent) || 0;
            cursor = element.localName === 'backup' ? Math.max(0, cursor - duration) : cursor + duration;
            continue;
          }
          if (element.localName !== 'note') continue;
          const duration = Number(element.querySelector('duration')?.textContent) || 0;
          const isChordTone = Boolean(element.querySelector('chord'));
          const onset = isChordTone ? previousOnset : cursor;
          if (!isChordTone) previousOnset = onset;
          if (!element.querySelector('rest')) {
            const pitch = element.querySelector('pitch');
            if (pitch) {
              const step = pitch.querySelector('step')?.textContent;
              const octave = Number(pitch.querySelector('octave')?.textContent);
              const alter = Number(pitch.querySelector('alter')?.textContent) || 0;
              const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step];
              if (semitone !== undefined) events.push({ midi: (octave + 1) * 12 + semitone + alter, start: (absoluteQuarter + onset / divisions) * quarterSeconds, duration: Math.max(.12, duration / divisions * quarterSeconds * .92) });
            }
          }
          if (!isChordTone) cursor += duration;
        }
        absoluteQuarter += cursor / divisions;
      }
    }
    return events.sort((left, right) => left.start - right.start);
  }

  async function renderMusicXml(xml, target) {
    const Renderer = window.opensheetmusicdisplay?.OpenSheetMusicDisplay;
    if (!Renderer) throw new Error('O renderizador MusicXML local não carregou. Reinicie o servidor e atualize a página.');
    target.innerHTML = '';
    const renderer = new Renderer(target, {
      autoResize: true, backend: 'svg', drawTitle: false, drawPartNames: false,
      drawMeasureNumbers: true, drawingParameters: 'compacttight'
    });
    await renderer.load(xml);
    renderer.render();
    return renderer;
  }

  async function playMusicXml(xml) {
    try {
      const events = musicXmlEvents(xml);
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio || !events.length) throw new Error('Não encontrei notas tocáveis na partitura.');
      const context = new Audio();
      const start = context.currentTime + .08;
      for (const event of events) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.value = 440 * 2 ** ((event.midi - 69) / 12);
        gain.gain.setValueAtTime(.0001, start + event.start);
        gain.gain.exponentialRampToValueAtTime(.065, start + event.start + .018);
        gain.gain.exponentialRampToValueAtTime(.0001, start + event.start + event.duration);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start + event.start);
        oscillator.stop(start + event.start + event.duration + .02);
      }
      setTimeout(() => context.close(), Math.max(1000, (events.at(-1).start + events.at(-1).duration + .5) * 1000));
    } catch (error) { showToast(error.message); }
  }

  function pianoMarkup(region) {
    const octave = Number(region.slice(1));
    let keys = '';
    for (let offset = 0; offset < 24; offset += 1) {
      const pitch = offset % 12;
      const note = `${noteNames[pitch]}${octave + Math.floor(offset / 12)}`;
      if ([1, 3, 6, 8, 10].includes(pitch)) {
        const blackIndex = [1, 3, 6, 8, 10].indexOf(pitch);
        const whitePosition = Math.floor(offset / 12) * 7 + [1, 2, 4, 5, 6][blackIndex];
        keys += `<button class="piano-key black" style="left:${whitePosition / 14 * 100 - 2.05}%" type="button" data-note="${note}" aria-label="${note}"></button>`;
      } else keys += `<button class="piano-key white" type="button" data-note="${note}" aria-label="${note}"><span>${note}</span></button>`;
    }
    return keys;
  }

  function bindQuizInteractions(content, questions = []) {
    content.querySelectorAll('.piano').forEach(piano => piano.addEventListener('click', event => {
      const key = event.target.closest('.piano-key');
      if (!key) return;
      const question = piano.closest('.quiz-question');
      if (piano.dataset.answerMode === 'chord') {
        key.classList.toggle('selected');
        const selected = [...piano.querySelectorAll('.piano-key.selected')].map(item => item.dataset.note);
        question.dataset.response = JSON.stringify(selected);
        question.querySelector('.piano-response').textContent = selected.length ? `Notas: ${selected.join(' · ')}` : 'Toque todas as notas do acorde.';
      } else {
        piano.querySelectorAll('.piano-key').forEach(item => item.classList.remove('selected'));
        key.classList.add('selected');
        question.dataset.response = key.dataset.note;
        question.querySelector('.piano-response').textContent = `Resposta: ${key.dataset.note}`;
      }
      playNote(key.dataset.note);
    }));
    content.querySelectorAll('.play-target').forEach(button => button.addEventListener('click', () => playNote(button.dataset.note)));
    content.querySelectorAll('.play-chord-answer').forEach(button => button.addEventListener('click', () => {
      const question = button.closest('.quiz-question');
      try { playChord(JSON.parse(question.dataset.response || '[]')); }
      catch { showToast('Toque as notas do acorde antes de ouvir.'); }
    }));
    content.querySelectorAll('.play-target-chord').forEach(button => {
      const chord = JSON.parse(button.dataset.chord || '[]');
      button.addEventListener('click', () => playChord(chord));
      if (button.dataset.autoplay === 'true') playChord(chord);
    });
    content.querySelectorAll('.play-score').forEach(button => button.addEventListener('click', () => {
      const question = questions[Number(button.dataset.questionIndex)];
      if (question?.musicXml) playMusicXml(question.musicXml);
    }));
    content.querySelectorAll('.play-target[data-autoplay="true"]').forEach(button => playNote(button.dataset.note));
  }

  function chordAnswerMatches(expected, submitted) {
    const pitchClasses = notes => [...new Set((notes || []).map(midiForNote).filter(midi => midi >= 0).map(midi => midi % 12))].sort((a, b) => a - b);
    return JSON.stringify(pitchClasses(expected)) === JSON.stringify(pitchClasses(submitted));
  }

  function normalizeLocalText(value) {
    return String(value || '').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
  }

  function bindScoreRenders(container, questions) {
    container.querySelectorAll('.score-student-render').forEach(async render => {
      const index = Number(render.closest('.quiz-question').dataset.index);
      const question = questions[index];
      if (!question?.musicXml) return;
      try { await renderMusicXml(question.musicXml, render); }
      catch (error) { render.textContent = error.message; }
    });
  }

  function previewQuiz() {
    const questions = collectQuestions();
    if (!questions.length) { showToast('Adicione ao menos uma pergunta para pré-visualizar.'); return; }
    const title = document.querySelector('#lesson-title').value.trim() || 'Prévia do quiz';
    const content = document.querySelector('#quiz-preview-content');
    content.innerHTML = `<button type="button" class="modal-close" data-close-dialog>×</button><p class="eyebrow">PRÉVIA DO ALUNO</p><h2>${escapeHtml(title)}</h2><p class="modal-intro">Responda como aluno para testar a atividade antes de publicar.</p><form id="quiz-preview-form">${questions.map((question, index) => quizMarkup(question, index, true)).join('')}<button class="button primary" type="submit">Conferir prévia</button><div id="preview-result" class="result-banner" hidden></div></form>`;
    content.querySelector('[data-close-dialog]').addEventListener('click', () => document.querySelector('#quiz-preview-dialog').close());
    bindQuizInteractions(content, questions);
    bindScoreRenders(content, questions);
    content.querySelector('#quiz-preview-form').addEventListener('submit', event => {
      event.preventDefault();
      const answers = questions.map((question, index) => {
        if (question.type === 'choice') return event.currentTarget.querySelector(`input[name="answer-${index}"]:checked`)?.value;
        if (question.type === 'degree') return content.querySelectorAll('.quiz-question')[index].dataset.response;
        if (question.type === 'chord') {
          try { return JSON.parse(content.querySelectorAll('.quiz-question')[index].dataset.response || '[]'); }
          catch { return []; }
        }
        if (question.type === 'score') return [...content.querySelectorAll('.quiz-question')[index].querySelectorAll('.score-answer-row')].map(row => ({ number: row.dataset.measure, answer: row.querySelector('input').value }));
        return event.currentTarget.querySelector(`[name="answer-${index}"]`)?.value;
      });
      let score = 0;
      let possible = 0;
      const feedback = questions.map((question, index) => {
        if (question.type === 'score') {
          const submitted = answers[index] || [];
          let scoreForMeasure = 0;
          let totalForMeasure = 0;
          const measures = question.scoreMeasures.map(measure => {
            if (!measure.answer) return `<p>Compasso ${escapeHtml(measure.number)} preparado para revisão manual.</p>`;
            const correct = submitted.find(item => String(item.number) === String(measure.number))?.answer || '';
            totalForMeasure += Number(question.points) || 1;
            if (normalizeLocalText(correct) === normalizeLocalText(measure.answer)) scoreForMeasure += Number(question.points) || 1;
            return `<p>Compasso ${escapeHtml(measure.number)}: ${normalizeLocalText(correct) === normalizeLocalText(measure.answer) ? 'correto' : 'revisar resposta'}.</p>`;
          }).join('');
          score += scoreForMeasure;
          possible += totalForMeasure;
          return measures;
        }
        if (question.type === 'written' && !question.answer) return `<p>${index + 1}. Resposta aberta para revisão.</p>`;
        const points = Math.max(1, Number(question.points) || 1);
        possible += points;
        const isCorrect = question.type === 'choice' ? Number(answers[index]) === Number(question.answer)
          : question.type === 'degree' ? midiForNote(answers[index]) === midiForNote(question.answer)
            : question.type === 'chord' ? chordAnswerMatches(question.answer, answers[index])
            : String(answers[index] || '').trim().toLocaleLowerCase('pt-BR') === String(question.answer).trim().toLocaleLowerCase('pt-BR');
        if (isCorrect) score += points;
        return `<p>${index + 1}. ${isCorrect ? 'Correta' : 'Resposta não correta'}${question.explanation ? ` · ${escapeHtml(question.explanation)}` : ''}</p>`;
      }).join('');
      const result = content.querySelector('#preview-result');
      result.innerHTML = `<strong>${score} de ${possible} pontos</strong>${feedback}`;
      result.hidden = false;
    });
    document.querySelector('#quiz-preview-dialog').showModal();
  }

  function updateAssistantAvailability() {
    const launch = document.querySelector('#assistant-launch');
    if (launch) launch.hidden = !user || isExerciseActive();
  }

  function openLesson(blockId, lessonId, mode = 'aula') {
    const block = activeBlock?.id === blockId ? activeBlock : blocks.find(item => item.id === blockId);
    if (!block) return;
    const lesson = block.lessons?.find(item => item.id === lessonId);
    if (!lesson) return;
    const student = user.role === 'student';
    const hasExercises = Boolean(lesson.questions?.length);
    const initialTab = mode === 'exercicios' && hasExercises ? 'exercicios' : 'aula';
    const completed = completedLessonIds.has(lesson.id);
    const materialList = lesson.materials?.length ? `<div class="builder-section"><h3>Materiais</h3><div class="resource-list">${lesson.materials.map(item => `<a class="resource-link" href="${escapeHtml(item.url)}" rel="noopener noreferrer" target="_blank"><span>${item.type === 'PDF' ? 'PDF' : '↗'}</span>${escapeHtml(item.name || item.type)}</a>`).join('')}</div></div>` : '';
    const questions = lesson.questions?.length ? `<div class="builder-section"><h3>${student ? 'Atividade' : 'Quiz da aula'}</h3><form id="student-quiz">${lesson.questions.map((question, index) => quizMarkup(question, index, student)).join('')}${student ? '<button class="button primary" type="submit">Enviar respostas</button>' : ''}<div id="quiz-result" class="result-banner" hidden></div></form></div>` : '';
    const content = document.querySelector('#lesson-detail-content');
    content.innerHTML = `<button type="button" class="modal-close" data-close-dialog>×</button><p class="eyebrow">${escapeHtml(block.title)}</p><h2>${escapeHtml(lesson.title)}</h2><div class="lesson-detail-tabs" role="tablist" aria-label="Etapas da aula"><button type="button" role="tab" data-lesson-tab="aula" aria-selected="${initialTab === 'aula'}">Aula</button>${hasExercises ? `<button type="button" role="tab" data-lesson-tab="exercicios" aria-selected="${initialTab === 'exercicios'}">Exercícios${completed && student ? ' · Concluído' : ''}</button>` : ''}</div><section class="lesson-detail-panel" data-lesson-panel="aula" ${initialTab !== 'aula' ? 'hidden' : ''}><p class="modal-intro">${escapeHtml(lesson.description || 'Conteúdo e materiais desta aula.')}</p>${materialList}${hasExercises ? '<div class="lesson-step-actions"><button type="button" class="button primary" data-lesson-tab="exercicios">Ir para os exercícios →</button></div>' : ''}</section><section class="lesson-detail-panel" data-lesson-panel="exercicios" ${initialTab !== 'exercicios' ? 'hidden' : ''}><p class="exercise-status tag ${completed && student ? 'success' : 'pending'}">${completed && student ? '✓ Exercício concluído' : 'Pratique no seu ritmo'}</p>${questions || '<p class="modal-intro">Esta aula ainda não possui exercícios.</p>'}<div class="lesson-step-actions"><button type="button" class="button secondary" data-lesson-tab="aula">← Voltar à aula</button></div></section>`;
    const dialog = document.querySelector('#lesson-detail-dialog');
    dialog.dataset.activeTab = initialTab;
    content.querySelector('[data-close-dialog]').addEventListener('click', () => document.querySelector('#lesson-detail-dialog').close());
    content.querySelectorAll('[data-lesson-tab]').forEach(button => button.addEventListener('click', () => {
      const tab = button.dataset.lessonTab;
      content.querySelectorAll('[data-lesson-tab][role="tab"]').forEach(tabButton => tabButton.setAttribute('aria-selected', String(tabButton.dataset.lessonTab === tab)));
      content.querySelectorAll('[data-lesson-panel]').forEach(panel => { panel.hidden = panel.dataset.lessonPanel !== tab; });
      dialog.dataset.activeTab = tab;
      updateAssistantAvailability();
    }));
    bindQuizInteractions(content, lesson.questions || []);
    bindScoreRenders(content, lesson.questions || []);
    content.querySelector('#student-quiz')?.addEventListener('submit', event => submitQuiz(event, lesson));
    dialog.addEventListener('close', updateAssistantAvailability, { once: true });
    dialog.showModal();
    updateAssistantAvailability();
  }

  function quizMarkup(question, index, student) {
    let answer = '';
    if (question.type === 'choice') {
      answer = (question.options || []).map((option, optionIndex) => `<label class="answer-option"><input type="radio" name="answer-${index}" value="${optionIndex}"> ${escapeHtml(option)}</label>`).join('');
    } else if (question.type === 'degree') {
      const region = question.region || 'C3';
      const soundNote = question.soundNote || question.answer || '';
      answer = `<div class="piano-tools"><button type="button" class="button secondary play-target" data-note="${escapeHtml(soundNote)}" data-autoplay="${question.playOnOpen ? 'true' : 'false'}">▶ Ouvir nota indicada</button><span>Teclado: ${escapeHtml(region)} · duas oitavas · ${Number(question.points) || 1} ${Number(question.points) === 1 ? 'ponto' : 'pontos'}</span></div>${student ? `<div class="piano" aria-label="Piano de duas oitavas">${pianoMarkup(region)}</div><p class="piano-response">Toque uma tecla para responder.</p>` : '<small class="muted">Resposta musical configurada para esta questão.</small>'}`;
    } else if (question.type === 'chord') {
      const region = question.region || 'C3';
      const targetChord = question.soundChord || question.answer || [];
      answer = `${student && targetChord.length ? `<button class="button secondary play-target-chord" type="button" data-chord="${escapeHtml(JSON.stringify(targetChord))}" data-autoplay="${question.playOnOpen ? 'true' : 'false'}">▶ Ouvir acorde indicado</button>` : ''}${student ? `<div class="piano chord-response-piano" data-answer-mode="chord" aria-label="Piano para montar acorde">${pianoMarkup(region)}</div><p class="piano-response">Toque todas as notas do acorde.</p><button class="button secondary play-chord-answer" type="button">▶ Ouvir notas selecionadas</button>` : '<p class="muted">Resposta por formação de acorde.</p>'}<small class="question-points">${Number(question.points) || 1} ${Number(question.points) === 1 ? 'ponto' : 'pontos'}</small>`;
    } else if (question.type === 'score') {
      const measures = question.scoreMeasures || [];
      answer = `<div class="score-question-tools"><span>${question.staffCount === 1 ? 'Uma pauta' : 'Duas pautas'} · ${measures.length} compassos selecionados</span><button class="button secondary play-score" data-question-index="${index}" type="button">▶ Ouvir partitura</button></div><div class="score-student-render" aria-label="Partitura MusicXML"></div><div class="score-answer-list">${student ? measures.map(measure => `<label class="score-answer-row" data-measure="${escapeHtml(measure.number)}"><span>Compasso ${escapeHtml(measure.number)}</span><input type="text" placeholder="Qual é o acorde?" autocomplete="off"></label>`).join('') : measures.map(measure => `<span class="score-measure-chip">Compasso ${escapeHtml(measure.number)}</span>`).join('')}</div>`;
    } else {
      answer = `<textarea class="written-response" name="answer-${index}" rows="2" placeholder="Escreva sua resposta"></textarea>`;
    }
    return `<div class="quiz-question" data-index="${index}" data-type="${escapeHtml(question.type)}"><strong>${index + 1}. ${escapeHtml(question.prompt)}</strong>${answer}<small class="question-points">${Number(question.points) || 1} ${Number(question.points) === 1 ? 'ponto' : 'pontos'}</small></div>`;
  }

  async function submitQuiz(event, lesson) {
    event.preventDefault();
    const form = event.currentTarget;
    const answers = lesson.questions.map((question, index) => {
      if (question.type === 'choice') return form.querySelector(`input[name="answer-${index}"]:checked`)?.value ?? null;
      if (question.type === 'degree') return form.querySelectorAll('.quiz-question')[index].dataset.response || null;
      if (question.type === 'chord') {
        try { return JSON.parse(form.querySelectorAll('.quiz-question')[index].dataset.response || '[]'); }
        catch { return []; }
      }
      if (question.type === 'score') return [...form.querySelectorAll('.quiz-question')[index].querySelectorAll('.score-answer-row')].map(row => ({ number: row.dataset.measure, answer: row.querySelector('input').value }));
      return form.querySelector(`[name="answer-${index}"]`).value;
    });
    try {
      const result = await api(`/api/lessons/${encodeURIComponent(lesson.id)}/submit`, { method: 'POST', body: JSON.stringify({ answers }) });
      const output = document.querySelector('#quiz-result');
      completedLessonIds.add(lesson.id);
      const feedback = result.details.map((detail, index) => {
        if (detail.measures) return `<p><strong>${index + 1}.</strong> ${detail.measures.map(measure => `Compasso ${escapeHtml(measure.number)}: ${measure.manual ? 'para revisão' : measure.correct ? 'correto' : 'incorreto'}`).join(' · ')}</p>`;
        return `<p><strong>${index + 1}.</strong> ${detail.manual ? 'Resposta enviada para revisão.' : detail.correct ? 'Resposta correta.' : 'Resposta registrada.'}${detail.explanation ? ` ${escapeHtml(detail.explanation)}` : ''}</p>`;
      }).join('');
      output.innerHTML = `<strong>Exercício concluído · ${result.score} de ${result.possible} pontos · ${result.correct} de ${result.graded} corretas.</strong>${result.manual ? ` ${result.manual} resposta(s) aberta(s) aguardam revisão do professor.` : ''}${feedback}`;
      output.hidden = false;
    } catch (error) { showToast(error.message); }
  }

  function bindDynamicActions() {
    document.addEventListener('click', event => {
      const viewButton = event.target.closest('[data-view-link]');
      if (viewButton) setView(viewButton.dataset.viewLink);
      const emptyBlock = event.target.closest('#new-block-empty');
      if (emptyBlock) openBlockDialog();
      const emptyLesson = event.target.closest('[data-new-lesson]');
      if (emptyLesson) openLessonBuilder(activeBlock?.id);
      const copyButton = event.target.closest('[data-copy-invite]');
      if (copyButton) copyInvite(copyButton.dataset.copyInvite);
      const copyCredentials = event.target.closest('[data-copy-credentials]');
      if (copyCredentials) copyInvite(copyCredentials.dataset.copyCredentials);
    });
  }

  async function boot() {
    bindDynamicActions();
    const inviteToken = new URLSearchParams(location.search).get('token');
    try {
      const setup = await api('/api/setup');
      serverSessionEpoch = setup.sessionEpoch || '';
      if (inviteToken) { await renderJoin(inviteToken); return; }
      if (!setup.teacherExists) {
        localStorage.removeItem(tokenKey);
        localStorage.removeItem(sessionEpochKey);
        token = '';
        renderBootstrap();
        return;
      }
      if (token && localStorage.getItem(sessionEpochKey) !== serverSessionEpoch) {
        localStorage.removeItem(tokenKey);
        localStorage.removeItem(sessionEpochKey);
        token = '';
      }
      if (token) {
        try {
          const result = await api('/api/me');
          startSession({ token, user: result.user });
          return;
        } catch { localStorage.removeItem(tokenKey); localStorage.removeItem(sessionEpochKey); token = ''; }
      }
      if (!setup.teacherExists) renderBootstrap();
      else renderLogin(new URLSearchParams(location.search).has('username') ? 'student' : 'teacher');
    } catch (error) { showAuthMessage(`Servidor indisponível: ${error.message}`); }
  }

  boot();
})();
