import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, convolve, type Problem } from '../src/solver.js';

/** 暴力枚举全部脉冲向量，给出与求解器同定义的真值。 */
function brute(p: Problem) {
  const { y, h, u } = p;
  const m = y.length;
  const n = u.length;
  const cur = new Array<number>(n).fill(0);
  let bestL = Infinity;
  let bestC = Infinity;
  let canonical: number[] = [];
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const rec = (j: number) => {
    if (j === n) {
      const c = convolve(cur, h, m);
      let L = 0;
      let C = 0;
      for (let t = 0; t < m; t++) L += Math.abs(y[t] - c[t]);
      for (let j2 = 0; j2 < n; j2++) C += cur[j2];
      if (L < bestL || (L === bestL && C < bestC)) {
        bestL = L;
        bestC = C;
        canonical = [...cur];
        for (const s of sets) s.clear();
      }
      if (L === bestL && C === bestC) {
        for (let j2 = 0; j2 < n; j2++) sets[j2].add(cur[j2]);
        for (let j2 = 0; j2 < n; j2++) {
          if (cur[j2] < canonical[j2]) {
            canonical = [...cur];
            break;
          }
          if (cur[j2] > canonical[j2]) break;
        }
      }
      return;
    }
    for (let v = 0; v <= u[j]; v++) {
      cur[j] = v;
      rec(j + 1);
    }
  };
  rec(0);
  return {
    bestL,
    bestC,
    canonical,
    sets: sets.map((s) => [...s].sort((a, b) => a - b)),
  };
}

