'use strict';
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs');
const bcrypt  = require('bcryptjs');
const db      = require('./db');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── CORS for teacher page (port 3001 → 3000) ─────────────────────────────────
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Auth REST endpoints ───────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const clean = String(username).trim().slice(0, 18);
  if (clean.length < 2) return res.status(400).json({ error: 'Username too short' });
  if (db.findPlayer(clean)) return res.status(409).json({ error: 'Username taken' });
  const hash  = await bcrypt.hash(String(password), 8);
  const pid   = db.register(clean, hash);
  const token = db.createSession(pid);
  res.json({ token, username: clean, stats: db.getStats(pid) });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const player = db.findPlayer(String(username).trim());
  if (!player) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(String(password), player.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = db.createSession(player.id);
  res.json({ token, username: player.username, stats: db.getStats(player.id) });
});

app.post('/api/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  db.deleteSession(token);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const token  = (req.headers.authorization || '').replace('Bearer ', '');
  const session = db.getSession(token);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  const player = db.getPlayerById(session.player_id);
  if (!player) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ username: player.username, stats: db.getStats(player.id) });
});

app.get('/api/stats', (req, res) => res.json(db.getAllPlayerStats()));

app.get('/api/live', (req, res) => {
  res.json({
    players: Object.values(players).filter(p => p.active).map(publicPlayer),
    appleCount: Object.keys(apples).length,
  });
});

