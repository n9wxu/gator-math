'use strict';
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ─── High scores ───────────────────────────────────────────────────────────────
const SCORES_FILE = path.join(__dirname, 'scores.json');
let highScores = [];
try { highScores = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch(e) {}
function saveScores() {
  fs.writeFileSync(SCORES_FILE, JSON.stringify(highScores, null, 2));
}

// ─── Game constants ────────────────────────────────────────────────────────────
const LANE_COUNT      = 4;
const APPLE_SPEED     = 2.5;   // px/tick (33ms tick)
const ARC_TICKS       = 45;    // ticks apple stays in arc animation before entering stream
const MIN_APPLE_GAP   = 44;    // min center-to-center px between stream apples
const STEAL_ZONE_LEFT  = 170;  // x-range of steal zone (must match client MOUTH_X)
const STEAL_ZONE_RIGHT = 212;   // 1 apple wide (~42px)
const APPLES_TO_LEVEL  = 5;    // correct apples needed to level up
const STEAL_STREAK     = 3;    // consecutive correct apples to earn steal ability
const ANIMAL_POINTS    = {monkey:1, gorilla:2, orangutan:5, parrot:10};

// ─── Level → animal mapping ────────────────────────────────────────────────────
// L1=add, L2=sub, L3=add+sub, L4=mul, L5=add+sub+mul, L6=div, L7+=all
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
  // Levels 1-6: target fits in every operation's operand range (0-12)
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
    // Both operands must stay in [0,12]
    const lo = Math.max(0, target - 12), hi = Math.min(12, target);
    const a = randInt(lo, hi);
    return { problem:`${a}+${target-a}`, answer:target };
  }
  if (op === 'subtraction') {
    const small = randInt(0, Math.min(12, 12-target));
    return { problem:`${target+small}-${small}`, answer:target };
  }
  if (op === 'multiplication') {
    const pairs=[];
    for (let a=0;a<=12;a++) for (let b=a;b<=12;b++) if (a*b===target) pairs.push([a,b]);
    if (pairs.length) { const [a,b]=pick(pairs); return {problem:`${a}×${b}`,answer:target}; }
    return generateRandom(animal);
  }
  if (op === 'division') {
    const valid=[];
    for (let d=1;d<=12;d++) if (target*d<=144) valid.push(d);
    if (valid.length) { const d=pick(valid); return {problem:`${target*d}÷${d}`,answer:target}; }
    return generateRandom(animal);
  }
}

function generateRandom(animal) {
  const op = animalOp[animal];
  const a=randInt(0,12), b=randInt(0,12);
  if (op==='addition')       return {problem:`${a}+${b}`,       answer:a+b};
  if (op==='subtraction')    { const [g,s]=[Math.max(a,b),Math.min(a,b)]; return {problem:`${g}-${s}`,answer:g-s}; }
  if (op==='multiplication') return {problem:`${a}×${b}`,       answer:a*b};
  if (op==='division')       { const d=randInt(1,12),q=randInt(0,12); return {problem:`${d*q}÷${d}`,answer:q}; }
}

function shouldForceCorrect(player) {
  const w = player.correctWindow;
  return w.length >= 4 && w.slice(-4).every(v=>!v);
}

// ─── Lane management ───────────────────────────────────────────────────────────
const laneOwner = new Array(LANE_COUNT).fill(null); // laneIdx → playerId
function assignLane() {
  for (let i=0;i<LANE_COUNT;i++) if (!laneOwner[i]) return i;
  return randInt(0, LANE_COUNT-1); // overflow: share
}
function releaseLane(playerId) {
  for (let i=0;i<LANE_COUNT;i++) { if (laneOwner[i]===playerId) { laneOwner[i]=null; break; } }
}

// ─── Game state ────────────────────────────────────────────────────────────────
const players = {};
const apples  = {};
let nextAppleId = 0;
let nextPlayerNum = 1;

