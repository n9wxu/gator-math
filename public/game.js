'use strict';
// ─── Canvas & scene geometry ──────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

const CANVAS_W   = 950;
const CANVAS_H   = 500;
const APPLE_SPEED = 2.5;
const GROUND_Y   = 270;
const STREAM_TOP = 285;
const STREAM_BOT = 485;
const LANE_COUNT = 4;
const LANE_H     = (STREAM_BOT - STREAM_TOP) / LANE_COUNT;  // 50px

// Alligator sprite constants
const FRAME_H    = 724;
const FRAME_DATA = [
  {sx:  18, sw:353},  // 0 idle
  {sx: 380, sw:355},  // 1 slight open
  {sx: 743, sw:360},  // 2 half open
  {sx:1103, sw:340},  // 3 fully open
  {sx:1459, sw:355},  // 4 good eat
  {sx:1814, sw:353},  // 5 bad eat
];
const FRAMES = {idle:0,slightOpen:1,halfOpen:2,open:3,goodEat:4,badEat:5};

const GATOR_SCALE  = 0.30;
const FRAME_REF_W  = 353;
const SPRITE_W     = Math.round(FRAME_REF_W * GATOR_SCALE);   // 106
const SPRITE_H     = Math.round(FRAME_H     * GATOR_SCALE);   // 217
const WATER_FRAC   = 378 / 724;   // fraction of sprite below waterline
const SCORE_STRIP  = 60;          // px reserved on left for score/name

// My gator is positioned right of score strip
const MY_SPRITE_X  = SCORE_STRIP;
const MY_MOUTH_X   = MY_SPRITE_X + SPRITE_W;  // 166

// Badge position constants (relative offsets from sprite origin)
const BADGE_OX = Math.round(125 * (SPRITE_W / FRAME_REF_W));
const BADGE_OY = Math.round(424 * (SPRITE_H / FRAME_H));
const BADGE_R  = Math.round(40.5 * GATOR_SCALE);

// Steal zone (x range in stream, just past mouth) — 1 apple wide (~42px)
const STEAL_ZONE_X = MY_MOUTH_X + 4;
const STEAL_ZONE_W = 42;  // matches server STEAL_ZONE_RIGHT - LEFT

// Apple sprite constants
const APPLE_SLOT_W    = 627;
const APPLE_SLOT_H    = 627;
const GREEN_APPLE_W   = 1254;
const GREEN_APPLE_H   = 1254;
const APPLE_CONTENT_W = 537;
const APPLE_R         = 18;
const APPLE_DRAW      = Math.round(APPLE_R * 2 * APPLE_SLOT_W / APPLE_CONTENT_W);
const ARC_TICKS       = 45;
const MIN_APPLE_GAP   = 44;
const APPLE_FRAME     = {monkey:0, gorilla:1, orangutan:3};

// Animal sprite constants
// dispH reduced so all 4 animals fit side-by-side without overlap
const ANIMAL_SP = {
  monkey:    {slotW:418, slotH:627, dispH:95},
  gorilla:   {slotW:443, slotH:591, dispH:95},
  orangutan: {slotW:438, slotH:598, dispH:95},
  parrot:    {slotW:362, slotH:724, dispH:95},
};
const ANIM_SEQ = {
  idle0:         {frame:0, dur:45, next:'idle1'},
  idle1:         {frame:1, dur:45, next:'idle0'},
  windup:        {frame:2, dur:12, next:'release'},
  release:       {frame:3, dur:8,  next:'followthrough'},
  followthrough: {frame:4, dur:10, next:'recovery'},
  recovery:      {frame:5, dur:14, next:'idle0'},
};
const ANIMAL_LABEL = {monkey:'+', gorilla:'−', orangutan:'×', parrot:'÷'};

// Leaderboard panel
const LB_X = 808;
const LB_W = CANVAS_W - LB_X - 2;  // 140px

// Bird sprite constants
const BIRD_FRAME_W = 256;   // 1536/6
const BIRD_FRAME_H = 1024;
// display: scale so visible height ≈ 44px (fits in lane)
const BIRD_DISP_H  = 44;
const BIRD_DISP_W  = Math.round(BIRD_FRAME_W / BIRD_FRAME_H * BIRD_DISP_H);  // ~11px — too thin, use 48
// Override: display bird 48px wide (squish/stretch intentionally)
const BIRD_W = 48;
const BIRD_H = Math.round(BIRD_FRAME_H / BIRD_FRAME_W * BIRD_W);  // 192

// ─── Image loading ────────────────────────────────────────────────────────────
const gatorImg     = new Image(); gatorImg.src     = '/assets/alligator.png';
const appleImg     = new Image(); appleImg.src     = '/assets/apples.png';
const greenAppleImg= new Image(); greenAppleImg.src= '/assets/apple_green.png';
const monkeyImg    = new Image(); monkeyImg.src    = '/assets/monkey.png';
const gorillaImg   = new Image(); gorillaImg.src   = '/assets/gorilla.png';
const orangutanImg = new Image(); orangutanImg.src = '/assets/orangutan.png';
const parrotImg    = new Image(); parrotImg.src    = '/assets/parrot.png';
const backgroundImg= new Image(); backgroundImg.src= '/assets/background.png';
const heroImg      = new Image(); heroImg.src      = '/assets/hero.png';
const heroineImg   = new Image(); heroineImg.src   = '/assets/heroine.png';
const birdImg      = new Image(); birdImg.src      = '/assets/bird.png';

const ANIMAL_IMGS = {monkey:monkeyImg, gorilla:gorillaImg, orangutan:orangutanImg, parrot:parrotImg};

// Background constants
const BG_DISP_W    = Math.round(2244 * GROUND_Y / 701);
const BG_SCROLL_MAX= BG_DISP_W - CANVAS_W;

// Hero / heroine
const HERO_FRAMES      = Array.from({length:4},(_,i)=>({sx:i*700,sw:700}));
const HERO_SH          = 724;
const HERO_DISP_H      = 110;
const HEROINE_FRAMES   = Array.from({length:5},(_,i)=>({sx:i*500,sw:500}));
const HEROINE_SH       = 793;
const HEROINE_DISP_H   = 154;  // 220 * 0.7
const SWING_SPEED      = 4;
const SWING_FRM_TICKS  = 38;

// ─── Game state ───────────────────────────────────────────────────────────────
let socket       = null;
let myPlayerId   = null;
let myName       = '';
let myLaneIdx    = 3;
let myTargetNumber = null;
let myScore      = 0;
let myLevel      = 1;
let myAppleCount = 0;  // progress toward level-up (0-4)
let myLives      = 3;
let gamePhase    = 'name-entry';  // 'name-entry'|'playing'|'gameover'|'scores'
let highScores   = [];
let mouthOpen    = false;
let apples       = [];
let players      = {};   // id → publicPlayer
let particles    = [];
let stealers     = [];   // player ids who currently canSteal
let liveScores   = [];   // [{id,name,score,level,laneIdx}]

