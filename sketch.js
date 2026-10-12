// p5.js 1.11.13
// 9:16 竖构图
// 点击暂停 / 继续
// R 重新铺水；S 保存图片
// ↑/↓ 调山高；←/→ 调山脊起伏

const W = 720;
const H = 1280;

// 浏览器视口适配：内部坐标仍按 720×1280 设计，
// 显示时整体缩放为 360×640（9:16），一屏看全不滚动
const VIEW_W = 450;
const VIEW_H = 800;
const SCALE = VIEW_W / W;

const CENTER_X = 360;
const SOURCE_LEFT = 260;
const SOURCE_RIGHT = 460;
const SOURCE_Y = 400;
const POOL_Y = 1205;

const SPAWN_PER_FRAME = 14;
const MAX_PARTICLES = 1600;

// ===========================
// 瀑布粒子轨迹痕迹（可直接调整）
// ===========================
const TRACE_POINTS = 22;        // 轨迹长度：记录的历史点数，越多痕迹越长
const TRACE_BRIGHTNESS = 0.4;   // 轨迹亮度：0 透明 ~ 1 最亮
const TRACE_WIDTH = 1.2;        // 轨迹粗细（像素）

let noiseStep = 0.015;
let saddleDepth = 330;
let bumpAmp = 130;
let mountainOffset = 0;

let backdrop;
let trails;
let sparkImage;

let particles = [];
let sprays = [];
let skyDust = [];
let time = 0;
let playing = true;

let branches = [];
let sourceBranch;

function setup() {
  createCanvas(VIEW_W, VIEW_H);
  pixelDensity(1);

  randomSeed(24);
  noiseSeed(24);
  mountainOffset = random() * 100;

  backdrop = createGraphics(W, H);
  backdrop.pixelDensity(1);
  paintBackdrop();

  // 蓝色天空中的漂浮微粒
  for (let i = 0; i < 600; i++) {
    skyDust.push(spawnSkyDust({}));
  }

  trails = createGraphics(W, H);
  trails.pixelDensity(1);
  trails.clear();

  sparkImage = makeSpark();
  buildBranches();

  for (let i = 0; i < 500; i++) {
    const p = makeParticle();
    scatterParticle(p);
    particles.push(p);
  }
}

function draw() {
  scale(SCALE);

  if (playing) {
    fadeTrails();
    trails.filter(BLUR);
    updateWater();
    updateSprays();
  }

  image(backdrop, 0, 0);

  drawSkyDust();

  image(trails, 0, 0);

  drawHeads();
  drawFlashes();
}

// ===========================
// 背景：蓝色夜空 + 黑色山体
// ===========================

function paintBackdrop() {
  const ctx = backdrop.drawingContext;
  const blue = ctx.createLinearGradient(0, 0, W, H);

  blue.addColorStop(0, "#1C20A7");
  blue.addColorStop(0.6, "#1B20A0");
  blue.addColorStop(1, "#161A87");

  ctx.fillStyle = blue;
  ctx.fillRect(0, 0, W, H);

  const haze = ctx.createRadialGradient(
    CENTER_X, SOURCE_Y, 30,
    CENTER_X, SOURCE_Y, 300
  );

  haze.addColorStop(0, "rgba(103,128,212,0.14)");
  haze.addColorStop(1, "rgba(103,128,212,0)");

  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, W, H);

  drawMountains();
}

function ridgeY(x) {
  const d = Math.abs(x - CENTER_X) / (W / 2);
  const envelope = Math.pow(d, 1.9) * saddleDepth;

  const bumpFade = constrain((d - 0.24) / 0.22, 0, 1);
  const bump =
    noise(mountainOffset + x * noiseStep) *
    bumpAmp *
    bumpFade;

  return SOURCE_Y - envelope - bump;
}

function drawMountains() {
  const ctx = backdrop.drawingContext;
  const mountain = new Path2D();

  mountain.moveTo(-4, H + 4);

  for (let x = -4; x <= W + 4; x += 2) {
    mountain.lineTo(x, ridgeY(x));
  }

  mountain.lineTo(W + 4, H + 4);
  mountain.closePath();

  const black = ctx.createLinearGradient(
    220, 200, 440, H
  );

  black.addColorStop(0, "#18151A");
  black.addColorStop(0.5, "#120F14");
  black.addColorStop(1, "#100D12");

  ctx.fillStyle = black;
  ctx.fill(mountain);
}