// ─── High scores ───────────────────────────────────────────────────────────────
const SCORES_FILE = path.join(__dirname, 'scores.json');
let highScores = [];
try { highScores = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch(e) {}
function saveScores() {
  fs.writeFileSync(SCORES_FILE, JSON.stringify(highScores, null, 2));
}

// ─── Game constants ────────────────────────────────────────────────────────────
const LANE_COUNT      = 4;
const APPLE_SPEED     = 2.5;
const ARC_TICKS       = 45;
const MIN_APPLE_GAP   = 44;
const STEAL_ZONE_LEFT  = 170;
const STEAL_ZONE_RIGHT = 212;
const APPLES_TO_LEVEL  = 5;
const STEAL_STREAK     = 3;
const ANIMAL_POINTS    = {monkey:1, gorilla:2, orangutan:5, parrot:10};

// ─── Level → animal mapping ────────────────────────────────────────────────────
const LEVEL_ANIMALS = {
  1: ['monkey'],
  2: ['gorilla'],
  3: ['monkey', 'gorilla'],
  4: ['orangutan'],
  5: ['monkey', 'gorilla', 'orangutan'],
  6: ['parrot'],
};
function getAnimals(level) {
  return level >= 7 ? ['monkey','gorilla','orangutan','parrot'] : (LEVEL_ANIMALS[level] || ['monkey']);
}

function spawnInterval(level) {
  if (level < 7) return 5000;
  return Math.max(200, Math.floor(1000 / (1 + (level - 7) * 0.15)));
}

// ─── Problem generation ────────────────────────────────────────────────────────
const animalOp = {
  monkey:    'addition',
  gorilla:   'subtraction',
  orangutan: 'multiplication',
  parrot:    'division',
};

const MULT_PRODUCTS = [...new Set(
  Array.from({length:13},(_,a)=>Array.from({length:13},(_,b)=>a*b)).flat()
)].sort((a,b)=>a-b);

function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function pick(arr)        { return arr[Math.floor(Math.random() * arr.length)]; }

function newTarget(level) {
  if (level <= 6) return randInt(0, 12);
  return pick(MULT_PRODUCTS.filter(n => n > 0));
}

function canProduceCorrect(animal, target) {
  const op = animalOp[animal];
  if (op === 'addition')       return target <= 24;
  if (op === 'subtraction')    return target >= 0 && target <= 12;
  if (op === 'multiplication') return MULT_PRODUCTS.includes(target);
  if (op === 'division') {
    for (let d=1;d<=12;d++) if (target*d<=144) return true;
    return false;
  }
  return false;
}

function generateCorrect(animal, target) {
  const op = animalOp[animal];
  if (op === 'addition') {
    const lo = Math.max(0, target - 12), hi = Math.min(12, target);
    const a = randInt(lo, hi), b = target - a;
    return { problem:`${a}+${b}`, answer:target, operands:[a, b] };
  }
  if (op === 'subtraction') {
    const small = randInt(0, Math.min(12, 12 - target));
    return { problem:`${target+small}-${small}`, answer:target, operands:[target+small, small] };
  }
  if (op === 'multiplication') {
    const pairs=[];
    for (let a=0;a<=12;a++) for (let b=a;b<=12;b++) if (a*b===target) pairs.push([a,b]);
    if (pairs.length) {
      const [a,b]=pick(pairs);
      return { problem:`${a}×${b}`, answer:target, operands:[a, b] };
    }
    return generateRandom(animal);
  }
  if (op === 'division') {
    const valid=[];
    for (let d=1;d<=12;d++) if (target*d<=144) valid.push(d);
    if (valid.length) {
      const d=pick(valid);
      return { problem:`${target*d}÷${d}`, answer:target, operands:[target*d, d] };
    }
    return generateRandom(animal);
  }
}

function generateRandom(animal) {
  const op = animalOp[animal];
  const a=randInt(0,12), b=randInt(0,12);
  if (op==='addition')       return { problem:`${a}+${b}`,       answer:a+b,              operands:[a,b] };
  if (op==='subtraction')    { const [g,s]=[Math.max(a,b),Math.min(a,b)]; return { problem:`${g}-${s}`, answer:g-s, operands:[g,s] }; }
  if (op==='multiplication') return { problem:`${a}×${b}`,       answer:a*b,              operands:[a,b] };
  if (op==='division')       { const d=randInt(1,12),q=randInt(0,12); return { problem:`${d*q}÷${d}`, answer:q, operands:[d*q,d] }; }
}

// ─── Focus-fact biased generation ─────────────────────────────────────────────
// Returns a problem that uses one of the focus operands, or null if not possible.
function tryCorrectWithFocus(op, target, fo) {
  if (op === 'addition') {
    const b = target - fo;
    if (fo >= 0 && fo <= 12 && b >= 0 && b <= 12)
      return { problem:`${fo}+${b}`, answer:target, operands:[fo,b] };
  }
  if (op === 'subtraction') {
    if (target + fo <= 12 && fo >= 0)
      return { problem:`${target+fo}-${fo}`, answer:target, operands:[target+fo, fo] };
    if (fo >= target && fo <= 12)
      return { problem:`${fo}-${fo-target}`, answer:target, operands:[fo, fo-target] };
  }
  if (op === 'multiplication') {
    if (fo > 0 && target % fo === 0 && (target/fo) <= 12)
      return { problem:`${fo}×${target/fo}`, answer:target, operands:[fo, target/fo] };
    if (fo > 0 && target % fo === 0)
      return { problem:`${target/fo}×${fo}`, answer:target, operands:[target/fo, fo] };
  }
  if (op === 'division') {
    if (fo >= 1 && fo <= 12 && target * fo <= 144)
      return { problem:`${target*fo}÷${fo}`, answer:target, operands:[target*fo, fo] };
  }
  return null;
}

function generateRandomWithFocus(op, fo) {
  if (op === 'addition') {
    const b = randInt(0, 12);
    return { problem:`${fo}+${b}`, answer:fo+b, operands:[fo,b] };
  }
  if (op === 'subtraction') {
    const b = randInt(0, fo);
    return { problem:`${fo}-${b}`, answer:fo-b, operands:[fo,b] };
  }
  if (op === 'multiplication') {
    const b = randInt(0, 12);
    return { problem:`${fo}×${b}`, answer:fo*b, operands:[fo,b] };
  }
  if (op === 'division') {
    const d = (fo >= 1 && fo <= 12) ? fo : randInt(1, 12);
    const maxQ = Math.min(12, Math.floor(144 / d));
    const q = randInt(0, maxQ);
    return { problem:`${d*q}÷${d}`, answer:q, operands:[d*q, d] };
  }
}

function generateWithFocus(animal, target, focusOperands, forceCorrect) {
  const op = animalOp[animal];
  const ops = focusOperands.filter(fo => fo >= 0 && fo <= 12)
    .sort(() => Math.random() - 0.5);  // shuffle for variety
  for (const fo of ops) {
    if (forceCorrect) {
      const r = tryCorrectWithFocus(op, target, fo);
      if (r) return r;
    } else {
      return generateRandomWithFocus(op, fo);
    }
  }
  return null;  // no focus operand worked, caller falls back
}

function shouldForceCorrect(player) {
  const w = player.correctWindow;
  return w.length >= 4 && w.slice(-4).every(v=>!v);
}

// ─── Lane management ───────────────────────────────────────────────────────────
const laneOwner = new Array(LANE_COUNT).fill(null);
function assignLane() {
  for (let i=0;i<LANE_COUNT;i++) if (!laneOwner[i]) return i;
  return randInt(0, LANE_COUNT-1);
}
function releaseLane(playerId) {
  for (let i=0;i<LANE_COUNT;i++) { if (laneOwner[i]===playerId) { laneOwner[i]=null; break; } }
}

// ─── Game state ────────────────────────────────────────────────────────────────
const players = {};
const apples  = {};
let nextAppleId  = 0;
let nextPlayerNum = 1;

function freshPlayer(playerId, socketId, name, laneIdx, dbPlayerId) {
  const focusFacts = dbPlayerId ? db.getFocusFacts(dbPlayerId) : [];
  return {
    id:playerId, socketId, name,
    laneIdx, dbPlayerId: dbPlayerId || null,
    score:0, level:1, lives:3,
    levelAppleCount:0,
    consecutiveCorrect:0, canSteal:false,
    targetNumber:newTarget(1),
    mouthOpen:false, active:true,
    correctWindow:[],
    nextSpawnTime: Date.now() + 2000,
    birdCooldown: randInt(20000,40000),
    birdActive:false,
    gameStarted: true,
    focusFacts,  // [{operation, operand}, ...]
  };
}

function publicPlayer(p) {
  return {
    id:p.id, name:p.name, laneIdx:p.laneIdx,
    score:p.score, level:p.level, lives:p.lives,
    levelAppleCount:p.levelAppleCount,
    consecutiveCorrect:p.consecutiveCorrect, canSteal:p.canSteal,
    targetNumber:p.targetNumber, mouthOpen:p.mouthOpen, active:p.active,
  };
}

function getStealers() {
  return Object.values(players).filter(p=>p.active&&p.canSteal).map(p=>p.id);
}

function broadcastScores() {
  const scores = Object.values(players).filter(p=>p.active).map(p=>({
    id:p.id, name:p.name, score:p.score, level:p.level, laneIdx:p.laneIdx,
  }));
  io.emit('playerScoresUpdate', scores);
}

function finishGame(player) {
  if (player.dbPlayerId && player.gameStarted) {
    db.updateBestScore(player.dbPlayerId, player.score);
    db.incrementGames(player.dbPlayerId);
    player.gameStarted = false;
  }
}

// ─── Apple spawner ─────────────────────────────────────────────────────────────
const ANIMAL_POS = {
  monkey:    {x:566, y:147},
  gorilla:   {x:639, y:134},
  orangutan: {x:716, y:139},
  parrot:    {x:781, y:147},
};
const STREAM_RIGHT = 800;

function spawnApple(player) {
  const animals    = getAnimals(player.level);
  const animal     = pick(animals);
  const canCorrect = canProduceCorrect(animal, player.targetNumber);
  const force      = canCorrect && (shouldForceCorrect(player) || Math.random() < 0.35);

  // Use focus-biased generation if teacher has set focus facts for this operation
  const op = animalOp[animal];
  const focusOps = (player.focusFacts || [])
    .filter(f => f.operation === op)
    .map(f => f.operand);
  const useFocus = focusOps.length > 0 && Math.random() < 0.70;

  let generated = null;
  if (useFocus) generated = generateWithFocus(animal, player.targetNumber, focusOps, force);
  if (!generated) generated = force ? generateCorrect(animal, player.targetNumber) : generateRandom(animal);
  const {problem, answer, operands} = generated;

  const isCorrect = answer === player.targetNumber;
  player.correctWindow.push(isCorrect);
  if (player.correctWindow.length > 10) player.correctWindow.shift();

  // Track correct answers presented in DB
  if (isCorrect && player.dbPlayerId && operands) {
    db.recordPresented(player.dbPlayerId, animalOp[animal], operands);
  }

  let targetX = randInt(750, STREAM_RIGHT-10);
  const existing = Object.values(apples)
    .filter(a=>a.playerId===player.id&&!a.eaten&&a.arcLeft===0)
    .sort((a,b)=>a.x-b.x);
  for (const ea of existing) {
    if (Math.abs(targetX-ea.x)<MIN_APPLE_GAP) targetX = ea.x+MIN_APPLE_GAP;
  }
  targetX = Math.min(targetX, STREAM_RIGHT+200);

  const pos = ANIMAL_POS[animal];
  const id  = nextAppleId++;
  apples[id] = {
    id, playerId:player.id, laneIdx:player.laneIdx,
    x:targetX, arcLeft:ARC_TICKS,
    problem, answer, isCorrect, animal, operands: operands || [],
    throwerX:pos.x, throwerY:pos.y,
    eaten:false,
  };
  io.emit('appleSpawned', apples[id]);
}

// ─── Game loop ─────────────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();

  for (const pid in players) {
    const player = players[pid];
    if (!player.active) continue;

    if (now >= player.nextSpawnTime) {
      spawnApple(player);
      player.nextSpawnTime = now + spawnInterval(player.level);
    }

    if (player.level >= 10 && !player.birdActive) {
      player.birdCooldown -= 33;
      if (player.birdCooldown <= 0) {
        player.birdActive = true;
        player.birdCooldown = randInt(15000, 45000);
        io.emit('birdSpawned', {playerId:pid, laneIdx:player.laneIdx});

        setTimeout(() => {
          if (!players[pid]) return;
          const candidates = Object.values(apples)
            .filter(a=>a.playerId===pid&&!a.eaten&&a.arcLeft===0&&a.isCorrect)
            .sort((a,b)=>b.x-a.x);
          if (candidates.length) {
            const t = candidates[0];
            delete apples[t.id];
            io.emit('birdSnatched', {appleId:t.id, laneIdx:player.laneIdx});
          }
          if (players[pid]) players[pid].birdActive = false;
          io.emit('birdGone', {laneIdx:player.laneIdx});
        }, 3000);
      }
    }
  }

  for (const id in apples) {
    const a = apples[id];
    if (a.eaten) { delete apples[id]; continue; }
    if (a.arcLeft > 0) { a.arcLeft--; continue; }
    a.x -= APPLE_SPEED;
    if (a.x < -60) { io.emit('appleMissed', a.id); delete apples[id]; }
  }

  const byPlayer = {};
  for (const id in apples) {
    const a = apples[id];
    if (a.arcLeft>0) continue;
    (byPlayer[a.playerId]||(byPlayer[a.playerId]=[])).push(a);
  }
  for (const pid in byPlayer) {
    const sorted = byPlayer[pid].sort((a,b)=>a.x-b.x);
    for (let i=1;i<sorted.length;i++) {
      if (sorted[i].x - sorted[i-1].x < MIN_APPLE_GAP)
        sorted[i].x = sorted[i-1].x + MIN_APPLE_GAP;
    }
  }

  io.emit('applesUpdate', Object.values(apples));
  broadcastScores();
}, 33);

