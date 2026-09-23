import { useEffect, useMemo, useState } from 'react';
import { solve, type Problem } from './solver.js';
import { validateProblem, FIELD_LABEL, LIMITS } from './parse.js';
import { WaveChart, ResidChart, PulseChart } from './charts';

const DEFAULT_Y = '2, 2, 1, 0, 1, 2, 1, 0, 0, 0, 0, 0';
const DEFAULT_H = '1, 1';
const DEFAULT_U = '2';

function initialProblem(): Problem {
  const v = validateProblem(DEFAULT_Y, DEFAULT_H, DEFAULT_U);
  if (!v.problem) throw new Error('内置示例非法');
  return v.problem;
}

export default function App() {
  const [rawY, setRawY] = useState(DEFAULT_Y);
  const [rawH, setRawH] = useState(DEFAULT_H);
  const [rawU, setRawU] = useState(DEFAULT_U);
  const [hover, setHover] = useState<number | null>(null);

  const validation = useMemo(() => validateProblem(rawY, rawH, rawU), [rawY, rawH, rawU]);
  // 非法输入不覆盖最近一次合法问题，图表始终对应可重算的证据
  const [active, setActive] = useState<Problem>(initialProblem);
  useEffect(() => {
    if (validation.problem) setActive(validation.problem);
  }, [validation.problem]);

  const result = useMemo(() => solve(active), [active]);
  const stale = validation.errors.length > 0;
  const { counts } = validation;

  const loadExample = () => {
    setRawY(DEFAULT_Y);
    setRawH(DEFAULT_H);
    setRawU(DEFAULT_U);
  };

  return (
    <div className="page">
      <header>
        <h1>闪烁探测器脉冲堆积 · 离线解卷积审计</h1>
        <p className="sub">
          全部计算在浏览器本地完成，不连接任何后端或在线服务；输入与结果可离线重算复核。
        </p>
      </header>

      <section className="panel">
        <h2>输入</h2>
        <div className="inputs">
          <label>
            <span>
              观测波形 y（非负整数，长度 {LIMITS.M_MIN}–{LIMITS.M_MAX}，逗号/空白分隔）
            </span>
            <textarea
              rows={3}
              value={rawY}
              onChange={(e) => setRawY(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label>
            <span>
              响应核 h（非负整数，长度 {LIMITS.K_MIN}–{LIMITS.K_MAX}，首尾必须为正）
            </span>
            <textarea
              rows={2}
              value={rawH}
              onChange={(e) => setRawH(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label>
            <span>
              每点脉冲上限 u（{LIMITS.U_MIN}–{LIMITS.U_MAX}
              ；单个值广播到全部位置，或给出与 n=m−k+1 等长的序列）
            </span>
            <textarea
              rows={2}
              value={rawU}
              onChange={(e) => setRawU(e.target.value)}
              spellCheck={false}
            />
          </label>
        </div>
        <div className="meta">
          已解析：m={counts.m ?? '—'}，k={counts.k ?? '—'}，n=m−k+1={counts.n ?? '—'}
          ，上限个数={counts.uCount}
          <button type="button" onClick={loadExample}>
            载入示例
          </button>
        </div>
        {stale ? (
          <>
            <ul className="errors">
              {validation.errors.map((e, i) => (
                <li key={i}>
                  <strong>{FIELD_LABEL[e.field]}</strong>
                  {e.index !== null ? ` 第 ${e.index + 1} 项` : ''}：{e.message}
                </li>
              ))}
            </ul>
            <div className="warn">输入存在错误，下方结果仍为最近一次合法输入的解。</div>
          </>
        ) : (
          <div className="ok">输入合法，以下为当前输入的解。</div>
        )}
      </section>

      <section className="panel">
        <h2>判定规则</h2>
        <p>
          潜在脉冲序列长度 n = m − k + 1，越界项按零卷积。依次最小化：① 绝对残差总和
          Σ|y−x*h|；② 脉冲总数 Σx；③ 取脉冲向量字典序最小者为规范解。
          计数集合为满足①②的全部全局同优解中该位置可取的精确值；集合含多个值的位置以
          <span className="legend-tied"> 底色 </span>标出。
        </p>
      </section>

      <section className="panel">
        <h2>结果</h2>
        <div className="cards">
          <div className="card">
            <div className="card-v">{result.l1}</div>
            <div className="card-k">最优绝对残差总和 L1</div>
          </div>
          <div className="card">
            <div className="card-v">{result.pulses}</div>
            <div className="card-k">最优脉冲总数</div>
          </div>
          <div className="card">
            <div className="card-v">{result.tied.length}</div>
            <div className="card-k">存在同优计数的位置数</div>
          </div>
          <div className="card">
            <div className="card-v">{result.solveMs.toFixed(1)} ms</div>
            <div className="card-k">求解耗时</div>
          </div>
          <div className="card">
            <div className="card-v">
              {result.m} / {result.k} / {result.n}
            </div>
            <div className="card-k">m / k / n</div>
          </div>
        </div>

        <h3>观测与重建</h3>
        <div className="readout">
          {hover !== null && hover < result.m ? (
            <>
              t={hover}　观测 y={active.y[hover]}　重建={result.recon[hover]}　残差=
              {result.resid[hover]}
            </>
          ) : (
            '在图上悬停查看逐点数值'
          )}
        </div>
        <WaveChart y={active.y} recon={result.recon} hover={hover} setHover={setHover} />

        <h3>有符号残差（观测 − 重建）</h3>
        <ResidChart resid={result.resid} hover={hover} setHover={setHover} />

        <h3>规范脉冲序列与同优计数集合</h3>
        <div className="readout">
          {hover !== null && hover < result.n ? (
            <>
              j={hover}　上限 u={active.u[hover]}　规范 x={result.x[hover]}　可取集合{' '}
              {`{${result.sets[hover].join(',')}}`}
              {result.sets[hover].length > 1 ? '（同优）' : ''}
            </>
          ) : (
            '灰色虚线为上限 u，实心茎为规范解 x'
          )}
        </div>
        <PulseChart result={result} u={active.u} hover={hover} setHover={setHover} />

        <h3>逐位置明细</h3>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>位置 j</th>
                <th>上限 u</th>
                <th>规范解 x</th>
                <th>同优可取计数集合</th>
                <th>标记</th>
              </tr>
            </thead>
            <tbody>
              {result.x.map((v, j) => (
                <tr
                  key={j}
                  className={`${result.sets[j].length > 1 ? 'tied-row' : ''} ${
                    hover === j ? 'hover-row' : ''
                  }`}
                  onMouseEnter={() => setHover(j)}
                  onMouseLeave={() => setHover(null)}
                >
                  <td>{j}</td>
                  <td>{active.u[j]}</td>
                  <td>{v}</td>
                  <td>{`{${result.sets[j].join(', ')}}`}</td>
                  <td>{result.sets[j].length > 1 ? '同优' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        目标层级：min Σ|y−x*h| → min Σx → 字典序最小 x。本页为纯静态页面，不发送任何数据。
      </footer>
    </div>
  );
}
