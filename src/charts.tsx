// 联动 SVG 图表：观测/重建、有符号残差、规范脉冲与同优计数集合。
// 三个图共享同一个 hover 下标，任一图上的悬停都会在其余图中标出同一位置。

import type { MouseEvent } from 'react';
import type { SolveResult } from './solver.js';

export interface HoverProps {
  hover: number | null;
  setHover: (i: number | null) => void;
}

const W = 960;
const H = 240;
const PL = 46;
const PR = 14;
const PT = 14;
const PB = 30;
const IW = W - PL - PR;
const IH = H - PT - PB;

function indexFromMouse(e: MouseEvent<SVGSVGElement>, count: number): number | null {
  const rect = e.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const mx = ((e.clientX - rect.left) / rect.width) * W;
  const t = Math.round(((mx - PL) / IW) * count - 0.5);
  return t >= 0 && t < count ? t : null;
}

function xTicks(count: number): number[] {
  const step = Math.max(1, Math.ceil(count / 16));
  const ticks: number[] = [];
  for (let t = 0; t < count; t += step) ticks.push(t);
  return ticks;
}

function Frame({ count, maxV, minV }: { count: number; maxV: number; minV: number }) {
  const sy = (v: number) => PT + IH - ((v - minV) / (maxV - minV)) * IH;
  return (
    <g className="frame">
      <line x1={PL} y1={PT} x2={PL} y2={PT + IH} />
      <line x1={PL} y1={PT + IH} x2={PL + IW} y2={PT + IH} />
      <text x={PL - 6} y={sy(maxV) + 3} className="tick" textAnchor="end">
        {maxV}
      </text>
      <text x={PL - 6} y={sy(minV) + 3} className="tick" textAnchor="end">
        {minV}
      </text>
      {minV < 0 && (
        <>
          <line x1={PL} y1={sy(0)} x2={PL + IW} y2={sy(0)} className="zero" />
          <text x={PL - 6} y={sy(0) + 3} className="tick" textAnchor="end">
            0
          </text>
        </>
      )}
      {xTicks(count).map((t) => (
        <text key={t} x={PL + ((t + 0.5) / count) * IW} y={H - 10} className="tick" textAnchor="middle">
          {t}
        </text>
      ))}
    </g>
  );
}

interface WaveChartProps extends HoverProps {
  y: number[];
  recon: number[];
}

/** 观测波形与规范解重建波形。 */
export function WaveChart({ y, recon, hover, setHover }: WaveChartProps) {
  const m = y.length;
  const maxV = Math.max(1, ...y, ...recon);
  const sx = (t: number) => PL + ((t + 0.5) / m) * IW;
  const sy = (v: number) => PT + IH - (v / maxV) * IH;
  const path = (arr: number[]) =>
    arr.map((v, t) => `${t === 0 ? 'M' : 'L'}${sx(t).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart"
      onMouseMove={(e) => setHover(indexFromMouse(e, m))}
      onMouseLeave={() => setHover(null)}
    >
      <Frame count={m} maxV={maxV} minV={0} />
      <path d={path(y)} className="series-obs" />
      <path d={path(recon)} className="series-rec" />
      {m <= 100 &&
        y.map((v, t) => <circle key={t} cx={sx(t)} cy={sy(v)} r={2.2} className="dot-obs" />)}
      {hover !== null && hover < m && (
        <g className="guide">
          <line x1={sx(hover)} y1={PT} x2={sx(hover)} y2={PT + IH} />
          <circle cx={sx(hover)} cy={sy(y[hover])} r={4} className="dot-obs" />
          <circle cx={sx(hover)} cy={sy(recon[hover])} r={4} className="dot-rec" />
        </g>
      )}
    </svg>
  );
}

interface ResidChartProps extends HoverProps {
  resid: number[];
}

/** 有符号残差（观测 − 重建）。 */
export function ResidChart({ resid, hover, setHover }: ResidChartProps) {
  const m = resid.length;
  const maxAbs = Math.max(1, ...resid.map((r) => Math.abs(r)));
  const sx = (t: number) => PL + ((t + 0.5) / m) * IW;
  const sy = (v: number) => PT + IH - ((v + maxAbs) / (2 * maxAbs)) * IH;
  const bw = Math.max(1, IW / m - 1);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart"
      onMouseMove={(e) => setHover(indexFromMouse(e, m))}
      onMouseLeave={() => setHover(null)}
    >
      <Frame count={m} maxV={maxAbs} minV={-maxAbs} />
      {resid.map((r, t) => (
        <rect
          key={t}
          x={sx(t) - bw / 2}
          y={r >= 0 ? sy(r) : sy(0)}
          width={bw}
          height={Math.max(1, Math.abs(sy(r) - sy(0)))}
          className={r >= 0 ? 'bar-pos' : 'bar-neg'}
        />
      ))}
      {hover !== null && hover < m && (
        <line x1={sx(hover)} y1={PT} x2={sx(hover)} y2={PT + IH} className="guide" />
      )}
    </svg>
  );
}

interface PulseChartProps extends HoverProps {
  result: SolveResult;
  u: number[];
}

/** 规范脉冲序列（茎图）与同优计数集合标注。 */
export function PulseChart({ result, u, hover, setHover }: PulseChartProps) {
  const { x, sets, tied } = result;
  const n = x.length;
  const maxV = Math.max(1, ...u);
  const sx = (j: number) => PL + ((j + 0.5) / n) * IW;
  const sy = (v: number) => PT + IH - (v / maxV) * IH;
  const step = IW / n;
  const tiedSet = new Set(tied);
  // 相邻同优位置的集合标注上下交错，避免文字重叠
  const labelLevel = new Map<number, number>();
  let prev = -2;
  let level = 0;
  for (const j of tied) {
    level = j === prev + 1 ? 1 - level : 0;
    labelLevel.set(j, level);
    prev = j;
  }
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart"
      onMouseMove={(e) => setHover(indexFromMouse(e, n))}
      onMouseLeave={() => setHover(null)}
    >
      <Frame count={n} maxV={maxV} minV={0} />
      {tied.map((j) => (
        <rect
          key={j}
          x={sx(j) - step / 2}
          y={PT}
          width={step}
          height={IH}
          className="tied-band"
        />
      ))}
      {x.map((v, j) => (
        <g key={j}>
          <line x1={sx(j)} y1={sy(0)} x2={sx(j)} y2={sy(u[j])} className="stem-cap" />
          <line x1={sx(j)} y1={sy(0)} x2={sx(j)} y2={sy(v)} className="stem" />
          {v > 0 && <circle cx={sx(j)} cy={sy(v)} r={3} className="dot-pulse" />}
          {tiedSet.has(j) && (
            <text
              x={sx(j)}
              y={H - 12 - (labelLevel.get(j) ?? 0) * 11}
              className="tied-label"
              textAnchor="middle"
            >
              {`{${sets[j].join(',')}}`}
            </text>
          )}
        </g>
      ))}
      {hover !== null && hover < n && (
        <line x1={sx(hover)} y1={PT} x2={sx(hover)} y2={PT + IH} className="guide" />
      )}
    </svg>
  );
}