// ─── Eat processor ─────────────────────────────────────────────────────────────
function processEat(player, apple, socket) {
  delete apples[apple.id];
  io.emit('appleEaten', {appleId:apple.id, playerId:player.id, isGood:apple.isCorrect});

  // Track in DB
  if (player.dbPlayerId && apple.operands && apple.operands.length) {
    db.recordEaten(player.dbPlayerId, animalOp[apple.animal], apple.operands, apple.isCorrect);
  }

  function emitStats() {
    return player.dbPlayerId ? db.getStats(player.dbPlayerId) : null;
  }

  if (apple.isCorrect) {
    const pts = ANIMAL_POINTS[apple.animal] || 1;
    player.score += pts;
    player.levelAppleCount++;
    player.consecutiveCorrect++;

    if (player.consecutiveCorrect >= STEAL_STREAK && !player.canSteal) {
      player.canSteal = true;
      io.emit('stealZoneUpdate', getStealers());
    }

    const base = {
      score:player.score, levelAppleCount:player.levelAppleCount,
      consecutiveCorrect:player.consecutiveCorrect, canSteal:player.canSteal,
      animal:apple.animal, points:pts,
    };

    if (player.levelAppleCount >= APPLES_TO_LEVEL) {
      player.level++;
      player.levelAppleCount = 0;
      player.targetNumber = newTarget(player.level);
      if (player.nextSpawnTime - Date.now() > spawnInterval(player.level))
        player.nextSpawnTime = Date.now() + spawnInterval(player.level);
      socket.emit('levelUp', {...base, level:player.level, targetNumber:player.targetNumber, levelAppleCount:0, stats:emitStats()});
    } else {
      player.targetNumber = newTarget(player.level);
      socket.emit('goodEat', {...base, targetNumber:player.targetNumber, stats:emitStats()});
    }
  } else {
    player.score = Math.max(0, player.score - 5);
    player.consecutiveCorrect = 0;
    if (player.canSteal) { player.canSteal=false; io.emit('stealZoneUpdate', getStealers()); }

    if (player.levelAppleCount > 0) {
      player.levelAppleCount--;
      socket.emit('badEat', {score:player.score, levelAppleCount:player.levelAppleCount, stats:emitStats()});
    } else if (player.level > 1) {
      player.level--;
      player.levelAppleCount = 0;
      player.targetNumber = newTarget(player.level);
      socket.emit('levelDown', {score:player.score, level:player.level, targetNumber:player.targetNumber, levelAppleCount:0, stats:emitStats()});
    } else {
      player.lives--;
      if (player.lives <= 0) {
        player.active = false;
        finishGame(player);
        socket.emit('gameOver', {finalLevel:player.level, score:player.score, stats:emitStats()});
      } else {
        socket.emit('lostLife', {lives:player.lives, score:player.score, levelAppleCount:0, stats:emitStats()});
      }
    }
  }
}