// ===========================
// 蓝色天空中的漂浮微粒
// ===========================

function spawnSkyDust(p) {
  p.x = random(-6, W + 6);
  p.y = random(-10, Math.max(20, ridgeY(p.x) - 12));
  p.vy = random(0.08, 0.3);          // 缓缓向下飘
  p.sway = random(0.4, 1.2);          // 左右摇摆的幅度
  p.tw = random(TWO_PI);
  p.bright = random() < 0.22;         // 少数更亮的微粒
  return p;
}

function drawSkyDust() {
  const ctx = drawingContext;

  for (const d of skyDust) {
    d.y += d.vy;
    d.x += Math.sin(time * 0.015 + d.tw) * d.sway * 0.15;

    // 飘到山脊就回到高空
    if (d.y >= ridgeY(d.x) - 8) {
      d.x = random(-6, W + 6);
      d.y = random(-30, 15);
    }

    // 蓝白微粒，明暗闪烁
    const wave = 0.5 + 0.5 * Math.sin(time * 0.05 + d.tw * 3);

    if (d.bright) {
      const a = 0.35 + 0.45 * wave;
      ctx.fillStyle = `rgba(235,242,255,${a})`;
      ctx.fillRect(d.x, d.y, 2.2, 2.2);
    } else {
      const a = 0.16 + 0.3 * wave;
      ctx.fillStyle = `rgba(196,208,250,${a})`;
      ctx.fillRect(d.x, d.y, 1.6, 1.6);
    }
  }
}

// ===========================
// 分支：主流粗，侧流细，下方逐渐展开
// ===========================

function buildBranches() {
  branches = [];

  // x：水流中心
  // bottom：落点高度
  // half：水流半宽
  // children：下一段水流
  // flow：分配水量的权重
  const node = (
    x,
    bottom,
    half,
    children = [],
    flow = 1
  ) => ({
    x,
    bottom,
    half,
    children,
    flow
  });

  sourceBranch = node(360, 590, 90, [
    // 左主支：向左下方展开
    node(310, 745, 70, [
      node(255, 900, 55, [
        node(200, 1050, 42, [
          node(140, POOL_Y, 36)
        ], 0.6),
        node(300, 1030, 20, [
          node(315, POOL_Y, 16)
        ], 0.25),
        node(340, 1075, 14, [
          node(355, POOL_Y, 12)
        ], 0.15)
      ], 0.55),
      node(350, 890, 22, [
        node(318, 1030, 16, [
          node(295, POOL_Y, 13)
        ], 0.5),
        node(385, 1060, 12, [
          node(398, POOL_Y, 10)
        ], 0.5)
      ], 0.45)
    ], 0.4),
    // 中间细流：近乎垂直落下
    node(400, 700, 18, [
      node(400, 900, 14, [
        node(392, 1080, 11, [
          node(385, POOL_Y, 9)
        ], 0.6),
        node(415, 1060, 8, [
          node(422, POOL_Y, 7)
        ], 0.4)
      ], 0.6),
      node(415, 1060, 8, [
        node(422, POOL_Y, 7)
      ], 0.4)
    ], 0.2),
    // 右主支：向右下方展开
    node(430, 760, 45, [
      node(480, 910, 34, [
        node(525, 1060, 26, [
          node(575, POOL_Y, 22)
        ], 0.6),
        node(465, 1090, 12, [
          node(455, POOL_Y, 10)
        ], 0.4)
      ], 0.55),
      node(415, 940, 14, [
        node(390, 1090, 11, [
          node(375, POOL_Y, 9)
        ], 0.45),
        node(442, 1120, 9, [
          node(450, POOL_Y, 8)
        ], 0.55)
      ], 0.45)
    ], 0.4)
  ]);

  function collect(b, top, depth) {
    b.top = top;
    b.depth = depth;
    branches.push(b);

    for (const child of b.children) {
      collect(
        child,
        b.bottom + Math.abs(child.x - b.x) * 0.3 + 5,
        depth + 1
      );
    }
  }

  collect(sourceBranch, SOURCE_Y, 0);
}