let myAppleSlots = [];   // up to 5 animal names for banked good apples

let streamOffset    = 0;
let gatorAnimState  = 'idle';
let gatorAnimTimer  = 0;

let heroSwing    = {active:false, x:0, y:0, frame:0, tick:0, cooldown:300};
let heroineSwing = {active:false, x:0, y:0, frame:0, tick:0, cooldown:180};

// X positions spaced so animals don't overlap at dispH=95
// widths: monkey≈63, gorilla≈71, orangutan≈70, parrot≈48; gap=6px between
let jungleAnimals = [
  {x:566, y:GROUND_Y-185*0.68, type:'monkey',    animState:'idle0', animTimer:45},
  {x:639, y:GROUND_Y-200*0.68, type:'gorilla',   animState:'idle0', animTimer:22},
  {x:716, y:GROUND_Y-192*0.68, type:'orangutan', animState:'idle0', animTimer:33},
  {x:781, y:GROUND_Y-175*0.68, type:'parrot',    animState:'idle1', animTimer:15},
];

// Per-lane bird state
let birds = Array.from({length:4}, ()=>({active:false, x:1100, frame:0, frameTick:0}));

let _tick = 0;

// ─── Lane helpers ─────────────────────────────────────────────────────────────
function getLaneY(laneIdx) {
  return STREAM_TOP + laneIdx * LANE_H + LANE_H / 2;
}
function getLaneTop(laneIdx)    { return STREAM_TOP + laneIdx * LANE_H; }
function getMouthY()            { return getLaneY(3); }  // my gator always in visual lane 3

// Map a server-assigned lane to the visual lane shown on screen.
// My lane always maps to visual lane 3 (bottom); others map to 0-2.
function getVisualLane(serverLane) {
  if (myLaneIdx === null || myLaneIdx === undefined) return serverLane;
  if (serverLane === myLaneIdx) return 3;
  const others = [0, 1, 2, 3].filter(l => l !== myLaneIdx);
  const idx = others.indexOf(serverLane);
  return idx === -1 ? serverLane : idx;
}

function getAppleLaneY(apple)   { return getLaneY(getVisualLane(apple.laneIdx ?? 0)); }

// ─── Name entry ───────────────────────────────────────────────────────────────
const nameOverlay = document.createElement('div');
nameOverlay.id = 'nameOverlay';
nameOverlay.style.cssText = [
  'position:absolute','top:0','left:0','width:950px','height:500px',
  'display:flex','flex-direction:column','align-items:center','justify-content:center',
  'z-index:80','pointer-events:auto',
].join(';');
nameOverlay.innerHTML = `
  <div style="color:#FFD700;font-size:56px;font-family:'Arial Black',Arial,sans-serif;
       text-shadow:3px 4px 12px #000,0 0 30px rgba(255,200,0,0.5);
       letter-spacing:4px;margin-bottom:8px;">GATOR MATH</div>
  <div style="color:rgba(255,255,255,0.75);font-size:18px;font-family:Arial,sans-serif;
       margin-bottom:28px;text-shadow:1px 1px 4px #000;">Multiplayer Math Adventure</div>
  <input id="nameInput" type="text" maxlength="12" placeholder="Enter your name"
    style="font-size:22px;padding:12px 18px;border-radius:10px;border:2px solid #FFD700;
           background:rgba(26,10,46,0.90);color:white;text-align:center;width:260px;
           margin-bottom:18px;outline:none;font-family:Arial,sans-serif;
           box-shadow:0 0 16px rgba(255,200,0,0.3);">
  <button id="startBtn"
    style="font-size:22px;padding:12px 48px;border-radius:10px;background:#FFD700;
           color:#1a0a2e;border:none;cursor:pointer;font-weight:900;
           font-family:'Arial Black',Arial,sans-serif;letter-spacing:2px;
           box-shadow:0 4px 16px rgba(0,0,0,0.4);
           -webkit-tap-highlight-color:transparent;">
    START!
  </button>
`;
document.getElementById('gameContainer').appendChild(nameOverlay);

document.getElementById('startBtn').addEventListener('click', doStart);
document.getElementById('nameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doStart();
});
setTimeout(() => { const ni = document.getElementById('nameInput'); if(ni) ni.focus(); }, 100);

function doStart() {
  const ni = document.getElementById('nameInput');
  myName = (ni ? ni.value.trim() : '') || 'Gator';
  nameOverlay.style.display = 'none';
  gamePhase = 'waiting';
  connectSocket();
}

