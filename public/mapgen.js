/* ============================================================
 * mapgen.js — 世界地图程序化生成器（纯函数，可 node 单测）
 * 三步法的第 ① 步：算法生成基础地图，同时产出结构化数据。
 *  - generateWorldMap(seed, opts) → { size, regions[], points[], grid, adjacency, seed }
 *    regions:  [{ id, name, biome, seedX, seedY }]          陆地划分的区域
 *    points:   [{ id, name, type, x, y, regionId, desc }]   路径点（城镇/地标）
 *    grid:     Uint8Array(size*size)，每像素存 regionId（0=海洋，1..n=区域）
 *    adjacency:[ [a,b], ... ]                                相邻区域对
 *  - renderWorldMap(canvas, mapData, opts)                  绘制到 canvas
 *  - mapHit(mapData, px, py, scale) → { kind:'point'|'region', ... }
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 工具 ---------- */
  const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* 平滑 value noise（1 个八度） */
  const makeNoise = (rng, size) => {
    const cell = 8; // 网格单元
    const gs = Math.ceil(size / cell) + 2;
    const g = [];
    for (let i = 0; i < gs * gs; i++) g.push(rng());
    const smooth = (t) => t * t * (3 - 2 * t);
    const at = (x, y) => {
      const gx = x / cell, gy = y / cell;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = smooth(gx - x0), fy = smooth(gy - y0);
      const i = (y0 * gs + x0);
      const a = g[i], b = g[i + 1], c = g[i + gs], d = g[i + gs + 1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
    return at;
  };

  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  /* ---------- 生成 ---------- */
  const BIOMES = ['平原', '森林', '山地', '湿地', '丘陵', '荒原'];

  function generateWorldMap(seed, opts) {
    opts = opts || {};
    const size = opts.size || 96;          // 网格边长
    const regionCount = opts.regionCount || 8;
    const landRatio = opts.landRatio || 0.58;
    const rng = mulberry32(seed);

    // 1) 高度场（2 个八度）+ 边缘衰减 → 大陆掩码
    const n1 = makeNoise(rng, size), n2 = makeNoise(rng, size * 2);
    const land = new Uint8Array(size * size);
    let landPixels = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const h = n1(x, y) * 0.7 + n2(x * 2, y * 2) * 0.3;
        // 边缘衰减：中心更容易成陆地 → 大陆块
        const cx = x / (size - 1) - 0.5, cy = y / (size - 1) - 0.5;
        const falloff = 1 - Math.min(1, Math.sqrt(cx * cx + cy * cy) * 1.6);
        const v = h * 0.55 + falloff * 0.45;
        if (v > 1 - landRatio) { land[y * size + x] = 1; landPixels++; }
      }
    }
    if (!landPixels) land[size * size >> 1] = 1; // 兜底

    // 2) 区域划分：陆地随机撒种子（拒绝过近）→ voronoi
    const seeds = [];
    let guard = 0;
    while (seeds.length < regionCount && guard++ < 2000) {
      const sx = Math.floor(rng() * size), sy = Math.floor(rng() * size);
      if (!land[sy * size + sx]) continue;
      if (seeds.some(s => dist2(s.x, s.y, sx, sy) < (size / regionCount) * (size / regionCount) * 0.55)) continue;
      seeds.push({ x: sx, y: sy });
    }
    // 确保种子落在陆地；若不足则用已有种子邻域补
    for (let i = seeds.length; i < regionCount && i < 20; i++) {
      const s = seeds[(i - 1) % seeds.length];
      for (let r = 1; r < size / 2; r++) {
        let placed = false;
        for (let dy = -r; dy <= r && !placed; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = s.x + dx, y = s.y + dy;
          if (x >= 0 && y >= 0 && x < size && y < size && land[y * size + x] && !seeds.some(t => t.x === x && t.y === y)) {
            seeds.push({ x, y }); placed = true; break;
          }
        }
        if (placed) break;
      }
      if (seeds.length === i) seeds.push({ x: s.x, y: Math.min(size - 1, s.y + 2) });
    }

    const grid = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!land[y * size + x]) continue;
        let best = -1, bd = Infinity;
        for (let i = 0; i < seeds.length; i++) {
          const d = dist2(x, y, seeds[i].x, seeds[i].y);
          if (d < bd) { bd = d; best = i; }
        }
        grid[y * size + x] = best + 1;
      }
    }

    // 3) 区域元数据 + 路径点
    const regions = seeds.map((s, i) => ({
      id: i + 1,
      name: '区域 ' + (i + 1),
      biome: BIOMES[Math.floor(rng() * BIOMES.length)],
      seedX: s.x, seedY: s.y,
    }));
    const points = [];
    const POINT_TYPES = ['城镇', '村落', '地标', '要塞', '渡口'];
    seeds.forEach((s, i) => {
      points.push({
        id: 'p' + (i + 1),
        name: regions[i].name + '中心',
        type: '城镇',
        x: s.x, y: s.y,
        regionId: i + 1,
        desc: regions[i].name + '（' + regions[i].biome + '）的中心聚落。',
      });
      // 每个区域随机 1 个次级路径点
      for (let k = 0; k < 1; k++) {
        let px = s.x, py = s.y, guard2 = 0;
        do {
          px = s.x + Math.floor((rng() - 0.5) * (size / 3));
          py = s.y + Math.floor((rng() - 0.5) * (size / 3));
          guard2++;
        } while ((px < 0 || py < 0 || px >= size || py >= size || !land[py * size + px] || grid[py * size + px] !== i + 1) && guard2 < 100);
        if (guard2 < 100) {
          points.push({
            id: 'p' + points.length + 1,
            name: regions[i].name + '·' + POINT_TYPES[1 + Math.floor(rng() * (POINT_TYPES.length - 1))],
            type: POINT_TYPES[1 + Math.floor(rng() * (POINT_TYPES.length - 1))],
            x: px, y: py,
            regionId: i + 1,
            desc: regions[i].name + '内的一处' + POINT_TYPES[1] + '。',
          });
        }
      }
    });

    // 4) 邻接：voronoi 共享边界（扫描相邻像素）
    const adj = new Set();
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const a = grid[y * size + x], b = grid[y * size + x + 1];
        const c = grid[(y + 1) * size + x];
        if (a && b && a !== b) adj.add(a < b ? a + ',' + b : b + ',' + a);
        if (a && c && a !== c) adj.add(a < c ? a + ',' + c : c + ',' + a);
      }
    }
    const adjacency = [...adj].map(s => s.split(',').map(Number));

    return { size, regions, points, grid, adjacency, seed, createdAt: Date.now() };
  }

  /* ---------- 命中检测 ---------- */
  /* canvas 像素坐标 (px,py)（0..size 网格坐标系）→ 命中 */
  function mapHit(map, px, py) {
    const { size, points, grid } = map;
    if (px < 0 || py < 0 || px >= size || py >= size) return null;
    // 路径点优先（半径 1.5 格）
    for (const p of points) {
      if (dist2(p.x, p.y, px, py) <= 2.25) return { kind: 'point', point: p, region: p.regionId };
    }
    const g = grid[py * size + px];
    if (g) return { kind: 'region', region: g };
    return { kind: 'ocean' };
  }

  /* ---------- 渲染 ---------- */
  const PALETTE = [
    '#8db36a', '#5f8f4e', '#a8926a', '#7d9c8a',
    '#c9b27a', '#6b8e6b', '#9aa86a', '#7a8f7a',
    '#b0a08a', '#8a9a6a', '#6e9a7e', '#a09a6a',
  ];
  function renderWorldMap(canvas, map, opts) {
    opts = opts || {};
    const px = opts.pixelSize || 10; // 每格像素
    const W = map.size * px;
    canvas.width = W; canvas.height = W;
    const ctx = canvas.getContext('2d');
    // 海洋
    ctx.fillStyle = opts.ocean || '#2c4a6e';
    ctx.fillRect(0, 0, W, W);
    // 陆地（区域色 + 细噪声纹理）
    for (let y = 0; y < map.size; y++) {
      for (let x = 0; x < map.size; x++) {
        const g = map.grid[y * map.size + x];
        if (!g) continue;
        ctx.fillStyle = PALETTE[(g - 1) % PALETTE.length];
        ctx.fillRect(x * px, y * px, px, px);
      }
    }
    // 区域边界（白线）
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    for (let y = 0; y < map.size - 1; y++) {
      for (let x = 0; x < map.size - 1; x++) {
        const a = map.grid[y * map.size + x], b = map.grid[y * map.size + x + 1];
        const c = map.grid[(y + 1) * map.size + x];
        if (a && b && a !== b) { ctx.beginPath(); ctx.moveTo((x + 1) * px, y * px); ctx.lineTo((x + 1) * px, (y + 1) * px); ctx.stroke(); }
        if (a && c && a !== c) { ctx.beginPath(); ctx.moveTo(x * px, (y + 1) * px); ctx.lineTo((x + 1) * px, (y + 1) * px); ctx.stroke(); }
      }
    }
    // 区域间连接（淡线）
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    for (const [a, b] of map.adjacency) {
      const ra = map.regions[a - 1], rb = map.regions[b - 1];
      if (!ra || !rb) continue;
      ctx.beginPath();
      ctx.moveTo(ra.seedX * px + px / 2, ra.seedY * px + px / 2);
      ctx.lineTo(rb.seedX * px + px / 2, rb.seedY * px + px / 2);
      ctx.stroke();
    }
    // 路径点
    for (const p of map.points) {
      const cx = p.x * px + px / 2, cy = p.y * px + px / 2;
      ctx.fillStyle = p.type === '城镇' ? '#f4d03f' : '#f0f0f0';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, p.type === '城镇' ? px * 0.7 : px * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /* 导出：node（CommonJS）与浏览器（window.MapGen）双环境 */
  const api = { generateWorldMap, renderWorldMap, mapHit, BIOMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.MapGen = api;
})(typeof window !== 'undefined' ? window : global);