// ─── Socket connections ────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('Connected:', socket.id);
  let playerId  = null;
  let dbPlayer  = null;

  // Resolve auth token if provided
  const token = socket.handshake.auth?.token;
  if (token) {
    const session = db.getSession(token);
    if (session) dbPlayer = db.getPlayerById(session.player_id);
  }

  socket.emit('highScores', highScores);

  socket.on('joinGame', ({name}) => {
    if (playerId) return;
    const num  = nextPlayerNum++;
    playerId   = `player${num}`;
    const laneIdx  = assignLane();
    laneOwner[laneIdx] = playerId;

    const cleanName = dbPlayer
      ? dbPlayer.username
      : (String(name||'').trim().slice(0,12) || 'Guest');

    players[playerId] = freshPlayer(playerId, socket.id, cleanName, laneIdx, dbPlayer?.id);
    const p = players[playerId];

    socket.emit('playerAssigned', {
      ...publicPlayer(p),
      dbUsername: dbPlayer?.username || null,
      stats: dbPlayer ? db.getStats(dbPlayer.id) : null,
      gameState: {
        players: Object.fromEntries(Object.entries(players).map(([k,v])=>[k,publicPlayer(v)])),
        apples:  Object.values(apples),
      },
    });
    socket.broadcast.emit('playerJoined', publicPlayer(p));
    io.emit('stealZoneUpdate', getStealers());
    console.log(`${cleanName} joined as ${playerId} in lane ${laneIdx}${dbPlayer?' (DB)':' (guest)'}`);
  });

  socket.on('mouthToggle', isOpen => {
    const p = players[playerId];
    if (p && p.active) {
      p.mouthOpen = !!isOpen;
      io.emit('playerUpdate', {playerId, mouthOpen:p.mouthOpen});
    }
  });

  socket.on('checkEat', appleId => {
    const p = players[playerId];
    if (!p || !p.mouthOpen || !p.active) return;
    const apple = apples[appleId];
    if (!apple || apple.eaten || apple.arcLeft > 0) return;
    apple.eaten = true;
    processEat(p, apple, socket);
  });

  socket.on('steal', () => {
    const stealer = players[playerId];
    if (!stealer || !stealer.canSteal || !stealer.active) return;

    const byLane = {};
    Object.values(apples).forEach(a => {
      if (a.playerId === playerId || a.eaten || a.arcLeft > 0) return;
      if (a.x < STEAL_ZONE_LEFT || a.x > STEAL_ZONE_RIGHT) return;
      if (!byLane[a.laneIdx] || a.x > byLane[a.laneIdx].x) byLane[a.laneIdx] = a;
    });
    const stolen = Object.values(byLane);

    let scoreChange = 0;
    stolen.forEach(a => {
      a.eaten = true;
      const good = a.answer === stealer.targetNumber;
      scoreChange += good ? 10 : -5;
      io.emit('appleEaten', {appleId:a.id, playerId, isGood:good});
      delete apples[a.id];
    });

    stealer.score = Math.max(0, stealer.score + scoreChange);
    stealer.canSteal = false;
    stealer.consecutiveCorrect = 0;

    socket.emit('stealResult', {scoreChange, newScore:stealer.score, stolen:stolen.length});
    io.emit('stealZoneUpdate', getStealers());
    broadcastScores();
  });

  socket.on('submitScore', ({name, level, score}) => {
    const entry = {
      name: String(name||'').slice(0,18).trim() || 'Anonymous',
      level, score: Number(score) || 0,
      date: new Date().toLocaleDateString(),
    };
    highScores.push(entry);
    highScores.sort((a,b)=>b.score-a.score);
    highScores = highScores.slice(0,10);
    saveScores();
    io.emit('highScores', highScores);
  });

  socket.on('restartGame', () => {
    const p = players[playerId];
    if (!p) return;
    finishGame(p);  // count prior game
    Object.keys(apples).forEach(id => {
      if (apples[id].playerId===playerId) { io.emit('appleMissed', apples[id].id); delete apples[id]; }
    });
    const laneIdx = p.laneIdx;
    const name    = p.name;
    players[playerId] = freshPlayer(playerId, socket.id, name, laneIdx, dbPlayer?.id);
    const np = players[playerId];
    socket.emit('playerAssigned', {
      ...publicPlayer(np),
      dbUsername: dbPlayer?.username || null,
      stats: dbPlayer ? db.getStats(dbPlayer.id) : null,
      gameState: {
        players: Object.fromEntries(Object.entries(players).map(([k,v])=>[k,publicPlayer(v)])),
        apples:  Object.values(apples),
      },
    });
    io.emit('stealZoneUpdate', getStealers());
  });

  socket.on('requestScores', () => socket.emit('highScores', highScores));

  socket.on('clientLog', msg => {
    const ts = new Date().toISOString().slice(11,23);
    console.log(`[${ts}][${playerId||'?'}] ${msg}`);
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    if (playerId && players[playerId]) {
      finishGame(players[playerId]);
      players[playerId].active = false;
      Object.keys(apples).forEach(id => {
        if (apples[id].playerId===playerId) { io.emit('appleMissed', apples[id].id); delete apples[id]; }
      });
      releaseLane(playerId);
      io.emit('playerLeft', playerId);
      io.emit('stealZoneUpdate', getStealers());
      delete players[playerId];
    }
  });
});