// 按水量权重分流，不再平均分配粒子
function chooseBranch(children) {
  if (children.length === 1) {
    return children[0];
  }

  const total = children.reduce(
    (sum, b) => sum + b.flow,
    0
  );

  let choice = random(total);

  for (const child of children) {
    choice -= child.flow;

    if (choice < 0) {
      return child;
    }
  }

  return children[children.length - 1];
}

// ===========================
// 原版粒子运动
// StaircaseWaterway 原作：はぅ君
// ===========================

function makeParticle() {
  const p = {};
  resetParticle(p);
  return p;
}

function resetParticle(p) {
  p.x = random(SOURCE_LEFT, SOURCE_RIGHT);

  // 出生点高过山脊轮廓一点，让水帘盖住山体边缘
  p.y = ridgeY(p.x) - random(0, 10);

  p.g = 0;
  p.s = 3;

  p.branch = sourceBranch;
  p.colX = p.x;

  p.trace = [{ x: p.x, y: p.y }];

  p.sliding = false;
  p.nextBranch = null;
  p.slideDir = 0;
  p.slideRemain = 0;

  p.turnY = sourceBranch.bottom + random(-12, 12);

  p.alpha = random(0.35, 0.8);
  p.phase = random(TWO_PI);
  p.bright = random() < 0.075;

  p.reachedPool = false;
  p.poolDir = random(-0.4, 0.4);

  // 粒子外形：圆点、月牙、五角星各占约三分之一
  const roll = random();

  p.shape = roll < 1 / 3 ? "moon" : roll < 2 / 3 ? "star" : "dot";
  p.moonPhase = random(0.15, 1);   // 月牙饱满度：细 → 饱满
  p.rot = random(TWO_PI);
}

function beginBranchSlide(p) {
  const children = p.branch.children;

  if (!children.length) {
    p.reachedPool = true;
    p.g = 0;
    return;
  }

  const child = chooseBranch(children);

  p.nextBranch = child;
  p.targetX = child.x + random(-child.half, child.half);

  const dx = p.targetX - p.x;

  p.slideDir =
    (dx < 0 ? -1 : 1) * (1.4 + random() * 0.8);

  p.slideRemain = Math.abs(dx);
  p.sliding = true;
}

function scatterParticle(p) {
  const y = random(SOURCE_Y, H);
  let b = sourceBranch;

  while (b.children.length && y > b.bottom) {
    b = chooseBranch(b.children);
  }

  p.branch = b;
  p.x = b.x + random(-b.half, b.half);
  p.y = constrain(y, b.top, H);
  p.colX = p.x;

  p.turnY = b.children.length
    ? b.bottom + random(-9, 9)
    : POOL_Y;

  p.reachedPool = p.y >= POOL_Y;

  if (b.children.length && random() < 0.3) {
    p.y = p.turnY;
    beginBranchSlide(p);

    const portion = random();
    const distance = p.slideRemain * portion;

    p.x += Math.sign(p.slideDir) * distance;
    p.y += distance / Math.abs(p.slideDir) * 0.5;
    p.slideRemain -= distance;
  }

  p.trace = [{ x: p.x, y: p.y }];
}

// ===========================
// 水花
// ===========================

function splash(p) {
  if (sprays.length >= 150) return;

  sprays.push({
    x: p.x,
    y: p.y,
    vx: random(-1.8, 1.8),
    vy: random(-2.4, -0.6),
    age: 0,
    life: random(12, 26)
  });

  if (random() < 0.35 && sprays.length < 150) {
    sprays.push({
      x: p.x,
      y: p.y,
      vx: random(-1.8, 1.8),
      vy: random(-2.4, -0.6),
      age: 0,
      life: random(12, 26)
    });
  }
}

// ===========================
// 原版拖尾、噪声、下落速度
// ===========================

