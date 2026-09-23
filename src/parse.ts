// 输入解析与校验。非法输入不产生 Problem，调用方保留并展示最近一次合法输入；
// 每个错误都定位到字段与出错项序号，并说明原因。

import type { Problem } from './solver.js';

export const LIMITS = {
  M_MIN: 12,
  M_MAX: 300,
  K_MIN: 2,
  K_MAX: 7,
  U_MIN: 0,
  U_MAX: 4,
  /** 取值上限：保证 L1 总和远低于 2^53，整数运算精确 */
  VAL_MAX: 1_000_000_000_000,
} as const;

export type Field = 'waveform' | 'kernel' | 'bounds';

export const FIELD_LABEL: Record<Field, string> = {
  waveform: '观测波形',
  kernel: '响应核',
  bounds: '脉冲上限',
};

export interface FieldError {
  field: Field;
  /** 出错项在序列中的序号（从 0 起）；整体性问题为 null */
  index: number | null;
  message: string;
}

export interface Validation {
  /** 全部合法时给出可求解的问题，否则为 null */
  problem: Problem | null;
  errors: FieldError[];
  /** 解析得到的维度信息（即使不合法也尽量给出，便于定位） */
  counts: {
    m: number | null;
    k: number | null;
    n: number | null;
    uCount: number;
  };
}

const SEPARATOR = /[\s,;，、]+/;

interface ParsedTokens {
  values: number[];
  errors: { index: number; message: string }[];
}

function parseTokens(raw: string, max: number): ParsedTokens {
  const values: number[] = [];
  const errors: { index: number; message: string }[] = [];
  const tokens = raw.split(SEPARATOR).filter((t) => t.length > 0);
  tokens.forEach((tok, i) => {
    if (!/^\d+$/.test(tok)) {
      errors.push({ index: i, message: `“${tok}” 不是非负整数` });
      values.push(NaN);
      return;
    }
    const v = Number(tok);
    if (!Number.isSafeInteger(v) || v > max) {
      errors.push({ index: i, message: `“${tok}” 超出允许范围（0 至 ${max}）` });
      values.push(NaN);
      return;
    }
    values.push(v);
  });
  return { values, errors };
}

export function validateProblem(rawY: string, rawH: string, rawU: string): Validation {
  const errors: FieldError[] = [];
  const py = parseTokens(rawY, LIMITS.VAL_MAX);
  const ph = parseTokens(rawH, LIMITS.VAL_MAX);
  const pu = parseTokens(rawU, LIMITS.U_MAX);

  for (const e of py.errors) errors.push({ field: 'waveform', index: e.index, message: e.message });
  for (const e of ph.errors) errors.push({ field: 'kernel', index: e.index, message: e.message });
  for (const e of pu.errors) errors.push({ field: 'bounds', index: e.index, message: e.message });

  const yTokOk = py.errors.length === 0;
  const hTokOk = ph.errors.length === 0;
  const uTokOk = pu.errors.length === 0;

  const m = yTokOk ? py.values.length : null;
  const k = hTokOk ? ph.values.length : null;

  let mValid = yTokOk;
  if (yTokOk && (m! < LIMITS.M_MIN || m! > LIMITS.M_MAX)) {
    errors.push({
      field: 'waveform',
      index: null,
      message: `波形长度须为 ${LIMITS.M_MIN}–${LIMITS.M_MAX}，当前为 ${m}`,
    });
    mValid = false;
  }

  let kValid = hTokOk;
  if (hTokOk && (k! < LIMITS.K_MIN || k! > LIMITS.K_MAX)) {
    errors.push({
      field: 'kernel',
      index: null,
      message: `响应核长度须为 ${LIMITS.K_MIN}–${LIMITS.K_MAX}，当前为 ${k}`,
    });
    kValid = false;
  }
  if (kValid) {
    if (ph.values[0] <= 0) {
      errors.push({ field: 'kernel', index: 0, message: '响应核首项必须为正整数' });
      kValid = false;
    }
    if (ph.values[k! - 1] <= 0) {
      errors.push({ field: 'kernel', index: k! - 1, message: '响应核末项必须为正整数' });
      kValid = false;
    }
  }

  const n = mValid && kValid ? m! - k! + 1 : null;

  let u: number[] | null = null;
  if (uTokOk) {
    if (n === null) {
      errors.push({
        field: 'bounds',
        index: null,
        message: '波形或响应核无效，无法确定应有的上限个数 n = m − k + 1',
      });
    } else if (pu.values.length === 1) {
      u = new Array<number>(n).fill(pu.values[0]); // 单值广播到全部位置
    } else if (pu.values.length === n) {
      u = pu.values.slice();
    } else {
      errors.push({
        field: 'bounds',
        index: null,
        message: `上限个数须为 1（广播）或与脉冲序列等长 n=${n}，当前为 ${pu.values.length}`,
      });
    }
  }

  const problem = mValid && kValid && u !== null ? { y: py.values, h: ph.values, u } : null;
  return {
    problem,
    errors,
    counts: { m, k, n, uCount: pu.values.length },
  };
}
