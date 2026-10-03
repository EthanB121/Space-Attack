(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const ui = {
    score: document.getElementById('score'), best: document.getElementById('best'),
    wave: document.getElementById('wave'), lives: document.getElementById('lives'),
    overlay: document.getElementById('overlay'), eyebrow: document.getElementById('screen-eyebrow'),
    title: document.getElementById('screen-title'), copy: document.getElementById('screen-copy'),
    start: document.getElementById('start-button'), hint: document.getElementById('screen-hint'),
    stats: document.getElementById('run-stats'), finalScore: document.getElementById('final-score'),
    finalWave: document.getElementById('final-wave'), pause: document.getElementById('pause-button'),
    announcement: document.getElementById('announcement')
  };

  // All gameplay uses these logical coordinates, independent of display size.
  const W = 960, H = 600;
  const MAX_LIVES = 3;
  const keys = new Set();
  const touchKeys = new Map();
  const controlledKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'Enter', 'KeyP', 'Escape']);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const colors = ['#aa8cff', '#ffb77b', '#f480be'];
  const stars = Array.from({ length: 125 }, () => ({
    x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.3 + .3,
    speed: Math.random() * 22 + 7, phase: Math.random() * Math.PI * 2
  }));
  let mode = 'menu';
  let score = 0, wave = 1, lives = MAX_LIVES, best = 0;
  let enemies = [], shots = [], enemyShots = [], particles = [];
  let fleet = { direction: 1, speed: 35, fireTimer: 1.2 };
  let player = { x: W / 2, y: H - 63, cooldown: 0, invulnerable: 0 };
  let waveDelay = 0, banner = '', bannerTimer = 0, shake = 0, flash = 0;
  let elapsed = 0, lastTime = 0;

  try {
    const savedBest = Number(localStorage.getItem('last-signal-best'));
    if (Number.isSafeInteger(savedBest) && savedBest >= 0) best = savedBest;
  } catch (_) { /* Storage is optional on static/file hosting. */ }

  function updateHUD() {
    ui.score.textContent = String(score).padStart(6, '0');
    ui.best.textContent = String(Math.max(best, score)).padStart(6, '0');
    ui.wave.textContent = String(wave).padStart(2, '0');
    ui.lives.setAttribute('aria-label', `${lives} ${lives === 1 ? 'life' : 'lives'}`);
    [...ui.lives.children].forEach((pip, i) => pip.classList.toggle('lost', i >= lives));
  }

  function announce(message) { ui.announcement.textContent = message; }

  function resetInput() {
    keys.clear();
    touchKeys.clear();
    document.querySelectorAll('[data-control]').forEach(button => button.classList.remove('active'));
  }

  function startGame() {
    if (mode !== 'menu' && mode !== 'gameover') return;
    resetInput();
    score = 0; wave = 1; lives = MAX_LIVES;
    shots = []; enemyShots = []; particles = [];
    player = { x: W / 2, y: H - 63, cooldown: 0, invulnerable: 1.2 };
    waveDelay = 0; shake = 0; flash = 0; lastTime = 0;
    mode = 'playing';
    ui.overlay.hidden = true;
    ui.pause.disabled = false;
    ui.pause.setAttribute('aria-label', 'Pause game');
    spawnWave();
    updateHUD();
    canvas.focus({ preventScroll: true });
  }

  function spawnWave() {
    const columns = Math.min(9, 7 + Math.floor((wave - 1) / 3));
    const rows = Math.min(5, 3 + Math.floor((wave - 1) / 2));
    const spacing = 69;
    const left = (W - (columns - 1) * spacing) / 2;
    enemies = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const armor = row === 0 && wave >= 3;
        enemies.push({ x: left + col * spacing, y: 78 + row * 53, row, col,
          type: row % 3, hp: armor ? 2 : 1, armor, phase: Math.random() * Math.PI * 2 });
      }
    }
    fleet = { direction: wave % 2 ? 1 : -1, speed: 31 + Math.min(wave * 7, 100), fireTimer: 1.3 };
    shots = []; enemyShots = [];
    banner = `WAVE ${String(wave).padStart(2, '0')}`;
    bannerTimer = 1.7;
    announce(`Wave ${wave}. ${lives} lives remaining.`);
    updateHUD();
  }

  function pauseGame() {
    if (mode !== 'playing') return;
    mode = 'paused';
    resetInput();
    ui.eyebrow.textContent = 'TRANSMISSION ON HOLD';
    ui.title.textContent = 'FLIGHT PAUSED.';
    ui.copy.textContent = 'Take a breath. The galaxy can wait.';
    ui.stats.hidden = true;
    ui.start.textContent = 'RESUME FLIGHT →';
    ui.hint.textContent = 'OR PRESS P / ESC / ENTER';
    ui.overlay.hidden = false;
    ui.overlay.scrollTop = 0;
    ui.pause.setAttribute('aria-label', 'Resume game');
    announce('Game paused.');
  }

  function resumeGame() {
    if (mode !== 'paused') return;
    resetInput();
    lastTime = 0;
    mode = 'playing';
    ui.overlay.hidden = true;
    ui.pause.setAttribute('aria-label', 'Pause game');
    canvas.focus({ preventScroll: true });
    announce('Game resumed.');
  }

  function endGame(reason) {
    if (mode !== 'playing') return;
    mode = 'gameover';
    resetInput();
    const newBest = score > best;
    if (newBest) {
      best = score;
      try { localStorage.setItem('last-signal-best', String(best)); } catch (_) { /* A run never depends on storage. */ }
    }
    ui.eyebrow.textContent = newBest ? 'NEW PERSONAL BEST' : 'TRANSMISSION LOST';
    ui.title.textContent = 'GAME OVER.';
    ui.copy.textContent = reason;
    ui.finalScore.textContent = score.toLocaleString();
    ui.finalWave.textContent = String(wave).padStart(2, '0');
    ui.stats.hidden = false;
    ui.start.textContent = 'TRY AGAIN →';
    ui.hint.textContent = 'OR PRESS ENTER / SPACE';
    ui.overlay.hidden = false;
    ui.overlay.scrollTop = 0;
    ui.pause.disabled = true;
    updateHUD();
    announce(`Game over. Score ${score}. Wave ${wave}.`);
  }

  function burst(x, y, color, count = 18) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * 150;
      const life = .25 + Math.random() * .4;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, r: 1 + Math.random() * 2, color });
    }
  }

  function damagePlayer() {
    if (mode !== 'playing' || player.invulnerable > 0) return;
    lives--;
    burst(player.x, player.y, '#7bf3ec', 35);
    shake = reducedMotion ? 0 : .28;
    flash = .18;
    enemyShots = [];
    updateHUD();
    if (lives <= 0) {
      endGame('Your ship went silent. Launch again and push further.');
    } else {
      player.x = W / 2;
      player.y = H - 63;
      player.invulnerable = 1.8;
      announce(`${lives} ${lives === 1 ? 'life' : 'lives'} remaining.`);
    }
  }

  function isDown(...codes) { return codes.some(code => keys.has(code) || [...touchKeys.values()].includes(code)); }

  // Clip a relative motion segment against a centered hitbox. Infinity means no hit.
  // Tracking both objects prevents tunneling and hits at mismatched points in time.
  function hitTime(x0, y0, x1, y1, halfWidth, halfHeight) {
    let entry = 0, exit = 1;
    for (const [start, end, extent] of [[x0, x1, halfWidth], [y0, y1, halfHeight]]) {
      const delta = end - start;
      if (delta === 0) {
        if (Math.abs(start) > extent) return Infinity;
      } else {
        const a = (-extent - start) / delta;
        const b = (extent - start) / delta;
        entry = Math.max(entry, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
        if (entry > exit) return Infinity;
      }
    }
    return entry;
  }

  function update(dt) {
    if (mode === 'paused') return;
    elapsed += dt;
    stars.forEach(star => { star.y = (star.y + star.speed * dt) % H; });
    particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
    particles = particles.filter(p => p.life > 0);
    shake = Math.max(0, shake - dt);
    flash = Math.max(0, flash - dt);
    bannerTimer = Math.max(0, bannerTimer - dt);
    if (mode !== 'playing') return;

    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.cooldown = Math.max(0, player.cooldown - dt);
    const previousPlayerX = player.x, previousPlayerY = player.y;
    let dx = Number(isDown('KeyD', 'ArrowRight')) - Number(isDown('KeyA', 'ArrowLeft'));
    let dy = Number(isDown('KeyS', 'ArrowDown')) - Number(isDown('KeyW', 'ArrowUp'));
    const length = Math.hypot(dx, dy) || 1;
    player.x = Math.max(24, Math.min(W - 24, player.x + dx / length * 345 * dt));
    player.y = Math.max(H * .55, Math.min(H - 30, player.y + dy / length * 345 * dt));
    if (waveDelay > 0) {
      waveDelay -= dt;
      if (waveDelay <= 0) { wave++; spawnWave(); }
      return;
    }

    if (isDown('Space') && player.cooldown <= 0) {
      shots.push({ x: player.x, y: player.y - 21 });
      player.cooldown = .16;
      burst(player.x, player.y - 22, '#7bf3ec', 3);
    }

    enemies.forEach(enemy => { enemy.previousX = enemy.x; enemy.previousY = enemy.y; });

    // Surviving invaders speed up as their formation gets smaller.
    const initialCount = Math.min(9, 7 + Math.floor((wave - 1) / 3)) * Math.min(5, 3 + Math.floor((wave - 1) / 2));
    const speed = fleet.speed * (1 + (1 - enemies.length / initialCount) * .8);
    if (enemies.length) {
      const edge = fleet.direction > 0 ? Math.max(...enemies.map(e => e.x)) : Math.min(...enemies.map(e => e.x));
      const move = fleet.direction * speed * dt;
      if (edge + move > W - 38 || edge + move < 38) {
        fleet.direction *= -1;
        enemies.forEach(enemy => { enemy.y += 17 + Math.min(wave, 8); });
      } else {
        enemies.forEach(enemy => { enemy.x += move; });
      }
    }

    fleet.fireTimer -= dt;
    if (fleet.fireTimer <= 0 && enemies.length) {
      // Only the lowest surviving invader in each column fires.
      const front = new Map();
      enemies.forEach(enemy => {
        if (!front.has(enemy.col) || front.get(enemy.col).y < enemy.y) front.set(enemy.col, enemy);
      });
      const shooters = [...front.values()];
      const count = Math.min(3, 1 + Math.floor((wave - 1) / 4));
      for (let i = 0; i < count && shooters.length; i++) {
        const enemy = shooters.splice(Math.floor(Math.random() * shooters.length), 1)[0];
        enemyShots.push({ x: enemy.x, y: enemy.y + 18,
          vx: Math.max(-65, Math.min(65, (player.x - enemy.x) * .13)), vy: 215 + Math.min(wave * 15, 180) });
      }
      fleet.fireTimer = Math.max(.3, 1.25 - wave * .085) * (.8 + Math.random() * .4);
    }

    shots.forEach(shot => { shot.previousY = shot.y; shot.y -= 650 * dt; });
    enemyShots.forEach(shot => {
      shot.previousX = shot.x; shot.previousY = shot.y;
      shot.x += shot.vx * dt; shot.y += shot.vy * dt;
    });

    // Each shot hits only the first invader along its path, regardless of array order.
    for (const shot of shots) {
      let targetIndex = -1, firstHit = Infinity;
      for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const time = hitTime(shot.x - enemy.previousX, shot.previousY - enemy.previousY,
          shot.x - enemy.x, shot.y - enemy.y, 24, 25);
        if (time < firstHit) { firstHit = time; targetIndex = i; }
      }
      if (targetIndex !== -1) {
        const enemy = enemies[targetIndex];
        shot.dead = true;
        enemy.hp--;
        burst(shot.x, enemy.y + 10, colors[enemy.type], 7);
        if (enemy.hp <= 0) {
          burst(enemy.x, enemy.y, colors[enemy.type]);
          enemies.splice(targetIndex, 1);
          score += (3 - enemy.type) * 10 + (enemy.armor ? 10 : 0);
          updateHUD();
        }
      }
    }
    shots = shots.filter(shot => !shot.dead && shot.y > -20);

    for (const shot of enemyShots) {
      if (hitTime(shot.previousX - previousPlayerX, shot.previousY - previousPlayerY,
        shot.x - player.x, shot.y - player.y, 15, 23) !== Infinity) {
        shot.dead = true;
        if (player.invulnerable <= 0) { damagePlayer(); break; }
      }
    }
    enemyShots = enemyShots.filter(shot => !shot.dead && shot.y < H + 20);
    if (mode !== 'playing') return;

    // A fleet breach ends the run even if the player is touching that invader.
    if (enemies.some(enemy => enemy.y + 17 >= H - 28)) {
      endGame('The fleet breached your orbit. Take back the stars.');
      return;
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      if (player.invulnerable <= 0 && hitTime(enemy.previousX - previousPlayerX, enemy.previousY - previousPlayerY,
        enemy.x - player.x, enemy.y - player.y, 32, 29) !== Infinity) {
        burst(enemy.x, enemy.y, colors[enemy.type]);
        enemies.splice(i, 1);
        damagePlayer();
        if (mode !== 'playing') return;
      }
    }

    if (enemies.length === 0) {
      score += wave * 100;
      waveDelay = 2;
      shots = []; enemyShots = [];
      banner = 'ORBIT SECURED';
      bannerTimer = 1.9;
      announce(`Wave ${wave} cleared. ${wave * 100} bonus points.`);
      updateHUD();
    }
  }

  function path(points, fill, stroke) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.3; ctx.stroke(); }
  }

  function drawPlayer(x, y, invulnerable = 0) {
    if (invulnerable > 0 && Math.floor(elapsed * 12) % 2 === 0) return;
    ctx.save(); ctx.translate(x, y);
    ctx.shadowColor = '#7bf3ec'; ctx.shadowBlur = 16;
    const flame = 13 + Math.sin(elapsed * 33) * 5;
    path([[-6, 12], [0, 14 + flame], [6, 12]], '#7bf3ec88');
    path([[-3, 12], [0, 18 + flame * .45], [3, 12]], '#efffff');
    path([[0, -24], [9, -2], [22, 14], [8, 10], [0, 15], [-8, 10], [-22, 14], [-9, -2]], '#162e43', '#7bf3ec');
    ctx.shadowBlur = 0;
    path([[0, -17], [5, -2], [0, 2], [-5, -2]], '#b4fffa');
    path([[-9, 1], [-16, 11], [-8, 7]], '#588aab');
    path([[9, 1], [16, 11], [8, 7]], '#588aab');
    ctx.fillStyle = '#ffc580'; ctx.fillRect(-15, 10, 3, 3); ctx.fillRect(12, 10, 3, 3);
    if (invulnerable > 0) {
      ctx.strokeStyle = '#7bf3ec44'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 31, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawEnemy(enemy) {
    const color = colors[enemy.type];
    const bob = Math.sin(elapsed * 3 + enemy.phase) * 2;
    ctx.save(); ctx.translate(enemy.x, enemy.y + bob);
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    if (enemy.type === 0) {
      path([[-19, -5], [-11, -12], [-6, -8], [6, -8], [11, -12], [19, -5], [16, 9], [7, 12], [0, 7], [-7, 12], [-16, 9]], '#2f234b', color);
      path([[-16, 8], [-21, 16], [-12, 13]], color);
      path([[16, 8], [21, 16], [12, 13]], color);
      ctx.fillStyle = '#ede5ff'; ctx.fillRect(-10, -1, 5, 4); ctx.fillRect(5, -1, 5, 4);
    } else if (enemy.type === 1) {
      ctx.fillStyle = '#453045'; ctx.strokeStyle = color; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.ellipse(0, -3, 11, 10, 0, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke();
      path([[-22, 1], [-12, -3], [12, -3], [22, 1], [15, 9], [-15, 9]], '#3c2a38', color);
      ctx.fillStyle = '#ffdeae'; [-11, -2, 7].forEach(x => ctx.fillRect(x, 2, 4, 3));
      path([[-7, 11], [0, 15 + Math.sin(elapsed * 5 + enemy.phase) * 2], [7, 11]], '#ffb77b55');
    } else {
      path([[0, -14], [17, -4], [20, 8], [10, 5], [6, 13], [0, 7], [-6, 13], [-10, 5], [-20, 8], [-17, -4]], '#442442', color);
      path([[-12, -1], [-3, 1], [-6, 5]], '#ffd2ef');
      path([[12, -1], [3, 1], [6, 5]], '#ffd2ef');
    }
    if (enemy.hp > 1) {
      ctx.strokeStyle = '#d6c6ff66'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawBackground() {
    ctx.fillStyle = '#090d1d'; ctx.fillRect(0, 0, W, H);
    const nebula = ctx.createRadialGradient(W * .65, H * .25, 0, W * .65, H * .25, W * .65);
    nebula.addColorStop(0, '#241e403f'); nebula.addColorStop(1, '#090d1d00');
    ctx.fillStyle = nebula; ctx.fillRect(0, 0, W, H);
    stars.forEach(star => {
      ctx.globalAlpha = .35 + (Math.sin(elapsed * 1.5 + star.phase) + 1) * .25;
      ctx.fillStyle = star.r > 1.25 ? '#b6b5ee' : '#7584ac';
      ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2); ctx.fill();
      if (star.r > 1.45) { ctx.fillRect(star.x - 3, star.y - .35, 6, .7); ctx.fillRect(star.x - .35, star.y - 3, .7, 6); }
    });
    ctx.globalAlpha = 1;
    const floor = ctx.createLinearGradient(0, H - 110, 0, H);
    floor.addColorStop(0, '#7bf3ec00'); floor.addColorStop(1, '#7bf3ec07');
    ctx.fillStyle = floor; ctx.fillRect(0, H - 110, W, 110);
    ctx.strokeStyle = '#7bf3ec0b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H - 28); ctx.lineTo(W, H - 28); ctx.stroke();
  }

  function render() {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - .5) * shake * 28, (Math.random() - .5) * shake * 28);
    drawBackground();
    if (mode === 'menu') {
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 9; col++) drawEnemy({ x: 150 + col * 82, y: 75 + row * 48, type: row, hp: 1, phase: col * .8 });
      }
      drawPlayer(W / 2, H - 70);
    } else {
      enemies.forEach(drawEnemy);
      ctx.save();
      ctx.shadowBlur = 12; ctx.shadowColor = '#7bf3ec';
      shots.forEach(shot => {
        ctx.fillStyle = '#7bf3ec'; ctx.fillRect(shot.x - 2, shot.y - 10, 4, 17);
        ctx.fillStyle = '#e5fffc'; ctx.fillRect(shot.x - 1, shot.y - 10, 2, 10);
      });
      ctx.shadowColor = '#ff8fa0';
      enemyShots.forEach(shot => {
        path([[shot.x, shot.y - 7], [shot.x + 4, shot.y], [shot.x, shot.y + 7], [shot.x - 4, shot.y]], '#ff8fa0');
      });
      ctx.restore();
      if (lives > 0) drawPlayer(player.x, player.y, player.invulnerable);
      if (bannerTimer > 0 && mode === 'playing') {
        ctx.save(); ctx.globalAlpha = Math.min(1, bannerTimer * 2);
        ctx.fillStyle = '#7bf3ec'; ctx.font = 'bold 18px Consolas, monospace'; ctx.textAlign = 'center';
        ctx.fillText(banner, W / 2, H * .51);
        ctx.fillStyle = '#a6aac1'; ctx.font = '10px Consolas, monospace';
        ctx.fillText(waveDelay > 0 ? `+${wave * 100} CLEAR BONUS / NEXT WAVE INBOUND` : 'ALL SYSTEMS READY', W / 2, H * .51 + 23);
        ctx.restore();
      }
    }
    particles.forEach(p => {
      ctx.globalAlpha = p.life / p.maxLife; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (flash > 0) { ctx.fillStyle = `rgba(255, 105, 140, ${flash * .65})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    render();
  }

  function frame(timestamp) {
    const dt = Math.min((timestamp - (lastTime || timestamp)) / 1000, .05);
    lastTime = timestamp;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  window.addEventListener('keydown', event => {
    if (!controlledKeys.has(event.code)) return;
    // Leave browser shortcuts and native keyboard activation of buttons intact.
    if (event.ctrlKey || event.metaKey || event.altKey || event.target?.isContentEditable ||
      event.target?.closest?.('input, textarea, select')) return;
    if (event.target?.closest?.('button') && ['Space', 'Enter'].includes(event.code)) return;
    const launch = (mode === 'menu' || mode === 'gameover') && ['Enter', 'Space'].includes(event.code);
    const resume = mode === 'paused' && ['KeyP', 'Escape', 'Enter', 'Space'].includes(event.code);
    if (mode !== 'playing' && !launch && !resume) return;
    event.preventDefault();
    if (event.repeat) return;
    if (launch) {
      startGame(); return;
    }
    if (resume) {
      resumeGame(); return;
    }
    if (mode === 'playing' && (event.code === 'KeyP' || event.code === 'Escape')) {
      pauseGame(); return;
    }
    if (mode === 'playing') keys.add(event.code);
  });
  window.addEventListener('keyup', event => { keys.delete(event.code); });
  window.addEventListener('blur', () => { resetInput(); pauseGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { resetInput(); pauseGame(); } });
  ui.start.addEventListener('click', () => mode === 'paused' ? resumeGame() : startGame());
  ui.pause.addEventListener('click', () => mode === 'paused' ? resumeGame() : pauseGame());

  document.querySelectorAll('[data-control]').forEach(button => {
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (mode !== 'playing') return;
      button.setPointerCapture(event.pointerId);
      touchKeys.set(event.pointerId, button.dataset.control);
      button.classList.add('active');
    });
    const release = event => {
      touchKeys.delete(event.pointerId);
      if (![...touchKeys.values()].includes(button.dataset.control)) button.classList.remove('active');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  });

  new ResizeObserver(resizeCanvas).observe(canvas);
  window.addEventListener('resize', resizeCanvas);
  updateHUD();
  resizeCanvas();
  requestAnimationFrame(frame);
})();
