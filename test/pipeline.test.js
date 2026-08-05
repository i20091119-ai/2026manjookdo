// 전체 파이프라인 검증:
//   가짜 시트 원본 → fetch-sheets.mjs 의 transform() → data.json 모양 → 화면 계산
//
// 컬럼 번호가 밀리면 여기서 잡힌다. 실제 구글 API는 부르지 않는다.
//   실행:  node test/pipeline.test.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0;
const check = (name, cond, extra) => {
  if (!cond) fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (cond || !extra ? '' : '\n       ' + extra));
};
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want),
  `got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);

// ── fetch-sheets.mjs 에서 순수 함수만 떼어 온다 (ESM import 없이) ──
const modSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'fetch-sheets.mjs'), 'utf8');
function grab(name) {
  const m = modSrc.match(new RegExp('export function ' + name + '\\([\\s\\S]*?\\n}'));
  if (!m) throw new Error(name + ' 을 찾지 못했습니다');
  return m[0].replace('export ', '');
}
const P = new Function(
  [grab('parseTs'), grab('scoreToNum'), grab('cell'), grab('toScores'), grab('transform')].join('\n') +
  '\nreturn {parseTs, scoreToNum, cell, toScores, transform};')();

// SOURCES의 map 함수들을 그대로 끌어온다 (컬럼 번호가 진짜 검증 대상)
const SOURCES = new Function(
  [grab('cell'), grab('toScores'), grab('scoreToNum')].join('\n') +
  '\n' + modSrc.match(/const SOURCES = \{[\s\S]*?\n\};/)[0] +
  '\nreturn SOURCES;')();

console.log('\n[컬럼 매핑] 시트 한 줄이 올바른 필드로 들어가는지');

// 자유관람 — A=타임스탬프 B=참여자 C,D=미사용 E~L=문항8 M,N=미사용 O=주1 P=주2
{
  const header = ['타임스탬프','참여자','x','y','프1','프2','프3','프4','시1','시2','시3','시4','m','n','주1','주2'];
  const row = ['2026. 8. 5 오후 2:02', '초등학생 학부모', '', '',
               '매우 만족','만족','보통','매우 만족',      // 프1~4
               '매우 만족','매우 만족','만족','매우 만족',  // 시1~4
               '', '',
               '레이저 미로가 제일 재밌었어요', '화장실이 깨끗했습니다'];
  const out = P.transform([header, row], SOURCES.free, true);
  const r = out.rows[0];
  eq('자유관람 날짜', [r.year, r.month, r.day], [2026, 8, 5]);
  eq('자유관람 참여자(B열)', r.participant, '초등학생 학부모');
  eq('자유관람 문항 8개(E~L)', r.scores, [5,4,3,5,5,5,4,5]);
  eq('자유관람 주1(O열)', r.comment1, '레이저 미로가 제일 재밌었어요');
  eq('자유관람 주2(P열)', r.comment2, '화장실이 깨끗했습니다');
  eq('자유관람 연도 목록', out.years, [2026]);
}

// 교구대여 — B=교구종류 C=학교급 D=설문자 E~H=문항4 I=주관식
{
  const row = ['2026. 7. 1 오전 10:00', 'SW교구', '중학교', '교원',
               '매우 만족','만족','만족','매우 만족', '대여 절차가 편했습니다'];
  const r = P.transform([[], row], SOURCES.educ, true).rows[0];
  eq('교구대여 교구종류(B)', r.toolType, 'SW교구');
  eq('교구대여 학교급(C)',   r.schoolLevel, '중학교');
  eq('교구대여 설문자(D)',   r.respondent, '교원');
  eq('교구대여 문항 4개(E~H)', r.scores, [5,4,4,5]);
  eq('교구대여 주관식(I)',   r.comment1, '대여 절차가 편했습니다');
}

// 학교·가족 — B=프로그램 C=설문자 D~H=프1~5 I~L=시1~4 M~O=주1~3
{
  const row = ['2026. 8. 20', '가족수학체험프로그램', '초등학생',
               '매우 만족','매우 만족','만족','매우 만족','매우 만족',   // 프1~5
               '매우 만족','만족','매우 만족','매우 만족',               // 시1~4
               '주1내용','주2내용','주3내용'];
  const r = P.transform([[], row], SOURCES.prog, true).rows[0];
  eq('학교가족 프로그램종류(B)', r.programType, '가족수학체험프로그램');
  eq('학교가족 설문자(C)', r.respondent, '초등학생');
  eq('학교가족 문항 9개(D~L)', r.scores, [5,5,4,5,5,5,4,5,5]);
  eq('학교가족 주1~3(M~O)', [r.comment1,r.comment2,r.comment3], ['주1내용','주2내용','주3내용']);
  check('문항5(=scores[4])가 강사 만족도 자리', r.scores[4] === 5);
}

// 캠프 — B=캠프종류 C~G=문항5 H=주1 I=주2
{
  const row = ['2026. 8. 10', '중학생 체험수학캠프',
               '매우 만족','매우 만족','만족','매우 만족','매우 만족',
               '캠프 활동이 좋았어요', '강사님이 친절했습니다'];
  const r = P.transform([[], row], SOURCES.camp, true).rows[0];
  eq('캠프 종류(B)', r.campType, '중학생 체험수학캠프');
  eq('캠프 문항 5개(C~G)', r.scores, [5,5,4,5,5]);
  eq('캠프 주1(H)', r.comment1, '캠프 활동이 좋았어요');
  eq('캠프 주2(I)', r.comment2, '강사님이 친절했습니다');
}

console.log('\n[빈 셀·잘못된 행 처리]');
{
  // 구글 시트 API는 뒤쪽 빈 칸을 아예 빼고 준다 — 짧은 배열이 와도 죽으면 안 된다
  const short = ['2026. 8. 1', '초등학생'];
  const r = P.transform([[], short], SOURCES.free, true).rows[0];
  eq('짧은 행 → 점수 전부 null', r.scores, [null,null,null,null,null,null,null,null]);
  eq('짧은 행 → 주관식 빈 문자열', [r.comment1, r.comment2], ['','']);

  const bad = P.transform([[], ['날짜아님','초등학생'], ['', 'x'], ['2026. 8. 1','중학생']],
                          SOURCES.free, true);
  eq('날짜를 못 읽는 행과 빈 행은 버린다', bad.rows.length, 1);
}

console.log('\n[INCLUDE_COMMENTS=false] 주관식 원문 제외');
{
  const row = ['2026. 8. 5', '초등학생', '', '', '매우 만족','만족','보통','만족',
               '매우 만족','매우 만족','만족','매우 만족', '', '', '비밀 의견', '또 다른 의견'];
  const r = P.transform([[], row], SOURCES.free, false).rows[0];
  eq('주관식이 비워진다', [r.comment1, r.comment2], ['','']);
  eq('점수는 그대로 남는다', r.scores, [5,4,3,4,5,5,4,5]);
}

console.log('\n[end-to-end] data.json → 화면 월말 집계');
{
  // 자유관람 3명 + 캠프 2명을 시트 원본 모양으로 만든다
  const freeRows = [
    ['2026. 9. 2', '초등학생',        '','', '매우 만족','매우 만족','만족','매우 만족','매우 만족','매우 만족','매우 만족','매우 만족'],
    ['2026. 9. 3', '초등학생 학부모', '','', '매우 만족','만족','만족','매우 만족','매우 만족','매우 만족','매우 만족','매우 만족'],
    ['2026. 9. 4', '중학생',          '','', '만족','만족','만족','만족','만족','만족','만족','만족'],
  ];
  const campRows = [
    ['2026. 9. 5', '초등학생 SW캠프', '매우 만족','매우 만족','매우 만족','매우 만족','매우 만족'],
    ['2026. 9. 6', '초등학생 SW캠프', '만족','만족','만족','보통','만족'],
  ];

  // 실제 배포에서 site/data.json 이 갖는 모양 그대로 만든다
  const dataJson = {
    generatedAt: '2026-09-07T00:00:00.000Z',
    includeComments: true,
    errors: {},
    free: P.transform([[], ...freeRows], SOURCES.free, true),
    educ: { years: [], rows: [] },
    prog: { years: [], rows: [] },
    camp: P.transform([[], ...campRows], SOURCES.camp, true),
  };

  // 사이트 스크립트를 DOM 스텁 위에 올린다
  const el = () => ({
    style:{}, classList:{add(){},remove(){},toggle(){}}, innerHTML:'', textContent:'',
    value:'', src:'', disabled:false, addEventListener(){}, appendChild(){}, focus(){}, onclick:null,
  });
  const document = { getElementById: el, querySelector: el, querySelectorAll: () => [],
                     createElement: el, body:{appendChild(){},removeChild(){}}, execCommand(){} };
  const win = {};
  const site = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8')
                 .match(/<script>([\s\S]*)<\/script>/)[1];
  const M = new Function('document','sessionStorage','navigator','window','console','fetch',
    site + '\nreturn {buildReport, setD:(d)=>{DATA=d}};')(
      document, {getItem:()=>null,setItem(){}}, {}, win, console, () => Promise.reject(new Error('n/a')));

  M.setD(dataJson);
  M.buildReport(2026, 9);
  const T = win._repTSV;

  const SURVEY = ['1-(01)','1-(02)','1-(03)','1-(04)','1-(05)','1-(06)','1-(08)','1-(09)','1-(10)'];
  const i = n => SURVEY.indexOf(n);
  const NO = ['1-(01)','1-(02)','1-(03)','1-(04)','1-(05)','1-(06)','1-(07)','1-(08)','1-(09)','1-(10)','1-(11)','2-(1)','2-(2)','2-(3)'];

  // 자유관람 3명: 초1 + 보호자1 + 중1
  eq('표1 자유관람 → 초1 중1 보호자1 소계3',
     T.t1[NO.indexOf('1-(10)')], ['O','',1,1,'','',1,'',3]);
  // 캠프 2명 모두 초등학생 SW캠프 → 1-(04)
  eq('표1 학생SW체험캠프 → 초2 소계2', T.t1[NO.indexOf('1-(04)')], ['O','',2,'','','','','',2]);
  eq('표1 학생체험수학캠프 → 응답 없음(0건이지만 원천은 있음)',
     T.t1[NO.indexOf('1-(03)')], ['','','','','','','','','']);

  // 자유관람 문항1: 매우만족2, 만족1 → 합계3, 만족이상3
  eq('표3 자유관람 문항1', T.t3[i('1-(10)')].slice(0,7), [2,1,'','','',3,3]);
  // 캠프 문항4: 매우만족1, 보통1 → 만족이상1
  eq('표3 학생SW캠프 문항4', T.t3[i('1-(04)')].slice(21,28), [1,'',1,'','',2,1]);
  // 캠프 만족도: 문항1~4 만족이상 = 2+2+2+1 = 7 / (2×4) = 87.5%
  eq('표4 학생SW캠프 → 7/8 = 87.5%, 강사 2/2 = 100%',
     T.t4[i('1-(04)')], [2,4,7,'87.5',2,1,2,'100.0']);
}

console.log('\n[구조] 사이트가 Apps Script에 의존하지 않는지');
{
  const site = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
  check('google.script.run 호출이 없다', !site.includes('google.script.run'));
  check("data.json 을 fetch 한다", site.includes("fetch('data.json"));
  check('비밀번호 상수가 없다', !site.includes('CORRECT_PW') && !site.includes('3141'));
  check('site/index.html 이 외부 스크립트를 안 부른다', !/<script[^>]+src=/.test(site));
}

console.log(fail ? `\n❌ 실패 ${fail}건\n` : '\n✅ 파이프라인 전부 통과\n');
process.exit(fail ? 1 : 0);
