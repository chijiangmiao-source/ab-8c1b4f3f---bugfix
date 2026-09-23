import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProblem, LIMITS } from '../src/parse.js';

const GOOD_Y = '2, 2, 1, 0, 1, 2, 1, 0, 0, 0, 0, 0';
const GOOD_H = '1, 1';
const GOOD_U = '2';

test('输入校验：合法输入给出可求解问题（单值上限广播）', () => {
  const v = validateProblem(GOOD_Y, GOOD_H, GOOD_U);
  assert.deepEqual(v.errors, []);
  assert.ok(v.problem);
  assert.equal(v.problem.y.length, 12);
  assert.equal(v.problem.h.length, 2);
  assert.equal(v.problem.u.length, 11);
  assert.ok(v.problem.u.every((x) => x === 2));
  assert.deepEqual(v.counts, { m: 12, k: 2, n: 11, uCount: 1 });
});

test('输入校验：等长上限序列', () => {
  const v = validateProblem(GOOD_Y, GOOD_H, '2 1 0 1 2 1 0 1 2 1 0');
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.problem?.u, [2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0]);
});

test('输入校验：非法 token 定位到字段与序号，原因可读', () => {
  const v = validateProblem('1, 2, x, 4, 5, 6, 7, 8, 9, 10, 11, 12', GOOD_H, GOOD_U);
  assert.equal(v.problem, null);
  const e = v.errors.find((e) => e.field === 'waveform');
  assert.ok(e);
  assert.equal(e.index, 2);
  assert.match(e.message, /“x” 不是非负整数/);
});

test('输入校验：负数与小数同样被定位', () => {
  const v = validateProblem(GOOD_Y, '-3, 1.5', GOOD_U);
  assert.equal(v.problem, null);
  const kErrs = v.errors.filter((e) => e.field === 'kernel');
  assert.equal(kErrs.length, 2);
  assert.deepEqual(
    kErrs.map((e) => e.index),
    [0, 1],
  );
});

test('输入校验：波形长度越界', () => {
  const short = validateProblem('1, 2, 3', GOOD_H, GOOD_U);
  assert.equal(short.problem, null);
  assert.match(short.errors.find((e) => e.field === 'waveform')?.message ?? '', /长度须为 12–300/);
  const long = validateProblem(new Array(301).fill('0').join(','), GOOD_H, GOOD_U);
  assert.equal(long.problem, null);
});

test('输入校验：响应核长度与首尾为正', () => {
  const tooShort = validateProblem(GOOD_Y, '5', GOOD_U);
  assert.match(tooShort.errors.find((e) => e.field === 'kernel')?.message ?? '', /长度须为 2–7/);
  const tooLong = validateProblem(GOOD_Y, '1,1,1,1,1,1,1,1', GOOD_U);
  assert.equal(tooLong.problem, null);
  const headZero = validateProblem(GOOD_Y, '0, 1, 1', GOOD_U);
  const e1 = headZero.errors.find((e) => e.field === 'kernel');
  assert.equal(e1?.index, 0);
  assert.match(e1?.message ?? '', /首项必须为正/);
  const tailZero = validateProblem(GOOD_Y, '1, 1, 0', GOOD_U);
  const e2 = tailZero.errors.find((e) => e.field === 'kernel');
  assert.equal(e2?.index, 2);
  assert.match(e2?.message ?? '', /末项必须为正/);
});

test('输入校验：上限范围 0–4 与个数匹配 n', () => {
  const outOfRange = validateProblem(GOOD_Y, GOOD_H, '5');
  assert.equal(outOfRange.problem, null);
  assert.match(outOfRange.errors.find((e) => e.field === 'bounds')?.message ?? '', /超出允许范围/);
  const badCount = validateProblem(GOOD_Y, GOOD_H, '1, 2, 3');
  const e = badCount.errors.find((e) => e.field === 'bounds');
  assert.match(e?.message ?? '', /n=11/);
});

test('输入校验：波形或核无效时上限无法定长', () => {
  const v = validateProblem('1, 2, 3', GOOD_H, '2');
  assert.equal(v.problem, null);
  assert.ok(v.errors.some((e) => e.field === 'bounds' && /无法确定/.test(e.message)));
});

test('输入校验：取值上限守护精确整数运算', () => {
  const big = String(LIMITS.VAL_MAX + 1);
  const v = validateProblem(`${big}, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0`, GOOD_H, GOOD_U);
  assert.equal(v.problem, null);
  assert.match(v.errors.find((e) => e.field === 'waveform')?.message ?? '', /超出允许范围/);
});
