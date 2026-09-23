import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, convolve, type Problem } from '../src/solver.js';
import { validateProblem } from '../src/parse.js';

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

test('高幅交替波形：两层目标、规范解、重建、残差与 49 个计数集合', () => {
  // 页面录入：50 个采样点，1e12 与 0 交替 25 组；h=[1,1]；上限单值 4 广播。
  // 每个脉冲对一个高采样点和相邻零采样点产生等量、方向相反的残差变化，
  // 故所有脉冲向量的第一层 L1 相同；第二层必须选出脉冲总数最少的全零向量。
  const C = 1_000_000_000_000;
  const rawY = Array.from({ length: 50 }, (_, t) => String(t % 2 === 0 ? C : 0)).join(', ');
  // 这些非负整数已被页面接受，必须继续作为合法输入处理
  const v = validateProblem(rawY, '1, 1', '4');
  assert.deepEqual(v.errors, []);
  assert.ok(v.problem);
  const { y, u } = v.problem;
  const m = y.length; // 50
  const n = u.length; // 49
  assert.equal(m, 50);
  assert.equal(n, 49);
  assert.ok(u.every((limit) => limit === 4));

  const r = solve(v.problem);
  // 第一层：L1 恒为 25×1e12；第二层：唯一前两层最优解为全零向量
  assert.equal(r.l1, 25_000_000_000_000);
  assert.equal(r.pulses, 0);
  assert.deepEqual(r.x, new Array(n).fill(0));
  assert.deepEqual(r.recon, new Array(m).fill(0));
  assert.deepEqual(r.resid, y);
  // 49 个位置的精确计数集合都应为 {0}，同优位置数为 0
  assert.equal(r.sets.length, n);
  for (let j = 0; j < n; j++) assert.deepEqual(r.sets[j], [0], `位置 ${j} 计数集合应为 {0}`);
  assert.deepEqual(r.tied, []);
});

test('高幅波形：真实存在的多解同优集合保持完整', () => {
  // 与「同优计数位置」用例同构、幅值放大到 1e12（由响应核携带尺度）：
  // 同优解 {x0=2} 与 {x0=1, x1=1} 都必须保留，不得因修复而塌缩
  const C = 1_000_000_000_000;
  const y = [2 * C, 2 * C, C, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = solve({ y, h: [C, C], u: new Array(11).fill(2) });
  assert.equal(r.l1, C);
  assert.equal(r.pulses, 2);
  assert.deepEqual(r.x, [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(r.sets[0], [1, 2]);
  assert.deepEqual(r.sets[1], [0, 1]);
  for (let j = 2; j < 11; j++) assert.deepEqual(r.sets[j], [0]);
  assert.deepEqual(r.tied, [0, 1]);
});

test('穷举对拍：全部 2^12 个二值波形逐位置核对计数集合', () => {
  const m = 12;
  const h = [1, 1];
  const n = m - h.length + 1; // 11
  const u = new Array(n).fill(1);
  for (let bits = 0; bits < 1 << m; bits++) {
    const y = Array.from({ length: m }, (_, t) => (bits >> t) & 1);
    const p = { y, h, u };
    const got = solve(p);
    const want = brute(p);
    assert.equal(got.l1, want.bestL, `L1 不一致 bits=${bits}`);
    assert.equal(got.pulses, want.bestC, `脉冲数不一致 bits=${bits}`);
    assert.deepEqual(got.x, want.canonical, `规范解不一致 bits=${bits}`);
    assert.deepEqual(got.sets, want.sets, `计数集合不一致 bits=${bits}`);
  }
});

test('随机对拍：高幅值输入下动态规划与暴力枚举一致（12 组小规模）', () => {
  const C = 1_000_000_000_000;
  const r = rng(20260923);
  for (let i = 0; i < 12; i++) {
    const m = 12;
    const n = m - 1; // k = 2
    const y = Array.from({ length: m }, () => Math.floor(r() * 3) * C + Math.floor(r() * 3));
    const h = [1 + Math.floor(r() * 2), 1 + Math.floor(r() * 2)];
    const u = Array.from({ length: n }, () => Math.floor(r() * 3));
    const p = { y, h, u };
    const got = solve(p);
    const want = brute(p);
    assert.equal(got.l1, want.bestL, `L1 不一致 用例${i}`);
    assert.equal(got.pulses, want.bestC, `脉冲数不一致 用例${i}`);
    assert.deepEqual(got.x, want.canonical, `规范解不一致 用例${i}`);
    assert.deepEqual(got.sets, want.sets, `计数集合不一致 用例${i}`);
  }
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