function fadeTrails() {
  const ctx = trails.drawingContext;

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 0.035;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function updateWater() {
  const ctx = trails.drawingContext;

  ctx.save();
  ctx.lineCap = "round";

  let i = SPAWN_PER_FRAME;

  while (i > 0) {
    i--;

    if (particles.length < MAX_PARTICLES) {
      particles.push(makeParticle());
    }

    time = time + 1;
  }

  for (const p of particles) {
    const oldX = p.x;
    const oldY = p.y;

    p.s = p.s * 0.997;

    const inPool = p.y > POOL_Y;
    const N = noise(p.x / W, p.y / 9, time / W);

    if (p.reachedPool) {
      if (N > 0.4) {
        p.g = Math.min(p.g + 0.5, 0.8);
        p.y += p.g;
      } else {
        p.g = 0;
        p.y += 0.5;
      }

      p.x += p.poolDir;
    } else if (!p.sliding) {
      if (N > 0.4) {
        p.g += 0.5;
        p.y += p.g;
      } else {
        p.g = 0;
        p.y += 0.5;
      }

      p.x += (N - 0.5) * 0.5;

      if (p.x < p.colX - 1) {
        p.x += 0.5;
      } else if (p.x > p.colX + 1) {
        p.x -= 0.5;
      }

      if (p.y >= p.turnY) {
        p.y = p.turnY;

        splash(p);
        beginBranchSlide(p);
      }
    } else {
      p.g = 0;
      p.y += 0.5;

      const step = Math.min(
        Math.abs(p.slideDir),
        p.slideRemain
      );

      p.x += Math.sign(p.slideDir) * step;
      p.slideRemain -= step;

      if (p.slideRemain <= 0) {
        p.sliding = false;
        p.branch = p.nextBranch;
        p.colX = p.x;

        p.turnY = p.branch.children.length
          ? Math.max(
              p.y + 8,
              p.branch.bottom + random(-9, 9)
            )
          : POOL_Y;
      }
    }

    // 在走过的路径上留下痕迹
    p.trace.push({ x: p.x, y: p.y });

    if (p.trace.length > TRACE_POINTS) {
      p.trace.shift();
    }

    if (p.y > H + 20 || p.s < 0.4) {
      resetParticle(p);
      continue;
    }

    const poolFade = inPool
      ? Math.max(
          0,
          1 - (p.y - POOL_Y) / (H + 10 - POOL_Y)
        )
      : 1;

    const depth = constrain(
      (p.y - SOURCE_Y) / (POOL_Y - SOURCE_Y),
      0,
      1
    );

    const widthScale = inPool
      ? 0.45
      : lerp(1, 0.45, depth);

    // 轨迹痕迹：把走过的路径描成一条细线
    if (p.trace.length > 1) {
      ctx.beginPath();
      ctx.moveTo(p.trace[0].x, p.trace[0].y);

      for (let i = 1; i < p.trace.length; i++) {
        ctx.lineTo(p.trace[i].x, p.trace[i].y);
      }

      ctx.strokeStyle = `rgba(214,222,250,${
        TRACE_BRIGHTNESS * p.alpha * poolFade
      })`;

      ctx.lineWidth = TRACE_WIDTH;
      ctx.stroke();
    }

    strokeLight(
      ctx,
      oldX, oldY,
      p.x, p.y,
      p.alpha * poolFade,
      p.s * widthScale
    );
  }

  ctx.restore();
}

function updateSprays() {
  const ctx = trails.drawingContext;

  ctx.save();
  ctx.lineCap = "round";

  for (let i = sprays.length - 1; i >= 0; i--) {
    const sp = sprays[i];
    const oldX = sp.x;
    const oldY = sp.y;

    sp.age++;

    if (sp.age >= sp.life) {
      sprays.splice(i, 1);
      continue;
    }

    sp.vy += 0.12;
    sp.x += sp.vx;
    sp.y += sp.vy;

    strokeLight(
      ctx,
      oldX, oldY,
      sp.x, sp.y,
      (1 - sp.age / sp.life) * 0.3,
      0.6
    );
  }

  ctx.restore();
}

// ===========================
// 原版水光与闪烁
// ===========================

function strokeLight(ctx, x0, y0, x1, y1, alpha, widthValue) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);

  ctx.lineWidth = widthValue * 4;
  ctx.strokeStyle = `rgba(163,180,242,${alpha * 0.10})`;
  ctx.stroke();

  ctx.lineWidth = Math.max(widthValue * 0.8, 0.6);
  ctx.strokeStyle = `rgba(238,239,255,${alpha})`;
  ctx.stroke();
}