/** 可复现的伪随机数（mulberry32）。 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randProblem(r: () => number, m: number, k: number, uMax: number): Problem {
  const n = m - k + 1;
  const y = Array.from({ length: m }, () => Math.floor(r() * 7));
  const h = Array.from({ length: k }, () => Math.floor(r() * 4));
  h[0] = 1 + Math.floor(r() * 3);
  h[k - 1] = 1 + Math.floor(r() * 3);
  const u = Array.from({ length: n }, () => Math.floor(r() * (uMax + 1)));
  return { y, h, u };
}

test('卷积边界：越界项按零卷积（首端、末端与截断）', () => {
  const h = [1, 2, 1];
  const m = 12;
  const n = m - h.length + 1; // 10
  // 首端脉冲：波形前 k 项即响应核本身
  const head = new Array(n).fill(0);
  head[0] = 3;
  assert.deepEqual(convolve(head, h, m), [3, 6, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  // 末端脉冲：落在波形最后 k 项，验证零填充边界不外溢
  const tail = new Array(n).fill(0);
  tail[n - 1] = 2;
  assert.deepEqual(convolve(tail, h, m), [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 4, 2]);
  // 零向量卷积为零
  assert.deepEqual(convolve(new Array(n).fill(0), h, m), new Array(m).fill(0));
  // 求解器在两端边界上精确还原脉冲序列
  const x = new Array(n).fill(0);
  x[0] = 1;
  x[n - 1] = 1;
  const y = convolve(x, h, m);
  const r = solve({ y, h, u: new Array(n).fill(1) });
  assert.equal(r.l1, 0);
  assert.equal(r.pulses, 2);
  assert.deepEqual(r.x, x);
  assert.deepEqual(r.recon, y);
  assert.deepEqual(r.resid, new Array(m).fill(0));
});

test('双层最优规则：第一层绝对残差总和优先于脉冲总数', () => {
  // 零向量脉冲数为 0 但 L1=2；x0=1 脉冲数为 1 但 L1=0，必须选后者
  const y = [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = solve({ y, h: [1, 1], u: new Array(11).fill(1) });
  assert.equal(r.l1, 0);
  assert.equal(r.pulses, 1);
  assert.deepEqual(r.x, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('双层最优规则：L1 并列时第二层脉冲总数决胜', () => {
  // x0 ∈ {1,2,3} 时 L1 同为 2，脉冲数分别为 1,2,3，必须选 x0=1
  const y = [3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = solve({ y, h: [1, 1], u: new Array(11).fill(4) });
  assert.equal(r.l1, 2);
  assert.equal(r.pulses, 1);
  assert.deepEqual(r.x, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(r.sets[0], [1]);
});

test('规范解：前两层并列时取脉冲向量字典序最小者', () => {
  // A=[2,0,…] 与 B=[1,1,0,…] 同为 (L1=1, 脉冲=2)，字典序 B < A
  const y = [2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = solve({ y, h: [1, 1], u: new Array(11).fill(2) });
  assert.equal(r.l1, 1);
  assert.equal(r.pulses, 2);
  assert.deepEqual(r.x, [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('同优计数位置：计数集合精确给出全部全局同优解的可取值', () => {
  // 同优解为 {x0=2} 与 {x0=1, x1=1}：位置 0 可取 {1,2}，位置 1 可取 {0,1}
  const y = [2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = solve({ y, h: [1, 1], u: new Array(11).fill(2) });
  assert.deepEqual(r.sets[0], [1, 2]);
  assert.deepEqual(r.sets[1], [0, 1]);
  for (let j = 2; j < 11; j++) assert.deepEqual(r.sets[j], [0]);
  assert.deepEqual(r.tied, [0, 1]);
});

test('内置示例：观测、重建、残差与同优位置', () => {
  const y = [2, 2, 1, 0, 1, 2, 1, 0, 0, 0, 0, 0];
  const r = solve({ y, h: [1, 1], u: new Array(11).fill(2) });
  assert.equal(r.l1, 1);
  assert.equal(r.pulses, 4);
  assert.deepEqual(r.x, [1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(r.recon, [1, 2, 1, 0, 1, 2, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(r.resid, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(r.tied, [0, 1]);
});

test('上限约束：u 全零时只能取零向量', () => {
  const y = [5, 3, 0, 1, 0, 0, 2, 0, 0, 0, 1, 1];
  const r = solve({ y, h: [2, 1], u: new Array(11).fill(0) });
  assert.equal(r.l1, y.reduce((a, b) => a + b, 0));
  assert.equal(r.pulses, 0);
  assert.deepEqual(r.x, new Array(11).fill(0));
  for (const s of r.sets) assert.deepEqual(s, [0]);
  assert.deepEqual(r.tied, []);
});

test('随机对拍：动态规划与暴力枚举一致（90 组小规模）', () => {
  const r = rng(20260922);
  const configs: Array<[number, number, number, number]> = [
    [50, 12, 2, 2], // n=11，分支 3^11
    [20, 13, 3, 2], // n=11
    [12, 12, 4, 3], // n=9，分支 4^9
    [8, 12, 7, 4], // n=6，分支 5^6，最长核
  ];
  for (const [count, m, k, uMax] of configs) {
    for (let i = 0; i < count; i++) {
      const p = randProblem(r, m, k, uMax);
      const got = solve(p);
      const want = brute(p);
      assert.equal(got.l1, want.bestL, `L1 不一致 m=${m} k=${k} 用例${i}`);
      assert.equal(got.pulses, want.bestC, `脉冲数不一致 m=${m} k=${k} 用例${i}`);
      assert.deepEqual(got.x, want.canonical, `规范解不一致 m=${m} k=${k} 用例${i}`);
      assert.deepEqual(got.sets, want.sets, `计数集合不一致 m=${m} k=${k} 用例${i}`);
      // 规范解自身必满足两层最优
      assert.equal(got.resid.reduce((a, b) => a + Math.abs(b), 0), got.l1);
      assert.equal(got.x.reduce((a, b) => a + b, 0), got.pulses);
    }
  }
});

test('高幅交替波形：第一层全部并列时第二层全零向量为唯一前两层最优解', () => {
  // 50 个采样点：1e12 与 0 交替 25 组；核 [1,1]，上限单值 4 广播。
  // 任意脉冲对相邻“高点/零点”产生等量反向的残差变化，故所有脉冲向量的第一层
  // L1 恒为 25e12；第二层必须唯一选择脉冲总数 0 的全零向量。
  const A = 1_000_000_000_000;
  const y: number[] = [];
  for (let g = 0; g < 25; g++) {
    y.push(A);
    y.push(0);
  }
  const h = [1, 1];
  const n = 49;
  const r = solve({ y, h, u: new Array(n).fill(4) });
  // 两层目标
  assert.equal(r.l1, 25 * A);
  assert.equal(r.pulses, 0);
  // 规范向量
  assert.deepEqual(r.x, new Array(n).fill(0));
  // 重建全零、有符号残差与观测一致
  assert.deepEqual(r.recon, new Array(50).fill(0));
  assert.deepEqual(r.resid, y);
  // 49 个位置的精确计数集合全部为 {0}
  assert.equal(r.sets.length, n);
  for (let j = 0; j < n; j++) assert.deepEqual(r.sets[j], [0], `位置 ${j} 计数集合应为 {0}`);
  // 同优位置数为 0
  assert.deepEqual(r.tied, []);
});

test('高幅波形：第二层脉冲总数决胜不被大数值吞没', () => {
  // 25 组 [3S, S] 对拼成 50 个采样点，核 [S, S]，上限单值 4 广播。
  // 每组内 x 取 1/2/3 时第一层 L1 同为 2S，第二层只允许计数 1：取值 2、3、4
  // 对应的脉冲数多 1 以上，旧实现的浮点容差
  // （约 4·EPSILON·L1·scoreWeight ≈ 2.6）会把它们误并入同优集合，本测试予以拦截。
  // 同时该结构在相邻组之间存在真正的前两层同优（{1,0,1} 与 {0,1,1} 等），
  // 真实的 {0,1} 二值集合必须完整保留。S=3e11 时所有输入（含核）≤ 页面上限 1e12。
  const S = 300_000_000_000;
  const y: number[] = [];
  for (let g = 0; g < 25; g++) {
    y.push(3 * S);
    y.push(S);
  }
  const h = [S, S];
  const n = 49;
  const r = solve({ y, h, u: new Array(n).fill(4) });
  assert.equal(r.l1, 50 * S);
  assert.equal(r.pulses, 25);
  // 规范解：相邻组共享一个脉冲，字典序最小的安排为 [0,1,0,1,…,0,1,1]
  const canonical = Array.from({ length: n }, (_, j) => (j === n - 1 || j % 2 === 1 ? 1 : 0));
  assert.deepEqual(r.x, canonical);
  // 精确计数集合：前 48 个位置 {0,1}（真实同优），末位置 {1}；任何集合都不得含 2/3/4
  const expectedSets = Array.from({ length: n }, (_, j) => (j === n - 1 ? [1] : [0, 1]));
  assert.deepEqual(r.sets, expectedSets);
  assert.deepEqual(
    r.tied,
    Array.from({ length: n - 1 }, (_, j) => j),
  );
  // 结构孪生（幅值归一）经暴力枚举确认上述重复模式：2 对（u=4）与 3 对（u=3）
  const makeTwin = (pairs: number, uMax: number): Problem => ({
    y: Array.from({ length: 2 * pairs }, (_, t) => (t % 2 === 0 ? 3 : 1)),
    h: [1, 1],
    u: new Array(2 * pairs - 1).fill(uMax),
  });
  assert.deepEqual(brute(makeTwin(2, 4)).sets, [[0, 1], [0, 1], [1]]);
  assert.deepEqual(brute(makeTwin(3, 3)).sets, [[0, 1], [0, 1], [0, 1], [0, 1], [1]]);
  // 重建与残差逐项核对
  assert.deepEqual(r.recon, convolve(canonical, h, 50));
  assert.deepEqual(r.resid, y.map((v, t) => v - r.recon[t]));
});

test('高幅波形：真正的前两层同优解在大数值下仍保持集合完整', () => {
  // 普通幅值内置示例 [2,2,1,0,…]、核 [1,1] 的整体等比放大（观测与核同乘 S）：
  // {x0=2} 与 {x0=1,x1=1} 同为 (L1=S, 脉冲=2)，位置 0 集合 {1,2}、
  // 位置 1 集合 {0,1} 必须在大数值下完整保留——精确整数重写不得把真实同优
  // 误判为非平凡外的任何形态（高幅值下“误并”一侧由前两个用例拦截）。
  // S=5e11 时所有输入（含核项 2S）均不超过页面接受上限 1e12。
  const S = 500_000_000_000;
  const y = [2 * S, 2 * S, S, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const h = [S, S];
  const r = solve({ y, h, u: new Array(11).fill(2) });
  assert.equal(r.l1, S);
  assert.equal(r.pulses, 2);
  assert.deepEqual(r.x, [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(r.sets[0], [1, 2]);
  assert.deepEqual(r.sets[1], [0, 1]);
  for (let j = 2; j < 11; j++) assert.deepEqual(r.sets[j], [0]);
  assert.deepEqual(r.tied, [0, 1]);
});

test('高幅交替波形：非均匀上限下计数集合仍精确', () => {
  const A = 1_000_000_000_000;
  const y: number[] = [];
  for (let g = 0; g < 25; g++) {
    y.push(A);
    y.push(0);
  }
  const n = 49;
  // 偶数位置上限 4、奇数位置上限 0（被封死的位置集合只能为 {0}）
  const u = Array.from({ length: n }, (_, j) => (j % 2 === 0 ? 4 : 0));
  const r = solve({ y, h: [1, 1], u });
  assert.equal(r.l1, 25 * A);
  assert.equal(r.pulses, 0);
  assert.deepEqual(r.x, new Array(n).fill(0));
  for (let j = 0; j < n; j++) assert.deepEqual(r.sets[j], [0], `位置 ${j} 计数集合应为 {0}`);
  assert.deepEqual(r.tied, []);
});

test('可穷举小规模：枚举全部 y/h/u 组合与暴力枚举对拍全部集合', () => {
  // 不依赖随机抽样：对小规模问题穷举观测波形、响应核与非均匀上限的全部组合，
  // 逐项核对两层目标、规范解与每个位置的精确计数集合（含核内零与 u=0 封死）。
  const cartesian = (alphabet: number[], len: number): number[][] => {
    const out: number[][] = [[]];
    for (let d = 0; d < len; d++) {
      const size = out.length;
      for (let q = 0; q < size; q++) {
        const base = out[q];
        for (let v = 1; v < alphabet.length; v++) out.push([...base, alphabet[v]]);
        out[q] = [...base, alphabet[0]];
      }
    }
    return out;
  };
  const configs: Array<{ m: number; h: number[]; yAlphabet: number[]; uAlphabet: number[] }> = [
    // n = m−k+1 = 5：上限 32 种、波形 3^6 种、4 个核
    { m: 6, h: [1, 1], yAlphabet: [0, 1, 2], uAlphabet: [0, 1] },
    { m: 6, h: [2, 1], yAlphabet: [0, 1, 2], uAlphabet: [0, 1] },
    { m: 6, h: [1, 2], yAlphabet: [0, 1, 2], uAlphabet: [0, 1] },
    { m: 6, h: [3, 1], yAlphabet: [0, 1, 2], uAlphabet: [0, 1] },
    // n = 4：核内零权重、首尾为正
    { m: 6, h: [1, 0, 1], yAlphabet: [0, 1], uAlphabet: [0, 1] },
    { m: 6, h: [1, 1, 1], yAlphabet: [0, 1], uAlphabet: [0, 1] },
    { m: 6, h: [2, 0, 1], yAlphabet: [0, 1], uAlphabet: [0, 1] },
    // n = 3：非均匀上限取值 0..2 全部枚举
    { m: 5, h: [1, 0, 1], yAlphabet: [0, 1, 2], uAlphabet: [0, 1, 2] },
    { m: 5, h: [1, 1, 1], yAlphabet: [0, 1, 2], uAlphabet: [0, 1, 2] },
  ];
  let count = 0;
  for (const cfg of configs) {
    const n = cfg.m - cfg.h.length + 1;
    const ys = cartesian(cfg.yAlphabet, cfg.m);
    const us = cartesian(cfg.uAlphabet, n);
    for (const y of ys) {
      for (const u of us) {
        const p: Problem = { y, h: cfg.h, u };
        const got = solve(p);
        const want = brute(p);
        assert.equal(got.l1, want.bestL, `L1 不一致：${JSON.stringify(p)}`);
        assert.equal(got.pulses, want.bestC, `脉冲数不一致：${JSON.stringify(p)}`);
        assert.deepEqual(got.x, want.canonical, `规范解不一致：${JSON.stringify(p)}`);
        assert.deepEqual(got.sets, want.sets, `计数集合不一致：${JSON.stringify(p)}`);
        count++;
      }
    }
  }
  assert.ok(count > 100_000, `穷举用例数异常：${count}`);
});

test('规模冒烟：m=300、k=7、u=4 上限规模可解', () => {
  const r = rng(7);
  const p = randProblem(r, 300, 7, 4);
  const got = solve(p);
  assert.equal(got.x.length, 294);
  assert.equal(got.recon.length, 300);
  assert.equal(got.resid.reduce((a, b) => a + Math.abs(b), 0), got.l1);
  assert.equal(got.x.reduce((a, b) => a + b, 0), got.pulses);
  for (let j = 0; j < got.sets.length; j++) {
    assert.ok(got.sets[j].length >= 1, `位置 ${j} 计数集合为空`);
    assert.ok(got.sets[j].includes(got.x[j]), `位置 ${j} 规范值不在计数集合内`);
  }
});