// ─── Socket connection ────────────────────────────────────────────────────────
function connectSocket() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('joinGame', {name: myName});
  });

  socket.on('playerAssigned', d => {
    myPlayerId    = d.id;
    myLaneIdx     = d.laneIdx;
    myTargetNumber= d.targetNumber;
    myLives       = d.lives || 3;
    myLevel       = d.level || 1;
    myScore       = d.score || 0;
    myAppleCount  = d.levelAppleCount || 0;
    players       = d.gameState.players || {};
    apples        = d.gameState.apples  || [];
    gamePhase     = 'playing';
  });

  socket.on('playerJoined',  p  => { players[p.id] = p; });
  socket.on('playerLeft',    id => { if(players[id]) players[id].active=false; });
  socket.on('playerUpdate',  d  => { if(players[d.playerId]) players[d.playerId].mouthOpen=d.mouthOpen; });

  socket.on('playerScoresUpdate', scores => { liveScores = scores; });

  socket.on('stealZoneUpdate', ids => { stealers = ids; });

  socket.on('appleSpawned', a => {
    if (!apples.find(x=>x.id===a.id)) apples.push(a);
    const thrower = jungleAnimals.find(j=>j.type===a.animal&&(j.animState==='idle0'||j.animState==='idle1'));
    if (thrower) { thrower.animState='windup'; thrower.animTimer=ANIM_SEQ.windup.dur; }
  });

  socket.on('applesUpdate', sa => {
    sa.forEach(s => {
      const l = apples.find(a=>a.id===s.id);
      if (l) {
        const wasArc = l.arcLeft>0;
        l.arcLeft = s.arcLeft;
        l.laneIdx = s.laneIdx;
        if (wasArc && l.arcLeft===0) { l.x=s.x; l.landCooldown=20; }
        else { l.x += (s.x-l.x)*0.3; }
      } else { apples.push(s); }
    });
    const ids = new Set(sa.map(a=>a.id));
    apples = apples.filter(a=>ids.has(a.id));
  });

  socket.on('appleEaten', d => { apples=apples.filter(a=>a.id!==d.appleId); });
  socket.on('appleMissed', id => { apples=apples.filter(a=>a.id!==id); });

  socket.on('goodEat', data => {
    myScore=data.score; myTargetNumber=data.targetNumber; myAppleCount=data.levelAppleCount;
    if (data.animal) { myAppleSlots.push(data.animal); if(myAppleSlots.length>5) myAppleSlots.shift(); }
    gatorAnimState='goodEat'; gatorAnimTimer=45;
    spawnGoodParticles(MY_MOUTH_X, getMouthY());
    if (data.canSteal) flashMsg('STEAL READY!<br>Press S to steal!','#FFD700',2000);
  });

  socket.on('badEat', data => {
    myScore=data.score; myAppleCount=data.levelAppleCount;
    if (myAppleSlots.length>0) myAppleSlots.pop();
    gatorAnimState='badEat'; gatorAnimTimer=30;
    spawnBadParticles(MY_MOUTH_X, getMouthY());
    canvas.style.boxShadow='0 0 40px rgba(255,0,0,0.9)';
    setTimeout(()=>canvas.style.boxShadow='0 0 40px rgba(0,255,100,0.3)',400);
  });

  socket.on('levelUp', data => {
    myLevel=data.level; myTargetNumber=data.targetNumber; myAppleCount=0; myScore=data.score;
    myAppleSlots=[];
    flashMsg(`LEVEL UP!<br>Level ${myLevel}`,'#FFD700',2800);
  });

  socket.on('levelDown', data => {
    myLevel=data.level; myScore=data.score; myAppleCount=data.levelAppleCount; myTargetNumber=data.targetNumber;
    myAppleSlots=[];
    gatorAnimState='badEat'; gatorAnimTimer=30;
    spawnBadParticles(MY_MOUTH_X, getMouthY());
    canvas.style.boxShadow='0 0 50px rgba(255,80,0,0.9)';
    setTimeout(()=>canvas.style.boxShadow='0 0 40px rgba(0,255,100,0.3)',500);
    flashMsg(`LEVEL DOWN<br>Level ${myLevel}`,'#FF6622',2500);
  });

  socket.on('lostLife', data => {
    myLives=data.lives; myScore=data.score; myAppleCount=data.levelAppleCount;
    myAppleSlots=[];
    gatorAnimState='badEat'; gatorAnimTimer=30;
    spawnBadParticles(MY_MOUTH_X, getMouthY());
    canvas.style.boxShadow='0 0 60px rgba(255,0,0,1)';
    setTimeout(()=>canvas.style.boxShadow='0 0 40px rgba(0,255,100,0.3)',700);
    flashMsg(`OUCH!<br>${myLives} ${myLives===1?'life':'lives'} left`,'#FF3333',2200);
  });

  socket.on('gameOver', () => {
    gamePhase='gameover';
    closeMouth();
    document.getElementById('finalLevelDisplay').textContent=`You reached Level ${myLevel}`;
    document.getElementById('playerNameInput').value=myName||'';
    gameOverOverlay.style.display='flex';
    setTimeout(()=>document.getElementById('playerNameInput').focus(),120);
  });

  socket.on('stealResult', data => {
    const color = data.scoreChange>=0?'#FFD700':'#FF6622';
    const sign  = data.scoreChange>=0?'+':'';
    myScore = data.newScore;
    flashMsg(`STOLEN! ${sign}${data.scoreChange}<br>${data.stolen} apple${data.stolen!==1?'s':''}`,color,2000);
    spawnGoodParticles(MY_MOUTH_X + 80, getMouthY());
  });

  socket.on('highScores', scores => { highScores=scores; });

  // Bird events
  socket.on('birdSpawned', ({laneIdx}) => {
    birds[laneIdx] = {active:true, x:CANVAS_W+60, frame:0, frameTick:0};
  });
  socket.on('birdSnatched', ({appleId, laneIdx}) => {
    apples = apples.filter(a=>a.id!==appleId);
    spawnBadParticles(500, getLaneY(laneIdx));
    flashMsg('BIRD STOLE YOUR APPLE!','#FF3333',1800);
  });
  socket.on('birdGone', ({laneIdx}) => {
    birds[laneIdx].active = false;
  });
}

// ─── Game-over overlay ────────────────────────────────────────────────────────
const gameOverOverlay = document.createElement('div');
gameOverOverlay.style.cssText=[
  'display:none','position:absolute','top:0','left:0',
  'width:950px','height:500px','background:rgba(0,0,0,0.87)',
  'flex-direction:column','align-items:center','justify-content:center',
  'z-index:50','pointer-events:auto',
].join(';');
gameOverOverlay.innerHTML=`
  <div style="color:#FFD700;font-size:52px;font-family:'Arial Black',Arial,sans-serif;
       margin-bottom:14px;text-shadow:2px 3px 10px #000;">GAME OVER</div>
  <div id="finalLevelDisplay"
       style="color:white;font-size:24px;font-family:Arial,sans-serif;margin-bottom:22px;"></div>
  <input id="playerNameInput" type="text" maxlength="18" placeholder="Enter your name"
    style="font-size:22px;padding:10px 16px;border-radius:8px;border:2px solid #FFD700;
           background:#1a0a2e;color:white;text-align:center;width:270px;
           margin-bottom:16px;outline:none;font-family:Arial,sans-serif;">
  <button id="submitScoreBtn"
    style="font-size:20px;padding:10px 30px;border-radius:8px;background:#FFD700;
           color:#1a0a2e;border:none;cursor:pointer;font-weight:bold;
           font-family:'Arial Black',Arial,sans-serif;-webkit-tap-highlight-color:transparent;">
    Save Score
  </button>
`;
document.getElementById('gameContainer').appendChild(gameOverOverlay);
document.getElementById('submitScoreBtn').addEventListener('click', submitScore);
document.getElementById('playerNameInput')?.addEventListener('keydown', e=>{
  if(e.key==='Enter') submitScore();
});

function submitScore() {
  const name=document.getElementById('playerNameInput').value.trim()||myName||'Anonymous';
  if (socket) socket.emit('submitScore',{name,level:myLevel,score:myScore});
  gameOverOverlay.style.display='none';
  gamePhase='scores';
}