// ─── Teacher API (on main port 3000, /api/teacher/*) ──────────────────────────
// No extra auth — teacher dashboard is on a separate port; classroom assumption.

app.get('/api/teacher/players', (req, res) => {
  res.json(db.getAllPlayerStats());
});

app.delete('/api/teacher/players/:id', (req, res) => {
  const pid = parseInt(req.params.id);
  if (!pid) return res.status(400).json({ error: 'Bad id' });
  // Kick out if currently playing
  const gp = Object.values(players).find(p => p.dbPlayerId === pid);
  if (gp) {
    const sock = io.sockets.sockets.get(gp.socketId);
    if (sock) sock.emit('kicked', { reason: 'Account removed by teacher' });
  }
  db.deletePlayer(pid);
  res.json({ ok: true });
});

app.post('/api/teacher/players/:id/reset-password', async (req, res) => {
  const pid = parseInt(req.params.id);
  const { newPassword } = req.body || {};
  if (!pid || !newPassword || newPassword.length < 4)
    return res.status(400).json({ error: 'Bad request' });
  const hash = await bcrypt.hash(String(newPassword), 8);
  db.resetPassword(pid, hash);
  res.json({ ok: true });
});

app.get('/api/teacher/players/:id/focus', (req, res) => {
  const pid = parseInt(req.params.id);
  res.json(db.getFocusFacts(pid));
});

app.post('/api/teacher/players/:id/focus', (req, res) => {
  const pid   = parseInt(req.params.id);
  const facts = req.body?.facts || [];
  if (!pid) return res.status(400).json({ error: 'Bad id' });
  db.setFocusFacts(pid, facts);
  // Push updated focus facts into live player state if they're online
  const gp = Object.values(players).find(p => p.dbPlayerId === pid);
  if (gp) {
    gp.focusFacts = db.getFocusFacts(pid);
    const sock = io.sockets.sockets.get(gp.socketId);
    if (sock) sock.emit('focusUpdate', gp.focusFacts);
  }
  res.json({ ok: true });
});

// ─── Teacher server (port 3001) ────────────────────────────────────────────────
const teacherApp    = express();
const teacherServer = http.createServer(teacherApp);
// Disable automatic index.html so teacher.html is served at /
teacherApp.use(express.static(path.join(__dirname, 'public'), { index: false }));
teacherApp.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher.html')));
teacherServer.listen(3001, () => console.log('Teacher dashboard on port 3001'));

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Math Gator on port ${PORT}`));