function drawHeads() {
  const ctx = drawingContext;

  ctx.save();
  ctx.fillStyle = "#F1F2FF";

  for (const p of particles) {
    ctx.globalAlpha = p.bright ? 0.9 : p.alpha * 0.5;

    const r = (p.bright ? 1.8 : 0.9) / 2;

    if (p.shape === "moon") {
      drawCrescent(ctx, p.x, p.y, r, p.moonPhase, p.rot);
    } else if (p.shape === "star") {
      drawStar(ctx, p.x, p.y, r, p.rot);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const sp of sprays) {
    ctx.globalAlpha = (1 - sp.age / sp.life) * 0.6;
    ctx.fillRect(sp.x, sp.y, 1, 1);
  }

  ctx.restore();
}

// 月牙：phase 从 0（细如钩）到 1（饱满近圆），rot 为随机朝向
function drawCrescent(ctx, x, y, r, phase, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  const d = r * (0.2 + 0.55 * phase);

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.arc(d, -r * 0.1, r * 0.85, 0, Math.PI * 2);
  ctx.fill("evenodd");

  ctx.restore();
}

// 五角星
function drawStar(ctx, x, y, r, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  ctx.beginPath();

  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;

    if (i === 0) {
      ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    } else {
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }

  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawFlashes() {
  const ctx = drawingContext;

  ctx.save();

  for (const p of particles) {
    if (!p.bright) continue;

    const pulse = Math.pow(
      Math.max(0, Math.sin(time / 9 * 2.4 + p.phase)),
      18
    );

    if (pulse < 0.03) continue;

    ctx.globalAlpha = pulse * 0.75;

    const size = 18 + pulse * 18;

    ctx.drawImage(
      sparkImage,
      p.x - size / 2,
      p.y - size / 2,
      size,
      size
    );
  }

  ctx.restore();
}

function makeSpark() {
  const canvas = document.createElement("canvas");

  canvas.width = 64;
  canvas.height = 64;

  const ctx = canvas.getContext("2d");

  const glow = ctx.createRadialGradient(
    32, 32, 0,
    32, 32, 30
  );

  glow.addColorStop(0, "rgba(255,255,234,1)");
  glow.addColorStop(0.12, "rgba(255,246,204,0.70)");
  glow.addColorStop(0.45, "rgba(242,224,167,0.12)");
  glow.addColorStop(1, "rgba(242,224,167,0)");

  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);

  ctx.strokeStyle = "rgba(255,253,228,0.75)";
  ctx.lineWidth = 0.8;

  ctx.beginPath();
  ctx.moveTo(10, 32);
  ctx.lineTo(54, 32);
  ctx.moveTo(32, 20);
  ctx.lineTo(32, 44);
  ctx.stroke();

  return canvas;
}

// ===========================
// 操作
// ===========================

function mousePressed() {
  if (
    mouseX < 0 || mouseX > width ||
    mouseY < 0 || mouseY > height
  ) return;

  playing = !playing;

  if (playing) loop();
  else noLoop();
}

function layWater() {
  particles = [];
  time = 0;
  trails.clear();

  for (let i = 0; i < 500; i++) {
    const p = makeParticle();
    scatterParticle(p);
    particles.push(p);
  }
}

function keyPressed() {
  if (key === "s" || key === "S") {
    saveCanvas("cliff-night", "png");
  }

  if (key === "r" || key === "R") {
    layWater();
  }

  if (keyCode === UP_ARROW) {
    saddleDepth = Math.min(500, saddleDepth + 20);
    paintBackdrop();
  } else if (keyCode === DOWN_ARROW) {
    saddleDepth = Math.max(60, saddleDepth - 20);
    paintBackdrop();
  } else if (keyCode === LEFT_ARROW) {
    bumpAmp = Math.max(5, bumpAmp - 10);
    paintBackdrop();
  } else if (keyCode === RIGHT_ARROW) {
    bumpAmp = Math.min(260, bumpAmp + 10);
    paintBackdrop();
  }
}