// ─── Drawing: Background ──────────────────────────────────────────────────────
function drawBackground() {
  if (backgroundImg.complete && backgroundImg.naturalWidth) {
    const scroll = Math.floor(streamOffset*0.1) % (BG_SCROLL_MAX+1);
    ctx.drawImage(backgroundImg, 0, 0, 2244, 701, -scroll, 0, BG_DISP_W, GROUND_Y);
  } else {
    ctx.fillStyle='#2a5a1a'; ctx.fillRect(0,0,CANVAS_W,GROUND_Y);
  }

  // Grass bank top
  const bankGrad=ctx.createLinearGradient(0,GROUND_Y,0,STREAM_TOP);
  bankGrad.addColorStop(0,'#4a8020'); bankGrad.addColorStop(1,'#2a5010');
  ctx.fillStyle=bankGrad; ctx.fillRect(0,GROUND_Y,CANVAS_W,STREAM_TOP-GROUND_Y);
  ctx.fillStyle='#5aaa28';
  for (let i=0;i<25;i++) {
    const gx=i*38;
    ctx.beginPath();
    ctx.moveTo(gx,STREAM_TOP); ctx.lineTo(gx-4,STREAM_TOP-10); ctx.lineTo(gx+3,STREAM_TOP-5);
    ctx.lineTo(gx+8,STREAM_TOP-12); ctx.lineTo(gx+14,STREAM_TOP-4); ctx.lineTo(gx+18,STREAM_TOP);
    ctx.fill();
  }

  // Stream water (4 lanes) with subtle separators
  const streamGrad=ctx.createLinearGradient(0,STREAM_TOP,0,STREAM_BOT);
  streamGrad.addColorStop(0,'#7BC8E8'); streamGrad.addColorStop(0.2,'#3a8ab8'); streamGrad.addColorStop(1,'#1a4a6a');
  ctx.fillStyle=streamGrad; ctx.fillRect(0,STREAM_TOP,CANVAS_W,STREAM_BOT-STREAM_TOP);

  // Lane separator lines
  ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1;
  for (let i=1;i<LANE_COUNT;i++) {
    const ly=STREAM_TOP+i*LANE_H;
    ctx.beginPath(); ctx.moveTo(SCORE_STRIP,ly); ctx.lineTo(LB_X,ly); ctx.stroke();
  }

  // Stream top edge
  ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(0,STREAM_TOP); ctx.lineTo(CANVAS_W,STREAM_TOP); ctx.stroke();

  drawStreamRipples();

  // Grass bank bottom
  const lbGrad=ctx.createLinearGradient(0,STREAM_BOT,0,CANVAS_H);
  lbGrad.addColorStop(0,'#2a5010'); lbGrad.addColorStop(1,'#5a3a1a');
  ctx.fillStyle=lbGrad; ctx.fillRect(0,STREAM_BOT,CANVAS_W,CANVAS_H-STREAM_BOT);
  ctx.fillStyle='#4aaa28';
  for (let i=0;i<14;i++) {
    const gx=i*70+5;
    ctx.beginPath();
    ctx.moveTo(gx,STREAM_BOT); ctx.lineTo(gx-5,STREAM_BOT+13);
    ctx.lineTo(gx+4,STREAM_BOT+7); ctx.lineTo(gx+9,STREAM_BOT+15); ctx.lineTo(gx+14,STREAM_BOT);
    ctx.fill();
  }

  // Leaderboard panel background
  ctx.fillStyle='rgba(0,0,0,0.72)';
  ctx.fillRect(LB_X,0,LB_W,CANVAS_H);
  ctx.strokeStyle='rgba(255,215,0,0.4)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(LB_X,0); ctx.lineTo(LB_X,CANVAS_H); ctx.stroke();
}

function drawStreamRipples() {
  ctx.strokeStyle='rgba(255,255,255,0.20)'; ctx.lineWidth=1.5;
  for (let i=0;i<12;i++) {
    const wx=((-streamOffset*1.6+i*80)%960+960)%960-60;
    const wy=STREAM_TOP+18+(i%4)*22;
    ctx.beginPath(); ctx.moveTo(wx,wy);
    ctx.quadraticCurveTo(wx+24,wy-6,wx+48,wy); ctx.quadraticCurveTo(wx+72,wy+6,wx+96,wy); ctx.stroke();
  }
}

// ─── Drawing: Swings (Tarzan & Jane) ─────────────────────────────────────────
function updateDrawSwings() {
  if (heroSwing.active) {
    heroSwing.x+=SWING_SPEED;
    if (++heroSwing.tick>=SWING_FRM_TICKS) { heroSwing.tick=0; heroSwing.frame++; }
    if (heroSwing.x>900 || heroSwing.frame>=HERO_FRAMES.length) {
      heroSwing.active=false; heroSwing.cooldown=360+Math.floor(Math.random()*720);
    } else if (heroImg.complete && heroImg.naturalWidth) {
      const fd=HERO_FRAMES[heroSwing.frame];
      const dw=Math.round(fd.sw/HERO_SH*HERO_DISP_H);
      ctx.drawImage(heroImg,fd.sx,0,fd.sw,HERO_SH,heroSwing.x,heroSwing.y,dw,HERO_DISP_H);
    }
  } else {
    if (--heroSwing.cooldown<=0) {
      heroSwing.active=true; heroSwing.x=-150;
      heroSwing.y=25+Math.floor(Math.random()*110); heroSwing.frame=0; heroSwing.tick=0;
    }
  }
  if (heroineSwing.active) {
    heroineSwing.x-=SWING_SPEED;
    if (++heroineSwing.tick>=SWING_FRM_TICKS) { heroineSwing.tick=0; heroineSwing.frame++; }
    if (heroineSwing.x<-200 || heroineSwing.frame>=HEROINE_FRAMES.length) {
      heroineSwing.active=false; heroineSwing.cooldown=280+Math.floor(Math.random()*560);
    } else if (heroineImg.complete && heroineImg.naturalWidth) {
      const fd=HEROINE_FRAMES[heroineSwing.frame];
      const dw=Math.round(fd.sw/HEROINE_SH*HEROINE_DISP_H);
      ctx.drawImage(heroineImg,fd.sx,0,fd.sw,HEROINE_SH,heroineSwing.x,0,dw,HEROINE_DISP_H);
    }
  } else {
    if (--heroineSwing.cooldown<=0) {
      heroineSwing.active=true; heroineSwing.x=860;
      heroineSwing.frame=0; heroineSwing.tick=0;
    }
  }
}

// ─── Drawing: Jungle animals ─────────────────────────────────────────────────
function animalsForLevel(level) {
  if (level >= 7) return ['monkey','gorilla','orangutan','parrot'];
  return ({1:['monkey'],2:['gorilla'],3:['monkey','gorilla'],
           4:['orangutan'],5:['monkey','gorilla','orangutan'],6:['parrot']})[level] || ['monkey'];
}

function drawJungleAnimals() {
  // Show any animal that at least one active player needs
  const activeTypes = new Set(animalsForLevel(myLevel));
  liveScores.forEach(p => animalsForLevel(p.level).forEach(a => activeTypes.add(a)));
  Object.values(players).forEach(p => {
    if (p.active && p.level) animalsForLevel(p.level).forEach(a => activeTypes.add(a));
  });

  jungleAnimals.forEach(a => {
    if (!activeTypes.has(a.type)) return;
    if (--a.animTimer<=0) { a.animState=ANIM_SEQ[a.animState].next; a.animTimer=ANIM_SEQ[a.animState].dur; }

    const sp = ANIMAL_SP[a.type];
    const img= ANIMAL_IMGS[a.type];
    if (!img.complete||!img.naturalWidth) return;

    const frameIdx=ANIM_SEQ[a.animState].frame;
    const dispH=sp.dispH;
    const dispW=Math.round(sp.slotW/sp.slotH*dispH);
    let dx,dy;
    if (a.type==='orangutan') { dx=a.x-dispW/2; dy=a.y-120*0.42; }
    else                       { dx=a.x-dispW/2; dy=a.y-dispH/2; }

    ctx.drawImage(img,frameIdx*sp.slotW,0,sp.slotW,sp.slotH,dx,dy,dispW,dispH);

    ctx.fillStyle='#FFE08A'; ctx.strokeStyle='#000'; ctx.lineWidth=3;
    ctx.font='bold 15px Arial'; ctx.textAlign='center';
    ctx.strokeText(ANIMAL_LABEL[a.type],a.x,dy-4);
    ctx.fillText(ANIMAL_LABEL[a.type],a.x,dy-4);
  });
}

