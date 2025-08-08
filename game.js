// Pocket Plumber – a tiny Mario-like platformer for mobile web
// No external assets; simple rectangles for a clean, retro vibe.

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const COIN_EL = document.getElementById('coins');
  const LIVES_EL = document.getElementById('lives');
  const TIMER_EL = document.getElementById('timer');
  const MSG_EL = document.getElementById('msg');

  // Virtual resolution (tiles * tileSize) -> scaled to device
  const TILE = 16;
  const SCALE = 4; // logical to pixel scale before DPR
  const VIEW_W_TILES = 20;
  const VIEW_H_TILES = 12;

  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  let viewW = VIEW_W_TILES * TILE * SCALE;
  let viewH = VIEW_H_TILES * TILE * SCALE;
  canvas.width = viewW * DPR;
  canvas.height = viewH * DPR;
  canvas.style.width = viewW + "px";
  canvas.style.height = viewH + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Handle resize to keep aspect
  function resize() {
    const maxW = window.innerWidth;
    const maxH = Math.floor(window.innerHeight * 0.68); // leave room for HUD/controls
    const scale = Math.min(maxW / viewW, maxH / viewH);
    canvas.style.transformOrigin = "top left";
    canvas.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', resize);
  resize();

  // Level legend:
  // '#' solid block, '=' ground, '-' platform, 'C' coin, 'E' enemy, 'F' flag, 'S' spawn
  // 'B' bounce pad
  // Using strings for quick layout
  const LEVEL = [
    "                                                                                ",
    "                                                                                ",
    "                                                                                ",
    "              C           C            C                                       F",
    "                                                                                ",
    "        C                                  C                                    ",
    "           ####                  --                 C                            ",
    "  S                  E       ######       E       ----                           ",
    "==============================    ==============================     ============",
    "==============================    ==============================     ============",
    "==============================    ==============================     ============",
    "==============================    ==============================     ============"
  ];

  const world = {
    tileSize: TILE * SCALE,
    width: LEVEL[0].length,
    height: LEVEL.length,
    tiles: LEVEL.map(r => r.split('')),
    isSolid(x, y) {
      const t = this.get(x, y);
      return t === '#' || t === '=';
    },
    isPlatform(x, y) {
      const t = this.get(x, y);
      return t === '-' ;
    },
    get(x, y) {
      if (y < 0 || y >= this.height || x < 0 || x >= this.width) return ' ';
      return this.tiles[y][x];
    },
    set(x, y, v) {
      if (y < 0 || y >= this.height || x < 0 || x >= this.width) return;
      this.tiles[y][x] = v;
    }
  };

  function findSpawn() {
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (world.get(x, y) === 'S') return {x, y};
      }
    }
    return {x: 2, y: 2};
  }

  // Input (keyboard + touch)
  const keys = { left: false, right: false, jump: false, start: false };
  const leftBtn = document.getElementById('left');
  const rightBtn = document.getElementById('right');
  const jumpBtn = document.getElementById('jump');
  const startBtn = document.getElementById('start');

  function bindBtn(btn, key) {
    const on = (e) => { e.preventDefault(); keys[key] = true; };
    const off = (e) => { e.preventDefault(); keys[key] = false; };
    btn.addEventListener('touchstart', on, {passive:false});
    btn.addEventListener('touchend', off);
    btn.addEventListener('touchcancel', off);
    btn.addEventListener('mousedown', on);
    btn.addEventListener('mouseup', off);
    btn.addEventListener('mouseleave', off);
  }
  bindBtn(leftBtn, 'left');
  bindBtn(rightBtn, 'right');
  bindBtn(jumpBtn, 'jump');
  startBtn.addEventListener('click', () => togglePause());

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd') keys.right = true;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') keys.jump = true;
    if (e.key === 'Enter' || e.key === 'p') togglePause();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') keys.jump = false;
  });

  // Camera
  const camera = { x: 0, y: 0, w: viewW / (SCALE), h: viewH / (SCALE) };

  // Entities
  class Entity {
    constructor(x, y, w, h) {
      this.x = x; this.y = y; this.w = w; this.h = h;
      this.vx = 0; this.vy = 0;
      this.onGround = false;
      this.dead = false;
    }
    get rect() { return {x: this.x, y: this.y, w: this.w, h: this.h}; }
  }
  class Player extends Entity {
    constructor(x, y) {
      super(x, y, 12, 14);
      this.coins = 0;
      this.lives = 3;
      this.coyote = 0; // coyote time frames
      this.jumpBuffer = 0;
      this.facing = 1;
      this.invuln = 0;
    }
  }
  class Enemy extends Entity {
    constructor(x, y) {
      super(x, y, 14, 14);
      this.vx = Math.random() < 0.5 ? -0.5 : 0.5;
    }
  }

  // Build enemies + locate spawn
  const spawn = findSpawn();
  const entities = [];
  const enemies = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (world.get(x,y) === 'E') {
        enemies.push(new Enemy(x*world.tileSize, (y-1)*world.tileSize));
        world.set(x,y,' ');
      }
    }
  }
  const player = new Player(spawn.x*world.tileSize, (spawn.y-1)*world.tileSize);

  // Physics
  const GRAV = 0.35 * SCALE;
  const RUN_ACCEL = 0.2 * SCALE;
  const MAX_SPEED = 2.2 * SCALE;
  const FRICTION = 0.85;
  const JUMP_VEL = -6.2 * SCALE;
  const JUMP_CUTOFF = 0.45; // release jump -> scale vy
  const COYOTE_FRAMES = 8;
  const JUMP_BUFFER_FRAMES = 8;

  let timer = 300; // seconds
  let paused = true;
  let gameOver = false;
  let win = false;

  function togglePause() {
    if (gameOver) { restart(); return; }
    paused = !paused;
    MSG_EL.textContent = paused ? "Paused • Tap ▶ to resume" : "";
  }

  function restart() {
    player.x = spawn.x*world.tileSize;
    player.y = (spawn.y-1)*world.tileSize;
    player.vx = player.vy = 0;
    player.onGround = false;
    player.coins = 0;
    player.lives = 3;
    enemies.splice(0, enemies.length);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        // reset coins
        if (LEVEL[y][x] === 'C') world.set(x,y,'C');
      }
    }
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (LEVEL[y][x] === 'E') enemies.push(new Enemy(x*world.tileSize, (y-1)*world.tileSize));
      }
    }
    timer = 300;
    gameOver = false;
    win = false;
    paused = false;
    MSG_EL.textContent = "";
  }

  // Collision helpers
  function rectVsWorld(r) {
    // Test solid and platform tiles
    const ts = world.tileSize;
    const minx = Math.floor(r.x / ts) - 1;
    const maxx = Math.floor((r.x + r.w) / ts) + 1;
    const miny = Math.floor(r.y / ts) - 1;
    const maxy = Math.floor((r.y + r.h) / ts) + 1;
    const hits = [];
    for (let ty = miny; ty <= maxy; ty++) {
      for (let tx = minx; tx <= maxx; tx++) {
        const t = world.get(tx, ty);
        if (t === ' ' || t === 'C' || t === 'S' || t === 'F') continue;
        if (world.isSolid(tx, ty) || world.isPlatform(tx, ty)) {
          hits.push({tx, ty, t, x: tx*ts, y: ty*ts, w: ts, h: ts});
        }
      }
    }
    return hits;
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Game loop (fixed timestep)
  let last = 0;
  let acc = 0;
  const STEP = 1000/60;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (paused) return;
    if (!last) last = ts;
    let delta = ts - last;
    if (delta > 100) delta = 100;
    last = ts;
    acc += delta;
    while (acc >= STEP) {
      update();
      acc -= STEP;
    }
    draw();
  }

  function update() {
    // Timer
    if (!win && !gameOver) {
      timer -= 1/60;
      if (timer < 0) {
        loseLife();
      }
    }
    TIMER_EL.textContent = "⏱ " + Math.max(0, Math.floor(timer));

    // Player input
    player.coyote = Math.max(0, player.coyote - 1);
    player.jumpBuffer = Math.max(0, player.jumpBuffer - 1);
    const wantLeft = keys.left;
    const wantRight = keys.right;
    const wantJump = keys.jump;

    if (wantLeft && !wantRight) { player.vx -= RUN_ACCEL; player.facing = -1; }
    else if (wantRight && !wantLeft) { player.vx += RUN_ACCEL; player.facing = 1; }
    else { player.vx *= FRICTION; if (Math.abs(player.vx) < 0.05) player.vx = 0; }

    player.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, player.vx));

    // buffered jump
    if (wantJump) player.jumpBuffer = JUMP_BUFFER_FRAMES;
    if ((player.onGround || player.coyote > 0) && player.jumpBuffer > 0) {
      player.vy = JUMP_VEL;
      player.onGround = false;
      player.coyote = 0;
      player.jumpBuffer = 0;
    }
    // Short hop
    if (!wantJump && player.vy < 0) player.vy *= (1 - JUMP_CUTOFF);

    // Gravity
    player.vy += GRAV;
    if (player.vy > world.tileSize*1.2) player.vy = world.tileSize*1.2;

    // Move + collide X
    moveAndCollide(player, player.vx, 0);
    // Move + collide Y
    moveAndCollide(player, 0, player.vy);

    // Coins + flag
    coinCheck(player);
    flagCheck(player);

    // Enemies
    for (const e of enemies) {
      if (e.dead) continue;
      // gravity
      e.vy += GRAV;
      if (e.vy > world.tileSize*1.2) e.vy = world.tileSize*1.2;
      // move
      moveEnemy(e);
      // player-enemy
      if (aabb(player.rect, e.rect)) {
        // stomp?
        if (player.vy > 0 && player.y + player.h - e.y < 10) {
          e.dead = true;
          player.vy = JUMP_VEL * 0.7;
        } else if (player.invuln <= 0) {
          hitPlayer();
        }
      }
    }
    player.invuln = Math.max(0, player.invuln - 1);

    // Camera follows player
    const ts = world.tileSize;
    camera.x = Math.max(0, Math.min(player.x/ts - camera.w/2, world.width - camera.w));
    camera.y = Math.max(0, Math.min(player.y/ts - camera.h/2, world.height - camera.h));

    // Fell off?
    if (player.y > world.height * ts + ts*2) {
      loseLife();
    }

    // HUD
    COIN_EL.textContent = "🪙 " + player.coins;
    LIVES_EL.textContent = "❤ " + player.lives;

    if (win) {
      paused = true;
      MSG_EL.textContent = "You win! ⏯ to play again";
      gameOver = true;
    } else if (gameOver) {
      paused = true;
      MSG_EL.textContent = "Game over. ⏯ to retry";
    }
  }

  function moveAndCollide(ent, dx, dy) {
    ent.x += dx;
    let hits = rectVsWorld(ent.rect);
    // horizontal resolve
    for (const h of hits) {
      if (world.isSolid(h.tx, h.ty)) {
        if (dx > 0 && ent.x + ent.w > h.x && ent.x < h.x && ent.y + ent.h > h.y + 2 && ent.y < h.y + h.h - 2) {
          ent.x = h.x - ent.w;
          dx = 0;
          ent.vx = 0;
        } else if (dx < 0 && ent.x < h.x + h.w && ent.x + ent.w > h.x && ent.y + ent.h > h.y + 2 && ent.y < h.y + h.h - 2) {
          ent.x = h.x + h.w;
          dx = 0;
          ent.vx = 0;
        }
      }
    }
    ent.y += dy;
    hits = rectVsWorld(ent.rect);
    ent.onGround = false;
    for (const h of hits) {
      if (world.isSolid(h.tx, h.ty)) {
        if (dy > 0 && ent.y + ent.h > h.y && ent.y < h.y) {
          ent.y = h.y - ent.h;
          ent.vy = 0;
          ent.onGround = true;
          if (ent === player) player.coyote = COYOTE_FRAMES;
        } else if (dy < 0 && ent.y < h.y + h.h && ent.y + ent.h > h.y + h.h) {
          ent.y = h.y + h.h;
          ent.vy = 0;
        }
      } else if (world.isPlatform(h.tx, h.ty)) {
        // one-way platforms (only collide when moving down and feet above)
        if (dy > 0) {
          const feet = ent.y + ent.h;
          if (feet > h.y && feet - dy <= h.y + 6 && ent.x + ent.w > h.x + 2 && ent.x < h.x + h.w - 2) {
            ent.y = h.y - ent.h;
            ent.vy = 0;
            ent.onGround = true;
            if (ent === player) player.coyote = COYOTE_FRAMES;
          }
        }
      }
    }
  }

  function coinCheck(ent) {
    const ts = world.tileSize;
    const cx1 = Math.floor(ent.x / ts);
    const cy1 = Math.floor(ent.y / ts);
    const cx2 = Math.floor((ent.x + ent.w) / ts);
    const cy2 = Math.floor((ent.y + ent.h) / ts);
    for (let y = cy1; y <= cy2; y++) {
      for (let x = cx1; x <= cx2; x++) {
        if (world.get(x, y) === 'C') {
          world.set(x, y, ' ');
          if (ent === player) player.coins++;
        }
      }
    }
  }

  function flagCheck(ent) {
    const ts = world.tileSize;
    const cx = Math.floor((ent.x + ent.w/2) / ts);
    const cy = Math.floor((ent.y + ent.h/2) / ts);
    if (world.get(cx, cy) === 'F') {
      win = true;
    }
  }

  function moveEnemy(e) {
    const speed = 0.6 * SCALE;
    e.vx = Math.sign(e.vx || 1) * speed;
    // try to move; if blocked, turn
    const beforeX = e.x;
    moveAndCollide(e, e.vx, 0);
    if (Math.abs(e.x - beforeX) < 0.1) e.vx *= -1;
    moveAndCollide(e, 0, e.vy);
    // if at an edge, turn
    if (e.onGround) {
      const ts = world.tileSize;
      const aheadX = Math.floor((e.x + (e.vx>0 ? e.w+1 : -1)) / ts);
      const footY = Math.floor((e.y + e.h + 1) / ts);
      if (!world.isSolid(aheadX, footY) && !world.isPlatform(aheadX, footY)) {
        e.vx *= -1;
      }
    }
  }

  function hitPlayer() {
    player.invuln = 60;
    player.lives--;
    if (player.lives <= 0) {
      gameOver = true;
    } else {
      // respawn to last safe ground (simple: spawn point)
      player.x = spawn.x*world.tileSize;
      player.y = (spawn.y-1)*world.tileSize;
      player.vx = 0; player.vy = 0;
    }
  }

  function loseLife() {
    player.lives--;
    if (player.lives <= 0) {
      gameOver = true;
    } else {
      player.x = spawn.x*world.tileSize;
      player.y = (spawn.y-1)*world.tileSize;
      player.vx = 0; player.vy = 0;
      timer = 300;
    }
  }

  function draw() {
    // sky gradient under canvas CSS already; clear logical layer for parallax clouds / nothing for now
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const ts = world.tileSize;
    const left = Math.floor(camera.x);
    const top = Math.floor(camera.y);
    const right = Math.ceil(camera.x + camera.w);
    const bottom = Math.ceil(camera.y + camera.h);

    // Draw tiles
    for (let ty = top; ty < bottom; ty++) {
      for (let tx = left; tx < right; tx++) {
        const t = world.get(tx, ty);
        const x = (tx - camera.x) * ts;
        const y = (ty - camera.y) * ts;
        switch (t) {
          case '=': // ground
            rect(x, y, ts, ts, '#6b3e18'); // dirt
            rect(x, y, ts, ts/4, '#2e7d32'); // grass top
            break;
          case '#': // solid brick
            rect(x, y, ts, ts, '#8a4b2a');
            rect(x+2, y+2, ts-4, ts-4, '#a86a45');
            break;
          case '-': // platform
            rect(x, y + ts/2, ts, ts/2, '#9e6b4a');
            rect(x, y + ts/2, ts, 3, '#5d3b27');
            break;
          case 'C': // coin
            coinSprite(x + ts/2, y + ts/2);
            break;
          case 'F': // flag pole
            rect(x + ts/2-2, y - ts*5 + ts, 4, ts*5, '#dfe8f3');
            rect(x + ts/2+2, y - ts*5 + ts, ts, ts/2, '#1e88e5');
            break;
        }
      }
    }

    // Draw enemies
    for (const e of enemies) {
      if (e.dead) continue;
      const x = (e.x/ts - camera.x) * ts;
      const y = (e.y/ts - camera.y) * ts;
      enemySprite(x, y, e.w, e.h);
    }

    // Draw player
    const px = (player.x/ts - camera.x) * ts;
    const py = (player.y/ts - camera.y) * ts;
    playerSprite(px, py, player.w, player.h, player.facing, player.invuln > 0);
  }

  function rect(x,y,w,h,color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
  }

  function playerSprite(x,y,w,h,dir,blink) {
    if (blink && Math.floor(performance.now()/100)%2===0) return;
    // body
    rect(x, y, w, h, '#ffcc66'); // suit
    rect(x, y-4, w, 6, '#f2b05e'); // hat brim-ish
    // head
    rect(x+2, y-10, w-4, 10, '#ffd7a3');
    // eyes
    rect(x+ (dir>0 ? w-6 : 2), y-7, 3, 3, '#1a237e');
    // boots
    rect(x, y+h-3, w, 3, '#5d4037');
  }

  function enemySprite(x,y,w,h) {
    rect(x, y, w, h, '#9c4a1a');
    rect(x+2, y+2, w-4, h-8, '#c26a3a');
    rect(x+2, y+h-6, w-4, 4, '#5d4037');
    // eyes
    rect(x+3, y+4, 3, 3, '#1a1a1a');
    rect(x+w-6, y+4, 3, 3, '#1a1a1a');
  }

  function coinSprite(cx, cy) {
    const r = 6;
    ctx.beginPath();
    ctx.arc(Math.floor(cx), Math.floor(cy), r, 0, Math.PI*2);
    ctx.fillStyle = '#ffd54f';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(Math.floor(cx), Math.floor(cy), r-2, 0, Math.PI*2);
    ctx.fillStyle = '#ffecb3';
    ctx.fill();
  }

  // Start paused; user taps ⏯ to begin
  requestAnimationFrame(loop);
  // Unpause on first jump tap, too
  jumpBtn.addEventListener('click', () => { if (paused) togglePause(); });

  // iOS: resume audio contexts if added later (not used here) on first touch
})();
