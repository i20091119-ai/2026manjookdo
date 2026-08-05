// scoreToNum() 검증 — 시트에 섞여 들어오는 표현들을 모두 인식하는지 본다.
//   실행:  node test/score.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fetch-sheets.mjs'), 'utf8');
const body = src.match(/export function scoreToNum\(str\)[\s\S]*?\n}/)[0].replace('export ', '');
const scoreToNum = new Function(body + '\nreturn scoreToNum;')();

const CASES = [
  // 신버전
  ['매우 만족', 5], ['만족', 4], ['보통', 3], ['불만족', 2], ['매우 불만족', 1],
  ['매우만족', 5], ['매우불만족', 1],
  // 구버전
  ['매우 그렇다', 5], ['그렇다', 4], ['보통이다', 3], ['그렇지 않다', 2], ['전혀 그렇지 않다', 1],
  // 복합형
  ['매우 만족(매우 그렇다)', 5],
  ['만족(그렇다)', 4],
  ['보통(보통이다)', 3],
  ['불만족(그렇지 않다)', 2],
  ['매우 불만족(전혀 그렇지 않다)', 1],
  // 선형 배율
  ['5', 5], ['4', 4], ['3', 3], ['2', 2], ['1', 1], [5, 5], [1, 1],
  // 공백·빈값
  ['  매우 만족  ', 5], ['', null], [null, null], [undefined, null],
  // 인식 불가
  ['해당없음', null], ['모르겠다', null],
];

let fail = 0;
CASES.forEach(([input, want]) => {
  const got = scoreToNum(input);
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? '  ✅ ' : '  ❌ ') + JSON.stringify(input) + ' → ' + got + (ok ? '' : '  (기대: ' + want + ')'));
});

console.log(fail ? `\n❌ 실패 ${fail}건\n` : '\n✅ scoreToNum 전부 통과\n');
process.exit(fail ? 1 : 0);