// ─── Drawing: Steal zone ──────────────────────────────────────────────────────
function drawStealZones() {
  if (stealers.length === 0) return;
  const pulse = 0.28 + 0.22 * Math.sin(_tick * 0.12);
  for (let li=0;li<LANE_COUNT;li++) {
    const laneTop = getLaneTop(li);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(STEAL_ZONE_X, laneTop+2, STEAL_ZONE_W, LANE_H-4);
    ctx.globalAlpha = pulse*1.5;
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    ctx.strokeRect(STEAL_ZONE_X, laneTop+2, STEAL_ZONE_W, LANE_H-4);
    ctx.restore();
  }
  // Label over my lane only
  const myLaneTop = getLaneTop(myLaneIdx);
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('STEAL ZONE', STEAL_ZONE_X + STEAL_ZONE_W/2, myLaneTop + LANE_H/2 + 4);
  ctx.restore();
}

// ─── Drawing: Birds ───────────────────────────────────────────────────────────
function updateDrawBirds() {
  for (let li=0;li<LANE_COUNT;li++) {
    const b = birds[li];
    if (!b.active) continue;
    // Move bird left
    b.x -= 6;
    if (b.x < -100) { b.active=false; continue; }
    // Cycle frame every 8 ticks
    if (++b.frameTick >= 8) { b.frameTick=0; b.frame=(b.frame+1)%6; }

    if (birdImg.complete && birdImg.naturalWidth) {
      const laneCenter = getLaneY(li);
      const sy = laneCenter - BIRD_H/2;
      ctx.save();
      // Flip horizontally (bird faces right in sprite, flies left)
      ctx.translate(b.x + BIRD_W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(birdImg, b.frame*BIRD_FRAME_W, 0, BIRD_FRAME_W, BIRD_FRAME_H,
        0, sy, BIRD_W, BIRD_H);
      ctx.restore();
    }
  }
}

// ─── Drawing: Alligator ──────────────────────────────────────────────────────
function drawGatorSprite(laneIdx, player, isMe) {
  const laneY   = getLaneY(laneIdx);
  const spriteY = Math.round(laneY - SPRITE_H * WATER_FRAC);

  let frameIdx = FRAMES.idle;
  if (isMe) {
    if      (gatorAnimState==='goodEat') frameIdx=FRAMES.goodEat;
    else if (gatorAnimState==='badEat')  frameIdx=FRAMES.badEat;
    else if (mouthOpen)                  frameIdx=FRAMES.open;
    else                                 frameIdx=FRAMES.idle;
    if (gatorAnimTimer>0) {
      gatorAnimTimer--;
      if (gatorAnimTimer===0) gatorAnimState=mouthOpen?'open':'idle';
    }
  } else {
    frameIdx = player?.mouthOpen ? FRAMES.open : FRAMES.idle;
  }

  const fd = FRAME_DATA[frameIdx];
  if (!gatorImg.complete || !gatorImg.naturalWidth) return;
  ctx.drawImage(gatorImg, fd.sx, 0, fd.sw, FRAME_H, MY_SPRITE_X, spriteY, SPRITE_W, SPRITE_H);

  // Badge (target number)
  const target = isMe ? myTargetNumber : player?.targetNumber;
  if (target != null) {
    const bx = MY_SPRITE_X + BADGE_OX;
    const by = spriteY + BADGE_OY;
    const numStr = String(target);
    const r = numStr.length>=3 ? 18 : BADGE_R;
    ctx.fillStyle='#4a7c20';
    ctx.beginPath(); ctx.arc(bx,by,r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#c8a000'; ctx.lineWidth=Math.max(2,Math.round(3*GATOR_SCALE));
    ctx.beginPath(); ctx.arc(bx,by,r,0,Math.PI*2); ctx.stroke();
    const fs=Math.round(r*(numStr.length<=1?1.4:numStr.length===2?1.05:0.78));
    ctx.font=`bold ${fs}px Arial Black`;
    ctx.textAlign='center';
    ctx.strokeStyle='#2a5a0a'; ctx.lineWidth=3;
    ctx.strokeText(numStr,bx,by+Math.round(r*0.38));
    ctx.fillStyle='#FFD700';
    ctx.fillText(numStr,bx,by+Math.round(r*0.38));
  }

  // Gold ring if mouth open
  if ((isMe && mouthOpen) || (!isMe && player?.mouthOpen)) {
    ctx.strokeStyle='rgba(255,215,0,0.8)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(MY_SPRITE_X+SPRITE_W/2, laneY, 14, 0, Math.PI*2); ctx.stroke();
  }
}

// Small gator circle (other players without full sprite slot)
function drawSmallGator(cx, cy, r) {
  ctx.fillStyle='#3a9a20';
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#5ab830';
  ctx.beginPath(); ctx.ellipse(cx,cy+r*0.22,r*0.68,r*0.36,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#FFD700';
  ctx.beginPath(); ctx.arc(cx-r*0.32,cy-r*0.2,r*0.26,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx+r*0.32,cy-r*0.2,r*0.26,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#111';
  ctx.beginPath(); ctx.arc(cx-r*0.32,cy-r*0.2,r*0.13,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx+r*0.32,cy-r*0.2,r*0.13,0,Math.PI*2); ctx.fill();
}

// ─── Drawing: Other player icon (compact, left side of lane) ─────────────────
function drawPlayerIcon(visualLaneIdx, player, pid) {
  const laneY = getLaneY(visualLaneIdx);
  const r = 18;
  const cx = MY_SPRITE_X + r + 2;

  drawSmallGator(cx, laneY, r);

  // Target number badge
  const target = player?.targetNumber;
  if (target != null) {
    const bx = cx + r + 10, br = 10;
    ctx.fillStyle='#4a7c20';
    ctx.beginPath(); ctx.arc(bx, laneY, br, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle='#c8a000'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(bx, laneY, br, 0, Math.PI*2); ctx.stroke();
    ctx.font='bold 10px Arial'; ctx.textAlign='center';
    ctx.strokeStyle='#2a5a0a'; ctx.lineWidth=2;
    ctx.strokeText(String(target), bx, laneY+4);
    ctx.fillStyle='#FFD700';
    ctx.fillText(String(target), bx, laneY+4);
  }

  // Name and score to the left
  const score = liveScores.find(s=>s.id===player?.id)?.score ?? player?.score ?? 0;
  ctx.textAlign='right'; ctx.strokeStyle='#000'; ctx.lineWidth=2;
  ctx.font='bold 11px Arial';
  ctx.strokeText(score, MY_SPRITE_X-2, laneY-4);
  ctx.fillStyle='#FFD700'; ctx.fillText(score, MY_SPRITE_X-2, laneY-4);
  ctx.font='9px Arial';
  ctx.strokeText(player?.name||'', MY_SPRITE_X-2, laneY+9);
  ctx.fillStyle='white'; ctx.fillText(player?.name||'', MY_SPRITE_X-2, laneY+9);

  if (stealers.includes(pid)) {
    ctx.font='bold 9px Arial'; ctx.textAlign='left'; ctx.fillStyle='#FFD700';
    ctx.fillText('★', cx + r*2 + 14, laneY-8);
  }
}

// ─── Drawing: Other players ───────────────────────────────────────────────────
function drawOtherPlayers() {
  Object.keys(players).forEach(pid => {
    if (pid===myPlayerId) return;
    const p=players[pid];
    if (!p||!p.active) return;
    drawPlayerIcon(getVisualLane(p.laneIdx ?? 0), p, pid);
  });
}

// ─── Drawing: Leaderboard ─────────────────────────────────────────────────────
function mergedLeaderboard() {
  // All live players always shown; add historical entries for inactive players
  const liveNames = new Set(liveScores.map(p=>p.name));
  const result = liveScores.map(p=>({name:p.name, score:p.score, level:p.level, live:true}));
  highScores.forEach(h => {
    if (!liveNames.has(h.name))
      result.push({name:h.name, score:h.score||0, level:h.level, date:h.date, live:false});
  });
  return result.sort((a,b)=>b.score-a.score);
}

function drawLeaderboard() {
  const x = LB_X + 5;

  ctx.fillStyle='#FFD700'; ctx.font='bold 13px Arial'; ctx.textAlign='center';
  ctx.fillText('SCORES', LB_X+LB_W/2, 20);
  ctx.strokeStyle='rgba(255,215,0,0.4)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(LB_X+4,26); ctx.lineTo(LB_X+LB_W-4,26); ctx.stroke();

  const board = mergedLeaderboard();
  if (board.length===0) {
    ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='11px Arial'; ctx.textAlign='center';
    ctx.fillText('No scores yet', LB_X+LB_W/2, 55);
    return;
  }

  board.slice(0,10).forEach((entry,i) => {
    const ey = 44 + i*43;
    const medal = ['🥇','🥈','🥉'][i] || `${i+1}.`;

    // Highlight active players
    if (entry.live) {
      ctx.fillStyle='rgba(255,255,120,0.10)';
      ctx.fillRect(LB_X+2, ey-14, LB_W-4, 30);
    }

    const nameCol = entry.live ? '#FFFF88'
      : i===0?'#FFD700':i===1?'#E0E0E0':i===2?'#CD7F32':'rgba(255,255,255,0.8)';
    ctx.fillStyle=nameCol;
    ctx.font=`${i<3||entry.live?'bold ':''} ${i<3?12:11}px Arial`;
    ctx.textAlign='left';
    // Truncate name to fit
    let name = entry.name;
    ctx.fillText(`${medal} ${name}`, x, ey);

    ctx.textAlign='right';
    ctx.font=`bold ${i<3?12:11}px Arial`;
    ctx.fillStyle=nameCol;
    ctx.fillText(String(entry.score), LB_X+LB_W-4, ey);

    if (!entry.live && entry.date) {
      ctx.fillStyle='rgba(255,255,255,0.30)'; ctx.font='9px Arial'; ctx.textAlign='right';
      ctx.fillText(entry.date, LB_X+LB_W-4, ey+13);
    }
    if (i<9) {
      ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(LB_X+4,ey+20); ctx.lineTo(LB_X+LB_W-4,ey+20); ctx.stroke();
    }
  });
}

// ─── Drawing: Apple counter + lives HUD ──────────────────────────────────────
const APPLE_COLORS = {monkey:'#e63946', gorilla:'#c44030', orangutan:'#d4782a', parrot:'#4caf50'};

function drawHUD() {
  // ── Top-left: dark panel with name, level, score ──────────────────────────
  ctx.fillStyle='rgba(0,0,0,0.62)';
  ctx.fillRect(2, 2, 160, 100);
  ctx.strokeStyle='rgba(255,215,0,0.35)'; ctx.lineWidth=1;
  ctx.strokeRect(2, 2, 160, 100);

  ctx.textAlign='left';
  ctx.font='bold 11px Arial';
  ctx.fillStyle='rgba(255,255,255,0.75)';
  ctx.fillText(myName, 8, 17);

  ctx.font='bold 36px Arial';
  ctx.strokeStyle='#000'; ctx.lineWidth=4;
  ctx.strokeText(`Lv.${myLevel}`, 8, 54);
  ctx.fillStyle='#FFD700';
  ctx.fillText(`Lv.${myLevel}`, 8, 54);

  ctx.font='bold 26px Arial';
  ctx.strokeStyle='#000'; ctx.lineWidth=3;
  ctx.strokeText(String(myScore), 8, 90);
  ctx.fillStyle='white';
  ctx.fillText(String(myScore), 8, 90);

  // ── Top-right: apple progress slots (left of leaderboard) ────────────────
  const ar=13, agap=6;
  const hudRight = LB_X - 8;
  const totalAppleW = 5*(ar*2+agap) - agap;
  const startAppleX = hudRight - totalAppleW + ar;
  const acy = 24;

  for (let i=0;i<5;i++) {
    const ax = startAppleX + i*(ar*2+agap);
    if (i < myAppleSlots.length) {
      const col = APPLE_COLORS[myAppleSlots[i]] || '#e63946';
      ctx.fillStyle=col;
      ctx.beginPath(); ctx.arc(ax,acy,ar,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.28)';
      ctx.beginPath(); ctx.arc(ax-4,acy-4,4,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#5a3a0a'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(ax,acy-ar); ctx.quadraticCurveTo(ax+4,acy-ar-6,ax+3,acy-ar-5); ctx.stroke();
    } else {
      ctx.strokeStyle='rgba(255,255,255,0.30)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(ax,acy,ar,0,Math.PI*2); ctx.stroke();
    }
  }

  // ── Lives (small gator circles, left of apple slots) ─────────────────────
  const lr=10, lgap=6;
  const totalLifeW = 3*(lr*2+lgap) - lgap;
  const startLifeX = startAppleX - ar - 18 - totalLifeW + lr;

  for (let i=0;i<3;i++) {
    const lx = startLifeX + i*(lr*2+lgap);
    if (i<myLives) drawSmallGator(lx, acy, lr);
    else {
      ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(lx,acy,lr,0,Math.PI*2); ctx.stroke();
    }
  }

  // ── Steal streak dots (below lives) ──────────────────────────────────────
  const myPlayer = players[myPlayerId];
  const streak = myPlayer?.consecutiveCorrect ?? 0;
  for (let i=0;i<STEAL_STREAK;i++) {
    const sx = startLifeX + i*(lr*1.5);
    ctx.beginPath(); ctx.arc(sx, acy+lr+10, 4, 0, Math.PI*2);
    if (i<streak) { ctx.fillStyle='#FFD700'; ctx.fill(); }
    else { ctx.strokeStyle='rgba(255,215,0,0.35)'; ctx.lineWidth=1; ctx.stroke(); }
  }
  if (stealers.includes(myPlayerId)) {
    ctx.font='bold 9px Arial'; ctx.textAlign='left'; ctx.fillStyle='#FFD700';
    ctx.fillText('STEAL!(S)', startLifeX, acy+lr+24);
  }
}

// ─── Drawing: Score screen ────────────────────────────────────────────────────
function drawHighScores() {
  ctx.fillStyle='rgba(0,0,0,0.88)'; ctx.fillRect(0,0,CANVAS_W-LB_W,CANVAS_H);
  const cx=(CANVAS_W-LB_W)/2;
  ctx.fillStyle='#FFD700'; ctx.font='bold 38px "Arial Black",Arial'; ctx.textAlign='center';
  ctx.fillText('HIGH SCORES',cx,62);
  ctx.strokeStyle='#FFD700'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(cx-240,78); ctx.lineTo(cx+240,78); ctx.stroke();
  if (highScores.length===0) {
    ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='22px Arial';
    ctx.fillText('No scores yet!',cx,220);
  } else {
    highScores.forEach((entry,i) => {
      const y=118+i*36;
      const medal=['🥇','🥈','🥉'][i]||`${i+1}.`;
      ctx.fillStyle=i===0?'#FFD700':i===1?'#E0E0E0':i===2?'#CD7F32':'rgba(255,255,255,0.85)';
      ctx.font=`${i<3?'bold ':''} ${i<3?21:18}px Arial`;
      ctx.textAlign='left'; ctx.fillText(`${medal}  ${entry.name}`,cx-230,y);
      ctx.textAlign='right'; ctx.fillText(`Level ${entry.level}`,cx+230,y);
      if (entry.date) {
        ctx.fillStyle='rgba(255,255,255,0.38)'; ctx.font='13px Arial';
        ctx.fillText(entry.date,cx+230,y+14);
      }
    });
  }
  const pulse=0.6+0.4*Math.abs(Math.sin(Date.now()*0.002));
  ctx.globalAlpha=pulse; ctx.fillStyle='white'; ctx.font='bold 20px Arial';
  ctx.textAlign='center'; ctx.fillText('Tap or press SPACE to play again',cx,472);
  ctx.globalAlpha=1;
}

// ─── Drawing: Apples ─────────────────────────────────────────────────────────
function drawApple(apple) {
  if (apple.arcLeft>0) { drawAppleArc(apple); return; }
  const x   = apple.x;
  const ay  = getAppleLaneY(apple) + Math.sin(Date.now()*0.003+apple.id*0.8)*2;
  const half= APPLE_DRAW/2;

  ctx.fillStyle=apple.animal==='parrot'?'rgba(0,80,0,0.22)':'rgba(0,60,100,0.22)';
  ctx.beginPath(); ctx.ellipse(x,getAppleLaneY(apple)+4,APPLE_R-2,5,0,0,Math.PI*2); ctx.fill();

  if (apple.animal==='parrot') {
    if (greenAppleImg.complete&&greenAppleImg.naturalWidth>0)
      ctx.drawImage(greenAppleImg,0,0,GREEN_APPLE_W,GREEN_APPLE_H,x-half,ay-half,APPLE_DRAW,APPLE_DRAW);
  } else {
    const fi=APPLE_FRAME[apple.animal]??0;
    if (appleImg.complete&&appleImg.naturalWidth>0)
      ctx.drawImage(appleImg,fi*APPLE_SLOT_W,0,APPLE_SLOT_W,APPLE_SLOT_H,x-half,ay-half,APPLE_DRAW,APPLE_DRAW);
  }

  ctx.font='bold 13px Arial'; ctx.textAlign='center';
  ctx.strokeStyle='#111'; ctx.lineWidth=3; ctx.strokeText(apple.problem,x,ay+5);
  ctx.fillStyle='#fff'; ctx.fillText(apple.problem,x,ay+5);
}

function drawAppleArc(apple) {
  const t=(ARC_TICKS-apple.arcLeft)/ARC_TICKS;
  const laneY=getAppleLaneY(apple);
  const cx=apple.throwerX+(apple.x-apple.throwerX)*t;
  const cy=(apple.throwerY+(laneY-apple.throwerY)*t)-Math.sin(t*Math.PI)*80;
  const scale=0.25+0.75*t;
  const half=APPLE_DRAW/2*scale;
  const fi=APPLE_FRAME[apple.animal]??0;

  ctx.save();
  ctx.globalAlpha=0.35+0.65*t;
  if (apple.animal==='parrot') {
    if (greenAppleImg.complete&&greenAppleImg.naturalWidth>0)
      ctx.drawImage(greenAppleImg,0,0,GREEN_APPLE_W,GREEN_APPLE_H,cx-half,cy-half,APPLE_DRAW*scale,APPLE_DRAW*scale);
  } else if (appleImg.complete&&appleImg.naturalWidth>0) {
    ctx.drawImage(appleImg,fi*APPLE_SLOT_W,0,APPLE_SLOT_W,APPLE_SLOT_H,cx-half,cy-half,APPLE_DRAW*scale,APPLE_DRAW*scale);
  }
  ctx.restore();
  if (t>0.65) {
    const ta=(t-0.65)/0.35;
    ctx.save(); ctx.globalAlpha=ta;
    ctx.font=`bold ${Math.round(22*scale)}px Arial`; ctx.textAlign='center';
    ctx.strokeStyle='#111'; ctx.lineWidth=4; ctx.strokeText(apple.problem,cx,cy+8*scale);
    ctx.fillStyle='#fff'; ctx.fillText(apple.problem,cx,cy+8*scale);
    ctx.restore();
  }
}

// ─── Drawing: Particles ───────────────────────────────────────────────────────
function drawParticles() {
  particles=particles.filter(p=>p.life>0);
  particles.forEach(p=>{
    p.x+=p.vx; p.y+=p.vy; p.vy+=0.15; p.life--;
    ctx.globalAlpha=p.life/p.maxLife;
    ctx.fillStyle=p.color; ctx.font=`bold ${p.size}px Arial`; ctx.textAlign='center';
    ctx.fillText(p.text,p.x,p.y);
  });
  ctx.globalAlpha=1;
}
function spawnGoodParticles(x,y) {
  ['+10','★','★','✦','✦'].forEach((text,i)=>{
    particles.push({x,y,vx:(Math.random()-0.5)*5,vy:-3-Math.random()*3,
      life:50,maxLife:50,color:['#FFD700','#FFA500','#00FF88','#FFD700'][i%4],text,size:10+~~(Math.random()*12)});
  });
}
function spawnBadParticles(x,y) {
  ['−5','✗','✗'].forEach(text=>{
    particles.push({x,y,vx:(Math.random()-0.5)*4,vy:-2-Math.random()*2,
      life:30,maxLife:30,color:'#FF3333',text,size:13});
  });
}

// ─── Flash message ────────────────────────────────────────────────────────────
function flashMsg(html,color,duration) {
  const msg=document.getElementById('levelUpMsg');
  msg.innerHTML=html; msg.style.color=color; msg.style.borderColor=color; msg.style.display='block';
  setTimeout(()=>{msg.style.display='none';msg.style.color='#FFD700';msg.style.borderColor='#FFD700';},duration);
}

// ─── Collision detection ──────────────────────────────────────────────────────
function checkAppleCollisions() {
  if (!myPlayerId||!mouthOpen) return;
  const mouthY=getMouthY();
  apples.forEach(apple=>{
    if (apple.playerId!==myPlayerId) return;
    if (apple.eaten||apple.arcLeft>0||(apple.landCooldown||0)>0) return;
    const dx=apple.x-MY_MOUTH_X, dy=getAppleLaneY(apple)-mouthY;
    if (Math.sqrt(dx*dx+dy*dy)<50) {
      apple.eaten=true;
      if (socket) socket.emit('checkEat',apple.id);
    }
  });
}

// ─── Input ────────────────────────────────────────────────────────────────────
let spaceDown=false;
function openMouth() {
  if (gamePhase==='scores')   { handleRestart(); return; }
  if (gamePhase==='gameover') return;
  if (gamePhase!=='playing')  return;
  if (spaceDown) return;
  spaceDown=true; mouthOpen=true;
  if (socket) socket.emit('mouthToggle',true);
}
function closeMouth() {
  if (gamePhase!=='playing') { spaceDown=false; return; }
  spaceDown=false; mouthOpen=false;
  if (socket) socket.emit('mouthToggle',false);
}
function doSteal() {
  if (gamePhase!=='playing'||!socket) return;
  if (!stealers.includes(myPlayerId)) return;
  socket.emit('steal');
}

function handleRestart() {
  gamePhase='playing';
  myScore=0; myLevel=1; myAppleCount=0; myLives=3;
  apples=[]; particles=[];
  stealers=[]; myAppleSlots=[];
  if (socket) socket.emit('restartGame');
}

document.addEventListener('keydown', e=>{
  if (e.code==='Space')    { e.preventDefault(); openMouth(); }
  if (e.code==='KeyS'||e.key==='s'||e.key==='S') doSteal();
});
document.addEventListener('keyup', e=>{
  if (e.code==='Space') { e.preventDefault(); closeMouth(); }
});

canvas.addEventListener('touchstart', e=>{
  e.preventDefault();
  // Check if touching steal zone in my lane
  const rect=canvas.getBoundingClientRect();
  const scaleX=CANVAS_W/rect.width, scaleY=CANVAS_H/rect.height;
  const tx=(e.touches[0].clientX-rect.left)*scaleX;
  const ty=(e.touches[0].clientY-rect.top)*scaleY;
  const myLaneTop=getLaneTop(3);
  if (tx>=STEAL_ZONE_X&&tx<=STEAL_ZONE_X+STEAL_ZONE_W&&ty>=myLaneTop&&ty<=myLaneTop+LANE_H) {
    doSteal(); return;
  }
  openMouth();
},{passive:false});
canvas.addEventListener('touchend', e=>{ e.preventDefault(); closeMouth(); },{passive:false});

// ─── Main game loop ───────────────────────────────────────────────────────────
let lastFrameTime=performance.now();
function gameLoop() {
  requestAnimationFrame(gameLoop);
  const now=performance.now();
  const dt=Math.min(now-lastFrameTime,100);
  lastFrameTime=now;
  _tick++;

  ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
  ctx.globalAlpha=1;
  streamOffset=(streamOffset+1.5)%960;

  if (gamePhase==='name-entry'||gamePhase==='waiting') {
    // Just draw animated background behind the name overlay
    drawBackground();
    drawJungleAnimals();
    return;
  }

  try { drawBackground(); }      catch(e) { dlog(`ERR_BG ${e.message}`); }
  try { updateDrawSwings(); }    catch(e) { dlog(`ERR_SWING ${e.message}`); }
  try { drawJungleAnimals(); }   catch(e) { dlog(`ERR_JUNGLE ${e.message}`); }
  try { drawStealZones(); }      catch(e) { dlog(`ERR_STEAL ${e.message}`); }

  // Move apples client-side (smooth prediction)
  apples.forEach(a=>{
    if ((a.landCooldown||0)>0) a.landCooldown--;
    if (!a.eaten&&a.arcLeft===0) a.x-=APPLE_SPEED*dt/33;
  });

  if (gamePhase!=='scores') {
    apples.forEach(a=>{ try { drawApple(a); } catch(e) {} });
  }

  try { drawOtherPlayers(); }    catch(e) { dlog(`ERR_OTHERS ${e.message}`); }
  try { drawGatorSprite(3, null, true); } catch(e) { dlog(`ERR_GATOR ${e.message}`); }
  try { updateDrawBirds(); }     catch(e) { dlog(`ERR_BIRDS ${e.message}`); }
  try { drawParticles(); }       catch(e) { dlog(`ERR_PARTS ${e.message}`); }
  try { drawLeaderboard(); }     catch(e) { dlog(`ERR_LB ${e.message}`); }

  if (gamePhase==='scores') {
    try { drawHighScores(); } catch(e) {}
  } else {
    try { drawHUD(); } catch(e) {}
    if (gamePhase==='playing') checkAppleCollisions();
  }
}

function dlog(msg) { if(socket) socket.emit('clientLog',msg); }

// ─── Start loop after images load ────────────────────────────────────────────
const allImgs=[gatorImg,appleImg,greenAppleImg,monkeyImg,gorillaImg,orangutanImg,
               parrotImg,backgroundImg,heroImg,heroineImg,birdImg];
let loadedCount=0;
function onImgLoad() {
  if (++loadedCount===allImgs.length) gameLoop();
}
allImgs.forEach(img=>{
  if (img.complete&&img.naturalWidth>0) onImgLoad();
  else { img.addEventListener('load',onImgLoad); img.addEventListener('error',onImgLoad); }
});
