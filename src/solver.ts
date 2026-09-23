// 闪烁探测器脉冲堆积离线解卷积求解器。
//
// 模型：观测波形 y 长度 m，响应核 h 长度 k，潜在脉冲序列 x 长度 n = m − k + 1。
// 重建为长度恰好 m 的离散卷积：
//   (x * h)[t] = Σ_{i=0..k−1} h[i] · x[t−i]，t = 0..m−1，
// 其中下标越界的 x 一律按 0 处理（零卷积边界）。
//
// 目标按字典序分层：
//   第一层：最小化绝对残差总和 L1 = Σ_t |y[t] − (x*h)[t]|；
//   第二层：在第一层最优解中最小化脉冲总数 Σ_j x[j]；
//   第三层：在前两层最优解中取脉冲向量字典序最小者作为规范解。
// 同时为每个位置 j 给出前两层全部全局最优（同优）解中 x[j] 可取的精确计数集合。
//
// 算法：残差 r_t 只依赖 x[t−k+1..t]，故以最近 k−1 个脉冲值为状态做动态规划。
// 代价始终按 (L1, 脉冲数) 整数对保存，按字典序精确比较，不做任何浮点容差近似：
// 若把两层代价打包成单个浮点数（如 L1·权重 + 脉冲数），高幅输入下相对容差会
// 大于 1，把脉冲数不同的解误判为同优；而打包值本身还可能超过 2^53 失去精确性。
// 反向递推得到每个状态到结尾的最优代价 B，正向扫描得到到达每个状态的最优代价 F，
// 位置 j 取值 v 可行于某全局同优解 ⟺ 存在状态 s 使
//   F[j][s] + 步代价(s,v) + B[j+1][shift(s,v)] == 全局最优（两层分量分别相等）。
// 规范解则在保持该等式的前提下逐位取最小 v。所有量均为非负整数：
// 输入取值不超过 1e12 时 L1 ≤ 300·(7·4·1e12) < 2^53，脉冲数 ≤ 300·4，
// Float64 整数运算精确无舍入。

export interface Problem {
  /** 观测波形，长度 m ∈ [12, 300]，非负整数 */
  y: number[];
  /** 响应核，长度 k ∈ [2, 7]，非负整数且首尾为正 */
  h: number[];
  /** 每个位置的脉冲上限，长度 n = m − k + 1，取值 0..4 */
  u: number[];
}

export interface SolveResult {
  m: number;
  n: number;
  k: number;
  /** 规范解脉冲向量，长度 n */
  x: number[];
  /** 最优绝对残差总和 */
  l1: number;
  /** 最优脉冲总数 */
  pulses: number;
  /** 规范解的重建波形，长度 m */
  recon: number[];
  /** 有符号残差 y − recon，长度 m */
  resid: number[];
  /** 每个位置在全部全局同优解中可取的计数集合（升序），长度 n */
  sets: number[][];
  /** 计数集合非平凡（可取多于一个值）的位置 */
  tied: number[];
  /** 求解耗时（毫秒） */
  solveMs: number;
}

/** 长度 m 的离散卷积（越界项按零处理）。 */
export function convolve(x: readonly number[], h: readonly number[], m: number): number[] {
  const out = new Array<number>(m).fill(0);
  for (let j = 0; j < x.length; j++) {
    const xj = x[j];
    if (xj === 0) continue;
    for (let i = 0; i < h.length; i++) {
      const t = j + i;
      if (t >= 0 && t < m) out[t] += xj * h[i];
    }
  }
  return out;
}

