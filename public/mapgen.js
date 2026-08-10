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

  /* 平滑 value noise（1 个八度）；cell 为网格单元（越小越高频） */
  const makeNoise = (rng, size, cell) => {
    cell = cell || 8;
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

  /* fbm：octaves 叠加（频率×2、振幅×0.5），归一化到 0..1
   * 采样坐标按 size 周期 wrap——高频 octave 不越出噪声网格（否则 NaN） */
  const fbm = (n, x, y, octaves, size) => {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const sx = ((x * freq) % size + size) % size;
      const sy = ((y * freq) % size + size) % size;
      sum += n(sx, sy) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };

  /* 海岸线去噪：多数邻点规则（mewo2 思路）——填小洞、去碎岛、去锯齿 */
  const denoise = (land, size) => {
    const out = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let n = 0, t = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            t++;
            if (land[ny * size + nx]) n++;
          }
        }
        out[y * size + x] = (n * 2 >= t) ? 1 : 0;
      }
    }
    return out;
  };

  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  /* jittered grid 撒种子：区域大小均匀，避免随机聚集 / 重叠；种子需落在陆地内部（邻域≥5）避免小岛/窄条 */
  function placeSeeds(rng, land, size, count) {
    const isGoodSeed = (x, y) => {
      if (!land[y * size + x]) return false;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < size && ny < size && land[ny * size + nx]) n++;
        }
      }
      return n >= 5;
    };
    const n = Math.ceil(Math.sqrt(count));
    const cell = size / n;
    const list = [];
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const cx = (gx + 0.5) * cell, cy = (gy + 0.5) * cell;
        for (let tries = 0; tries < 30; tries++) {
          const x = Math.floor(cx + (rng() - 0.5) * cell * 0.7);
          const y = Math.floor(cy + (rng() - 0.5) * cell * 0.7);
          if (x >= 0 && y >= 0 && x < size && y < size && isGoodSeed(x, y)) { list.push({ x, y }); break; }
        }
      }
    }
    // 不足：全图随机陆地补（同样要求实心）
    let guard = 0;
    while (list.length < count && guard++ < 8000) {
      const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
      if (isGoodSeed(x, y) && !list.some(s => s.x === x && s.y === y)) list.push({ x, y });
    }
    // 超出（n² > count）：随机删到 count
    while (list.length > count) list.splice(Math.floor(rng() * list.length), 1);
    return list;
  }

  /* ---------- 生成 ---------- */
  const BIOMES = ['平原', '森林', '山地', '湿地', '丘陵', '荒原'];

  /* mapgen2（Red Blob Games，Apache-2.0）生物群系 → 中文 */
  const BIOME_ZH = {
    OCEAN: '海洋', LAKE: '湖泽', BEACH: '海岸', GLACIER: '冰原', MARSH: '沼泽',
    ICE: '冰原', SNOW: '雪原', TUNDRA: '冻原', BARE: '荒原', SCORCHED: '焦土',
    TAIGA: '针叶林', SHRUBLAND: '灌木地', TEMPERATE_DESERT: '温带荒漠',
    GRASSLAND: '草原', TEMPERATE_RAIN_FOREST: '温带雨林',
    TEMPERATE_DECIDUOUS_FOREST: '落叶林', SUBTROPICAL_DESERT: '沙漠',
    TROPICAL_RAIN_FOREST: '热带雨林', TROPICAL_SEASONAL_FOREST: '季雨林',
    COAST: '海岸',
  };
  // 单地区图：细碎群系合并成 5 大类（地图清爽，AI 美化不易破坏原图）
  const BIOME_MERGE = {
    '海岸': '海岸',
    '草原': '草原', '灌木地': '草原', '荒原': '草原',
    '森林': '森林', '落叶林': '森林', '针叶林': '森林', '季雨林': '森林', '热带雨林': '森林', '温带雨林': '森林',
    '荒野': '荒野', '沙漠': '荒野', '温带荒漠': '荒野', '焦土': '荒野',
    '雪原': '雪原', '冰原': '雪原', '冻原': '雪原',
    '湿地': '湿地', '沼泽': '湿地', '湖泽': '湿地',
  };

  /* 现成算法 mapgen2：多边形地形（海岸/河流/biome/邻接全现成）
   * 适配为自研同款数据形状（region/point/adjacency/grid），渲染层复用 */
  function generateViaMapgen2(seed, opts) {
    opts = opts || {};
    const sizeKey = opts.mapgenSize || 'small'; // tiny/small/medium/large/huge
    const map = global.MapGen2.generateMap(seed, sizeKey, {});
    const mesh = map.mesh;
    const N = mesh.numRegions;
    const size = opts.size || 128;
    const scale = 1000 / size; // mapgen2 逻辑坐标 0..1000 → 像素网格

    // 一次全顶点归属：每像素 → 最近顶点（含水域顶点），据此区分海洋(0)/陆地(区域 id)
    // 顶点数可达 1022，区域可超 255 → 网格用 Uint16Array（Uint8Array 溢出会 256→0）
    const nearest = new Int32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const lx = (x + 0.5) * scale, ly = (y + 0.5) * scale;
        let bestVi = -1, bestD = Infinity;
        for (let vi = 0; vi < N; vi++) {
          const dx = mesh.x_of_r(vi) - lx, dy = mesh.y_of_r(vi) - ly;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; bestVi = vi; }
        }
        nearest[y * size + x] = bestVi;
      }
    }
    // 陆地顶点集合（非水域）
    const landVerts = [];
    for (let vi = 0; vi < N; vi++) if (!map.water_r[vi]) landVerts.push(vi);
    // 陆地顶点胞腔大小（含被水像素占用的边界）
    const landIndexOf = new Map(); // vi -> landVerts 索引
    landVerts.forEach((vi, k) => landIndexOf.set(vi, k));
    const cellCount = new Array(landVerts.length).fill(0);
    for (let i = 0; i < size * size; i++) {
      const vi = nearest[i];
      if (map.water_r[vi]) continue;
      const k = landIndexOf.get(vi);
      if (k !== undefined) cellCount[k]++;
    }
    // 单地区图：按目标区域数（regionCount）定胞腔阈值——取胞腔大小降序第 regionCount 个为阈值，
    // 只保留 target 个大胞腔区域（≈“一张地区图”而不是全世界），小胞腔像素自动归属最近的大区域
    const target = Math.max(4, Math.min(24, opts.regionCount || 8));
    const sortedCells = cellCount.slice().sort((a, b) => b - a);
    let MIN_CELL = sortedCells[Math.min(target - 1, sortedCells.length - 1)];
    if (MIN_CELL < 8) MIN_CELL = 8; // 保底：避免阈值过小又变回碎片
    // 保留胞腔 ≥ MIN_CELL 的顶点 → 重编区域 id
    const regionIdOf = new Map();
    const regions = [];
    for (let k = 0; k < landVerts.length; k++) {
      if (cellCount[k] < MIN_CELL) continue;
      const vi = landVerts[k];
      const id = regions.length + 1;
      regionIdOf.set(vi, id);
      const biome = BIOME_MERGE[BIOME_ZH[map.biome_r[vi]]] || '未知';
      regions.push({
        id, name: biome + '·区域 ' + id, biome,
        seedX: Math.max(0, Math.min(size - 1, Math.round(mesh.x_of_r(vi) / scale))),
        seedY: Math.max(0, Math.min(size - 1, Math.round(mesh.y_of_r(vi) / scale))),
        vertex: vi,
      });
    }
    // 网格：水像素 = 0（最近顶点是水域）；陆地像素 = 最近保留区域的 id（被剔除的小胞腔归属最近大区域，大陆完整）
    const grid = new Uint16Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const vi = nearest[i];
      if (map.water_r[vi]) { grid[i] = 0; continue; }
      const direct = regionIdOf.get(vi);
      if (direct !== undefined) { grid[i] = direct; continue; }
      // 被剔除的陆地像素 → 最近保留区域
      const lx = ((i % size) + 0.5) * scale, ly = (((i / size) | 0) + 0.5) * scale;
      let best = 0, bestD = Infinity;
      for (const r of regions) {
        const dx = mesh.x_of_r(r.vertex) - lx, dy = mesh.y_of_r(r.vertex) - ly;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = r.id; }
      }
      grid[i] = best;
    }
    // 邻接：按网格像素邻接检测（反映视觉可达性；单地区图区域间真实相邻）
    const adjSet = new Set();
    const adjacency = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = grid[y * size + x];
        if (!a) continue;
        if (x + 1 < size) { const b = grid[y * size + x + 1]; if (b && b !== a) { const key = a < b ? a + '-' + b : b + '-' + a; if (!adjSet.has(key)) { adjSet.add(key); adjacency.push([a, b]); } } }
        if (y + 1 < size) { const b = grid[(y + 1) * size + x]; if (b && b !== a) { const key = a < b ? a + '-' + b : b + '-' + a; if (!adjSet.has(key)) { adjSet.add(key); adjacency.push([a, b]); } } }
      }
    }
    // 城镇：保留区域按顶点度（枢纽）取前 6
    const hub = regions.slice().sort((a, b) =>
      (mesh.r_around_r(b.vertex, []).length) - (mesh.r_around_r(a.vertex, []).length));
    const points = [];
    const townCount = Math.min(6, hub.length);
    for (let k = 0; k < townCount; k++) {
      const r = hub[k];
      points.push({ id: 'p' + (k + 1), name: '城镇 ' + (k + 1), type: '城镇', x: r.seedX, y: r.seedY, regionId: r.id, desc: '位于' + r.biome + '区域' });
    }
    // 城镇落区修正（保留区域胞腔 ≥ MIN_CELL，9×9 内必有像素）
    for (const p of points) {
      if (grid[p.y * size + p.x] === p.regionId) continue;
      let fixed = false;
      for (let dy = -4; dy <= 4 && !fixed; dy++) {
        for (let dx = -4; dx <= 4 && !fixed; dx++) {
          const nx = p.x + dx, ny = p.y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (grid[ny * size + nx] === p.regionId) { p.x = nx; p.y = ny; fixed = true; }
        }
      }
    }
    // 地标：直接从 grid 随机采样不同区域的胞腔像素（必然落区）
    const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const seenRegions = new Set(points.map(p => p.regionId));
    let guard = 0;
    while (points.length < townCount + 3 && guard++ < 1000) {
      const xi = Math.floor(rng() * size), yi = Math.floor(rng() * size);
      const rid = grid[yi * size + xi];
      if (!rid || seenRegions.has(rid)) continue;
      seenRegions.add(rid);
      points.push({ id: 'p' + (points.length + 1), name: '地点 ' + (points.length - townCount + 1), type: '地标', x: xi, y: yi, regionId: rid, desc: '一处未命名地标' });
    }
    return { size, regions, points, grid, adjacency, seed, createdAt: Date.now(), engine: 'mapgen2' };
  }

  function generateWorldMap(seed, opts) {
    // 优先现成算法 mapgen2（已在页面加载 vendor/mapgen2.bundle.js）；不可用时回退自研
    if (global.MapGen2 && typeof global.MapGen2.generateMap === 'function') {
      return generateViaMapgen2(seed, opts);
    }
    return generateViaOwn(seed, opts);
  }

  function generateViaOwn(seed, opts) {
    opts = opts || {};
    const size = opts.size || 128;          // 网格边长（越大区域边界越细腻）
    const regionCount = opts.regionCount || 8;
    const landRatio = opts.landRatio ?? 0.55;      // 目标陆地占比（分位数精确控制）
    const warpStrength = opts.warpStrength ?? 0.18; // domain warp 强度（相对 size）
    const coastSmooth = opts.coastSmooth ?? 2;      // 海岸去噪迭代次数
    const octaves = opts.octaves || 3;              // fbm 层数
    const rng = mulberry32(seed);

    // 1) 大陆掩码：fbm + domain warp + 边缘衰减 → 分位数阈值 → 海岸去噪
    const nBase = makeNoise(rng, size); // 主地形（cell 8）
    const wA = makeNoise(rng, size, Math.max(8, size >> 3)); // 低频 warp 场 A
    const wB = makeNoise(rng, size, Math.max(8, size >> 3)); // 低频 warp 场 B
    const clamp = (v) => v < 0 ? 0 : (v > size - 1 ? size - 1 : v);
    const scores = new Float64Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // domain warp：两个低频场扭曲采样坐标 → 海岸线自然
        const offX = (wA(x, y) - 0.5) * 2 * warpStrength * size;
        const offY = (wB(x, y) - 0.5) * 2 * warpStrength * size;
        const h = fbm(nBase, clamp(x + offX), clamp(y + offY), octaves, size);
        // 边缘衰减：中心更容易成陆地 → 大陆块
        const cx = x / (size - 1) - 0.5, cy = y / (size - 1) - 0.5;
        const falloff = 1 - Math.min(1, Math.sqrt(cx * cx + cy * cy) * 1.6);
        scores[y * size + x] = h * 0.55 + falloff * 0.45;
      }
    }
    // redistribute：分位数阈值 → 精确控制海陆比
    const sorted = Array.from(scores).sort((a, b) => a - b);
    const thr = sorted[Math.floor(sorted.length * (1 - landRatio))];
    let land = new Uint8Array(size * size);
    let landPixels = 0;
    for (let i = 0; i < size * size; i++) {
      if (scores[i] > thr) { land[i] = 1; landPixels++; }
    }
    if (!landPixels) land[size * size >> 1] = 1; // 兜底
    // 海岸线去噪：填小洞 / 去碎岛 / 去锯齿
    for (let it = 0; it < coastSmooth; it++) land = denoise(land, size);
    landPixels = 0;
    for (let i = 0; i < size * size; i++) if (land[i]) landPixels++;
    if (!landPixels) land[size * size >> 1] = 1; // 兜底

    // 2) 区域划分：jittered grid 种子 → 加权 voronoi + Lloyd 松弛（边界贴地形、区域均匀圆润）
    const regionWeight = opts.regionWeight ?? 0; // 地形一致权重（距离已按 size² 归一化）：默认 0=纯几何（最稳）；>0 边界贴地形但有挤碎风险
    const lloydIters = opts.lloydIters ?? 3;        // Lloyd 松弛次数
    const seeds = placeSeeds(rng, land, size, regionCount);
    const heightAt = (x, y) => scores[y * size + x];
    const size2 = size * size;
    // 加权距离：欧氏²/size² + 地形差²×权重 → 边界沿高度等值线走，不横切山脊
    const assignCost = (x, y, s) => {
      const d2 = dist2(x, y, s.x, s.y);
      const hd = heightAt(x, y) - heightAt(s.x, s.y);
      return d2 / size2 + regionWeight * hd * hd;
    };
    const grid = new Uint8Array(size * size);
    const assignAll = (weighted) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (!land[y * size + x]) continue;
          let best = -1, bd = Infinity;
          for (let i = 0; i < seeds.length; i++) {
            const d = weighted ? assignCost(x, y, seeds[i]) : dist2(x, y, seeds[i].x, seeds[i].y);
            if (d < bd) { bd = d; best = i; }
          }
          grid[y * size + x] = best + 1;
        }
      }
    };
    // 阶段 1：纯几何 voronoi + Lloyd 松弛（种子位置均匀化，区域圆润；种子稳定后才贴地形）
    assignAll(false);
    const centroidOf = (seedIdx) => {
      let sx = 0, sy = 0, cnt = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (!land[y * size + x] || grid[y * size + x] !== seedIdx + 1) continue;
          sx += x; sy += y; cnt++;
        }
      }
      return cnt ? { x: sx / cnt, y: sy / cnt } : null;
    };
    for (let it = 0; it < lloydIters; it++) {
      for (let i = 0; i < seeds.length; i++) {
        const c = centroidOf(i);
        if (!c) continue;
        const c0x = seeds[i].x, c0y = seeds[i].y;
        // 质心 → 最近陆地像素（优先区域内部）
        let bx = Math.round(c.x), by = Math.round(c.y), bd = Infinity, found = false;
        for (let r = 0; r < size / 2 && !found; r++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const x = bx + dx, y = by + dy;
              if (x < 0 || y < 0 || x >= size || y >= size || !land[y * size + x]) continue;
              const d = dist2(x, y, c.x, c.y);
              if (d < bd) { bd = d; bx = x; by = y; found = true; }
            }
          }
        }
        seeds[i] = { x: bx, y: by };
        // 防重合：与其他种子过近则回退原位（否则两个区域合并成一个，另一个只剩 1px）
        const crowded = seeds.some((o, oi) => oi !== i && dist2(o.x, o.y, bx, by) < 6);
        if (crowded) seeds[i] = { x: c0x, y: c0y };
      }
      assignAll(false);
    }
    // 阶段 2：加权归属一次（边界贴地形；种子位置不变 → 不会把区域挤碎）
    assignAll(true);
    // 区域连通性兜底（迭代至稳定）：每区域保留最大连通块，其余飞地并入相邻区域（排除原区域）
    for (let iter = 0; iter < 5; iter++) {
      const total = size * size;
      const visited = new Uint8Array(total);
      const compOf = new Int32Array(total).fill(-1);
      const compSize = [];
      const compRegion = [];
      let compId = 0;
      for (let r = 1; r <= seeds.length; r++) {
        for (let i = 0; i < total; i++) {
          if (grid[i] !== r || visited[i]) continue;
          const q = [i]; visited[i] = 1; compOf[i] = compId;
          let cnt = 1;
          while (q.length) {
            const c = q.pop();
            const x = c % size, y = (c / size) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
              const ni = ny * size + nx;
              if (grid[ni] === r && !visited[ni]) { visited[ni] = 1; compOf[ni] = compId; q.push(ni); }
            }
          }
          compSize.push(cnt); compRegion.push(r); compId++;
        }
      }
      const compMax = new Map(); // region → 最大连通块 id
      for (let c = 0; c < compId; c++) {
        const r = compRegion[c];
        if (!compMax.has(r) || compSize[c] > compSize[compMax.get(r)]) compMax.set(r, c);
      }
      let changed = false;
      for (let i = 0; i < total; i++) {
        const c = compOf[i];
        if (c < 0) continue;
        const orig = compRegion[c];
        if (c === compMax.get(orig)) continue; // 主块保留
        // 飞地：优先并入 4 邻域中接壤的主块区域（保证连通，单调收敛）
        const x = i % size, y = (i / size) | 0;
        let merged = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const ni = ny * size + nx;
          const nc = compOf[ni];
          if (nc >= 0 && nc !== c && nc === compMax.get(compRegion[nc])) {
            grid[i] = grid[ni];
            merged = true;
            changed = true;
            break;
          }
        }
        if (merged) continue;
        // 无主块邻居（被飞地包围的孤岛）：归最近的其他种子
        let best = -1, bd = Infinity;
        for (let k = 0; k < seeds.length; k++) {
          if (k === orig - 1) continue;
          const d = assignCost(i % size, (i / size) | 0, seeds[k]);
          if (d < bd) { bd = d; best = k; }
        }
        if (best >= 0) { grid[i] = best + 1; changed = true; }
      }
      if (!changed) break;
    }
    // 极小区域兜底：区域 < 陆地 1.5% 则删种子并重新归属（区域数自适应减少，避免 1px 区域）
    for (let pass = 0; pass < 4 && seeds.length > 2; pass++) {
      const total = size * size;
      let removed = false;
      for (let i = seeds.length - 1; i >= 0 && !removed; i--) {
        let cnt = 0;
        for (let p = 0; p < total; p++) if (grid[p] === i + 1) cnt++;
        if (cnt >= landPixels * 0.015) continue;
        seeds.splice(i, 1);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (!land[y * size + x]) continue;
            let best = -1, bd = Infinity;
            for (let k = 0; k < seeds.length; k++) {
              const d = dist2(x, y, seeds[k].x, seeds[k].y);
              if (d < bd) { bd = d; best = k; }
            }
            grid[y * size + x] = best + 1;
          }
        }
        removed = true;
      }
      if (!removed) break;
    }

    // 3) 区域元数据（biome 与地形一致：按种子海拔分档，告别随机）+ 路径点
    const biomeAt = (x, y) => {
      const h = scores[y * size + x];
      const roll = rng();
      if (h > 0.66) return roll < 0.7 ? '山地' : '荒原';
      if (h > 0.54) return roll < 0.65 ? '丘陵' : '森林';
      if (h > 0.44) return roll < 0.6 ? '森林' : '丘陵';
      return roll < 0.55 ? '平原' : '湿地';
    };
    const regions = seeds.map((s, i) => {
      const biome = biomeAt(s.x, s.y);
      return {
        id: i + 1,
        name: biome + '·区域 ' + (i + 1),
        biome,
        seedX: s.x, seedY: s.y,
      };
    });
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
    // 区域边界分隔线已移除（不需要块与块之间的线，靠色块颜色区分）
    // 区域间连接线已移除（用户不需要联系线，保持干净）
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