function freshPlayer(playerId, socketId, name, laneIdx) {
  return {
    id:playerId, socketId, name,
    laneIdx,
    score:0, level:1, lives:3,
    levelAppleCount:0,
    consecutiveCorrect:0, canSteal:false,
    targetNumber:newTarget(1),
    mouthOpen:false, active:true,
    correctWindow:[],
    nextSpawnTime: Date.now() + 2000,
    birdCooldown: randInt(20000,40000),
    birdActive:false,
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

// ─── Apple spawner ─────────────────────────────────────────────────────────────
const ANIMAL_POS = {
  monkey:    {x:566, y:147},
  gorilla:   {x:639, y:134},
  orangutan: {x:716, y:139},
  parrot:    {x:781, y:147},
};
const STREAM_RIGHT = 800;

function spawnApple(player) {
  const animals   = getAnimals(player.level);
  const animal    = pick(animals);
  const canCorrect = canProduceCorrect(animal, player.targetNumber);
  const force      = canCorrect && (shouldForceCorrect(player) || Math.random() < 0.35);

  const {problem, answer} = force
    ? generateCorrect(animal, player.targetNumber)
    : generateRandom(animal);

  const isCorrect = answer === player.targetNumber;
  player.correctWindow.push(isCorrect);
  if (player.correctWindow.length > 10) player.correctWindow.shift();

  let targetX = randInt(750, STREAM_RIGHT-10);
  // Push right to avoid overlap
  const existing = Object.values(apples)
    .filter(a=>a.playerId===player.id&&!a.eaten&&a.arcLeft===0)
    .sort((a,b)=>a.x-b.x);
  for (const ea of existing) {
    if (Math.abs(targetX-ea.x)<MIN_APPLE_GAP) targetX = ea.x+MIN_APPLE_GAP;
  }
  targetX = Math.min(targetX, STREAM_RIGHT+200); // can overshoot right temporarily

  const pos = ANIMAL_POS[animal];
  const id  = nextAppleId++;
  apples[id] = {
    id, playerId:player.id, laneIdx:player.laneIdx,
    x:targetX, arcLeft:ARC_TICKS,
    problem, answer, isCorrect, animal,
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

    // Spawn apples
    if (now >= player.nextSpawnTime) {
      spawnApple(player);
      player.nextSpawnTime = now + spawnInterval(player.level);
    }

    // Red bird (level 10+)
    if (player.level >= 10 && !player.birdActive) {
      player.birdCooldown -= 33;
      if (player.birdCooldown <= 0) {
        player.birdActive = true;
        player.birdCooldown = randInt(15000, 45000);
        io.emit('birdSpawned', {playerId:pid, laneIdx:player.laneIdx});

        // After travel time: snatch rightmost correct apple in this lane
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

  // Move apples left
  for (const id in apples) {
    const a = apples[id];
    if (a.eaten) { delete apples[id]; continue; }
    if (a.arcLeft > 0) { a.arcLeft--; continue; }
    a.x -= APPLE_SPEED;
    if (a.x < -60) { io.emit('appleMissed', a.id); delete apples[id]; }
  }

  // Cascade overlap prevention per player
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
      socket.emit('levelUp', {...base, level:player.level, targetNumber:player.targetNumber, levelAppleCount:0});
    } else {
      player.targetNumber = newTarget(player.level);
      socket.emit('goodEat', {...base, targetNumber:player.targetNumber});
    }
  } else {
    player.score = Math.max(0, player.score - 5);
    player.consecutiveCorrect = 0;
    if (player.canSteal) { player.canSteal=false; io.emit('stealZoneUpdate', getStealers()); }

    if (player.levelAppleCount > 0) {
      player.levelAppleCount--;
      socket.emit('badEat', {score:player.score, levelAppleCount:player.levelAppleCount});
    } else if (player.level > 1) {
      player.level--;
      player.levelAppleCount = 0;
      player.targetNumber = newTarget(player.level);
      socket.emit('levelDown', {score:player.score, level:player.level, targetNumber:player.targetNumber, levelAppleCount:0});
    } else {
      player.lives--;
      if (player.lives <= 0) {
        player.active = false;
        socket.emit('gameOver', {finalLevel:player.level, score:player.score});
      } else {
        socket.emit('lostLife', {lives:player.lives, score:player.score, levelAppleCount:0});
      }
    }
  }
}

// ─── Socket connections ────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('Connected:', socket.id);
  let playerId = null;

  socket.emit('highScores', highScores);

  socket.on('joinGame', ({name}) => {
    if (playerId) return;
    const num = nextPlayerNum++;
    playerId = `player${num}`;
    const laneIdx = assignLane();
    laneOwner[laneIdx] = playerId;

    const cleanName = String(name||'').trim().slice(0,12) || 'Gator';
    players[playerId] = freshPlayer(playerId, socket.id, cleanName, laneIdx);
    const p = players[playerId];

    socket.emit('playerAssigned', {
      ...publicPlayer(p),
      gameState: {
        players: Object.fromEntries(Object.entries(players).map(([k,v])=>[k,publicPlayer(v)])),
        apples:  Object.values(apples),
      },
    });
    socket.broadcast.emit('playerJoined', publicPlayer(p));
    io.emit('stealZoneUpdate', getStealers());
    console.log(`${cleanName} joined as ${playerId} in lane ${laneIdx}`);
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

    // One apple per lane (rightmost in zone) from OTHER players — max 3
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
    Object.keys(apples).forEach(id => {
      if (apples[id].playerId===playerId) { io.emit('appleMissed', apples[id].id); delete apples[id]; }
    });
    const laneIdx = p.laneIdx;
    const name    = p.name;
    players[playerId] = freshPlayer(playerId, socket.id, name, laneIdx);
    const np = players[playerId];
    socket.emit('playerAssigned', {
      ...publicPlayer(np),
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Math Gator on port ${PORT}`));