export function solve(problem: Problem): SolveResult {
  const t0 = performance.now();
  const { y, h, u } = problem;
  const m = y.length;
  const k = h.length;
  const n = m - k + 1;
  if (n < 1 || u.length !== n) {
    throw new Error(`维度不一致：m=${m}, k=${k}, 需要 |u|=n=${n}，实际 |u|=${u.length}`);
  }

  // 第 j 步（选择 x[j]）之前的状态窗口为 x[j−k+1 .. j−1]，共 k−1 个槽位；
  // 越界槽位取值恒为 0（基数 1），合法槽位基数为 u[p]+1。
  const sizes = new Array<number>(n + 1);
  const radix: number[][] = new Array(n + 1);
  for (let j = 0; j <= n; j++) {
    const r = new Array<number>(k - 1);
    let s = 1;
    for (let i = 0; i < k - 1; i++) {
      const p = j - k + 1 + i;
      r[i] = p >= 0 && p < n ? u[p] + 1 : 1;
      s *= r[i];
    }
    radix[j] = r;
    sizes[j] = s;
  }

  // 反向动态规划：B[j][s] = 在第 j 步前处于状态 s 时，从第 j 步到结束的最优代价，
  // 以 (bL1[j][s], bCnt[j][s]) 整数对保存，按 (L1, 脉冲数) 字典序比较。
  const bL1: Float64Array[] = new Array(n + 1);
  const bCnt: Float64Array[] = new Array(n + 1);

  // 终止层 j = n：尾部残差 t = n .. m−1 完全由窗口 x[n−k+1 .. n−1] 决定（越界 x = 0）。
  {
    const sn = sizes[n];
    const r = radix[n];
    const l1 = new Float64Array(sn);
    const w = new Array<number>(k - 1);
    for (let idx = 0; idx < sn; idx++) {
      let rem = idx;
      for (let i = 0; i < k - 1; i++) {
        const d = rem % r[i];
        w[i] = d;
        rem = (rem - d) / r[i];
      }
      let sum = 0;
      for (let s = 0; s <= k - 2; s++) {
        // t = n + s：仅 i ≥ s+1 的核项落在窗口内，x[n+s−i] = w[k−1−i+s]
        let acc = 0;
        for (let i = s + 1; i < k; i++) acc += h[i] * w[k - 1 - i + s];
        const rr = y[n + s] - acc;
        sum += rr < 0 ? -rr : rr;
      }
      l1[idx] = sum;
    }
    bL1[n] = l1;
    bCnt[n] = new Float64Array(sn); // 终止层不再产生脉冲
  }

  for (let j = n - 1; j >= 0; j--) {
    const sj = sizes[j];
    const r = radix[j];
    const r0 = r[0];
    const uj = u[j];
    // 状态转移：去掉窗口最低位 w0，左移后追加 v；next = base + v·top
    const top = sizes[j + 1] / (uj + 1);
    const nextL1 = bL1[j + 1];
    const nextCnt = bCnt[j + 1];
    const l1 = new Float64Array(sj);
    const cnt = new Float64Array(sj);
    const yj = y[j];
    const h0 = h[0];
    for (let idx = 0; idx < sj; idx++) {
      // 槽位 i 保存 x[j−k+1+i]，在残差 r_j 中配对核权重 h[k−1−i]
      const w0 = idx % r0;
      const base = (idx - w0) / r0;
      // dot = Σ_{i≥1} h[i]·x[j−i]，即残差 r_j 中与当前取值 v 无关的部分
      let rem = base;
      let dot = h[k - 1] * w0;
      for (let i = 1; i < k - 1; i++) {
        const d = rem % r[i];
        rem = (rem - d) / r[i];
        dot += h[k - 1 - i] * d;
      }
      let bestL1 = Infinity;
      let bestC = Infinity;
      for (let v = 0; v <= uj; v++) {
        const rr = yj - (dot + h0 * v);
        const a = rr < 0 ? -rr : rr;
        const ni = base + v * top;
        const candL1 = a + nextL1[ni];
        const candC = v + nextCnt[ni];
        if (candL1 < bestL1 || (candL1 === bestL1 && candC < bestC)) {
          bestL1 = candL1;
          bestC = candC;
        }
      }
      l1[idx] = bestL1;
      cnt[idx] = bestC;
    }
    bL1[j] = l1;
    bCnt[j] = cnt;
  }

  const optL1 = bL1[0][0];
  const optCnt = bCnt[0][0];

  // 正向扫描：F[j][s] = 到达第 j 步状态 s 的最优前缀代价 (fL1, fCnt)；
  // 同时用 F + 步代价 + B == 全局最优（两层分量分别相等）判定每个位置的可取计数集合，
  // 并在保持全局最优的前提下逐位取最小 v 构造规范解。
  const sets: number[][] = new Array(n);
  const x = new Array<number>(n).fill(0);
  let fL1 = new Float64Array(sizes[0]);
  let fCnt = new Float64Array(sizes[0]);
  let cur = 0;
  for (let j = 0; j < n; j++) {
    const sj = sizes[j];
    const r = radix[j];
    const r0 = r[0];
    const uj = u[j];
    const top = sizes[j + 1] / (uj + 1);
    const nextL1 = bL1[j + 1];
    const nextCnt = bCnt[j + 1];
    const gL1 = new Float64Array(sizes[j + 1]).fill(Infinity);
    const gCnt = new Float64Array(sizes[j + 1]);
    const yj = y[j];
    const h0 = h[0];
    const setJ: number[] = [];
    for (let idx = 0; idx < sj; idx++) {
      const prefixL1 = fL1[idx];
      if (prefixL1 === Infinity) continue;
      const prefixCnt = fCnt[idx];
      const w0 = idx % r0;
      const base = (idx - w0) / r0;
      let rem = base;
      let dot = h[k - 1] * w0;
      for (let i = 1; i < k - 1; i++) {
        const d = rem % r[i];
        rem = (rem - d) / r[i];
        dot += h[k - 1 - i] * d;
      }
      for (let v = 0; v <= uj; v++) {
        const rr = yj - (dot + h0 * v);
        const a = rr < 0 ? -rr : rr;
        const ni = base + v * top;
        const candL1 = prefixL1 + a;
        const candCnt = prefixCnt + v;
        if (candL1 < gL1[ni] || (candL1 === gL1[ni] && candCnt < gCnt[ni])) {
          gL1[ni] = candL1;
          gCnt[ni] = candCnt;
        }
        if (
          candL1 + nextL1[ni] === optL1 &&
          candCnt + nextCnt[ni] === optCnt &&
          !setJ.includes(v)
        ) {
          setJ.push(v);
        }
      }
    }
    // 规范解：当前状态必在某条全局同优路径上，取保持全局最优的最小 v
    {
      const idx = cur;
      const prefixL1 = fL1[idx];
      const prefixCnt = fCnt[idx];
      const w0 = idx % r0;
      const base = (idx - w0) / r0;
      let rem = base;
      let dot = h[k - 1] * w0;
      for (let i = 1; i < k - 1; i++) {
        const d = rem % r[i];
        rem = (rem - d) / r[i];
        dot += h[k - 1 - i] * d;
      }
      let chosen = -1;
      for (let v = 0; v <= uj; v++) {
        const rr = yj - (dot + h0 * v);
        const a = rr < 0 ? -rr : rr;
        const ni = base + v * top;
        if (prefixL1 + a + nextL1[ni] === optL1 && prefixCnt + v + nextCnt[ni] === optCnt) {
          chosen = v;
          cur = ni;
          break;
        }
      }
      if (chosen < 0) throw new Error('规范解构造失败：动态规划状态不一致');
      x[j] = chosen;
    }
    sets[j] = setJ.sort((a, b) => a - b);
    fL1 = gL1;
    fCnt = gCnt;
  }

  const recon = convolve(x, h, m);
  const resid = y.map((v, t) => v - recon[t]);
  const optL = resid.reduce((sum, value) => sum + Math.abs(value), 0);
  const optC = x.reduce((sum, value) => sum + value, 0);
  const tied: number[] = [];
  for (let j = 0; j < n; j++) if (sets[j].length > 1) tied.push(j);

  return {
    m,
    n,
    k,
    x,
    l1: optL,
    pulses: optC,
    recon,
    resid,
    sets,
    tied,
    solveMs: performance.now() - t0,
  };
}
