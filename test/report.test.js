// 월말 집계 로직 검증 — 2026년 8월 실제 보고서 수치를 기준으로 삼는다.
//   실행:  node test/report.test.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
const code = src.match(/<script>([\s\S]*)<\/script>/)[1];

// ── 최소 DOM 스텁 ──
const el = () => ({
  style:{}, classList:{add(){},remove(){},toggle(){}}, innerHTML:'', textContent:'',
  value:'', src:'', disabled:false, addEventListener(){}, appendChild(){}, focus(){}, onclick:null,
});
const document = {
  getElementById: el, querySelector: el, querySelectorAll: () => [], createElement: el,
  body:{appendChild(){},removeChild(){}}, execCommand(){},
};
const sessionStorage = { getItem: () => null, setItem(){} };
const google = undefined;   // 정적 사이트라 Apps Script 호출이 없다
const navigator = {};
const win = {};

const fetchStub = () => Promise.reject(new Error('테스트에서는 data.json을 받지 않는다'));
const fn = new Function('document','sessionStorage','navigator','window','console','fetch',
  code + '\nreturn {buildReport, DATA, setD:(d)=>{DATA=d}, classifyPerson, reportCat, schoolLevelOfCamp, itemStat};');
const M = fn(document, sessionStorage, navigator, win, console, fetchStub);

// ── 스크린샷 수치를 재현하는 합성 데이터 ──
// 지정한 문항별 분포가 정확히 나오도록 행을 만든다.
function mkRows(n, dists, extra) {
  // dists: [{5:x,4:y,3:z,...}, ...] 문항별 목표 분포
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({year:2026, month:8, day:5, scores:[], ...extra(i)});
  dists.forEach((dist, q) => {
    let i = 0;
    [5,4,3,2,1].forEach(s => { for (let k = 0; k < (dist[s]||0); k++) rows[i++].scores[q] = s; });
    while (i < n) rows[i++].scores[q] = null;
  });
  return rows;
}

// 자유관람 65명: 초31 / 중1 / 고1 / 보호자32
const freeWho = i => ({ participant: i<31 ? '초등학생' : i<32 ? '중학생' : i<33 ? '고등학생' : '초등학생 학부모' });
const free = mkRows(65, [
  {5:52,4:11,3:2}, {5:45,4:14,3:6}, {5:43,4:20,3:2}, {5:51,4:12,3:2},
  {5:65},{5:65},{5:65},{5:65},   // 시설 문항(집계에 안 쓰임)
], freeWho);

// 가족수학 44명: 초22 / 보호자22
const progWho = i => ({ programType:'가족수학체험프로그램', respondent: i<22 ? '학생' : '학부모' });
const prog = mkRows(44, [
  {5:44}, {5:42,4:2}, {5:42,4:2}, {5:41,4:3}, {5:41,4:3},
  {5:44},{5:44},{5:44},{5:44},
], progWho);

// 캠프 — 새로 물린 부분. 초등수학 10명 / 중등수학 4명 / 초등SW 6명
const campRows = [];
[['초등학생 체험수학캠프',10],['중학생 체험수학캠프',4],['초등학생 SW캠프',6]].forEach(([t,n])=>{
  for (let i=0;i<n;i++) campRows.push({year:2026,month:8,day:10,campType:t,scores:[5,5,4,5,5]});
});

M.setD({ free:{years:[2026],rows:free}, educ:{years:[],rows:[]},
         prog:{years:[2026],rows:prog}, camp:{years:[2026],rows:campRows} });

M.buildReport(2026, 8);
const T = win._repTSV;

// ── 검증 ──
let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) fail++;
  console.log((ok?'  ✅ ':'  ❌ ') + name + (ok?'' : `\n       got  ${g}\n       want ${w}`));
};

const NO = ['1-(01)','1-(02)','1-(03)','1-(04)','1-(05)','1-(06)','1-(07)','1-(08)','1-(09)','1-(10)','1-(11)','2-(1)','2-(2)','2-(3)'];
const idx1 = n => NO.indexOf(n);
const SURVEY = ['1-(01)','1-(02)','1-(03)','1-(04)','1-(05)','1-(06)','1-(08)','1-(09)','1-(10)'];
const idxS = n => SURVEY.indexOf(n);

console.log('\n[표1] 운영 현황 — 운영본원, 유/초/중/고/교원/보호자/일반, 소계');
eq('1-(08) 가족수학  → 초22 보호자22 소계44', T.t1[idx1('1-(08)')], ['O','',22,'','','',22,'',44]);
eq('1-(10) 자유관람  → 초31 중1 고1 보호자32 소계65', T.t1[idx1('1-(10)')], ['O','',31,1,1,'',32,'',65]);
eq('1-(03) 학생체험수학캠프 → 초10 중4 소계14 (신규)', T.t1[idx1('1-(03)')], ['O','',10,4,'','','','',14]);
eq('1-(04) 학생SW체험캠프  → 초6 소계6 (신규)',        T.t1[idx1('1-(04)')], ['O','',6,'','','','','',6]);
eq('1-(07) 페스티벌 → 전부 빈칸 (양식만)', T.t1[idx1('1-(07)')], ['','','','','','','','','']);

console.log('\n[표2] 참여자 현황 — 초/중/고/교원/보호자/그외, 소계');
eq('1-(08) 가족수학', T.t2[idxS('1-(08)')], [22,'','','',22,'',44]);
eq('1-(10) 자유관람', T.t2[idxS('1-(10)')], [31,1,1,'',32,'',65]);

console.log('\n[표3] 만족도 통계 — 문항별 [매우만족,만족,보통,불만족,매우불만족,합계,만족이상]');
const q = (row, n) => row.slice((n-1)*7, n*7);
eq('자유관람 문항1', q(T.t3[idxS('1-(10)')],1), [52,11,2,'','',65,63]);
eq('자유관람 문항2', q(T.t3[idxS('1-(10)')],2), [45,14,6,'','',65,59]);
eq('자유관람 문항3', q(T.t3[idxS('1-(10)')],3), [43,20,2,'','',65,63]);
eq('자유관람 문항4', q(T.t3[idxS('1-(10)')],4), [51,12,2,'','',65,63]);
eq('자유관람 문항5 → 강사 문항 없음 → 빈칸', q(T.t3[idxS('1-(10)')],5), ['','','','','','','']);
eq('가족수학 문항1', q(T.t3[idxS('1-(08)')],1), [44,'','','','',44,44]);
eq('가족수학 문항4', q(T.t3[idxS('1-(08)')],4), [41,3,'','','',44,44]);
eq('가족수학 문항5(강사)', q(T.t3[idxS('1-(08)')],5), [41,3,'','','',44,44]);

console.log('\n[표4] 만족도 결과 — [응답자,문항수,만족이상합,만족도%] × [프로그램, 강사]');
eq('자유관람 65명 → 248/260 = 95.4%', T.t4[idxS('1-(10)')], [65,4,248,'95.4','','','','']);
eq('가족수학 44명 → 176/176 = 100.0%, 강사 44/44 = 100.0%', T.t4[idxS('1-(08)')], [44,4,176,'100.0',44,1,44,'100.0']);
eq('1-(01) 응답 0건 → 0/4/0 + 만족도 빈칸', T.t4[idxS('1-(01)')], [0,4,0,'',0,1,0,'']);
eq('1-(05) 교구대여 0건 → 강사칸 전부 빈칸', T.t4[idxS('1-(05)')], [0,4,0,'','','','','']);
eq('1-(03) 캠프 14명 → 만족이상 14*4=56 중 실제 56, 강사 14 (신규)',
   T.t4[idxS('1-(03)')], [14,4,56,'100.0',14,1,14,'100.0']);

console.log('\n[분류] 긴 키 우선 검사');
eq("'초등학생 학부모' → 보호자", M.classifyPerson('초등학생 학부모'), '보호자');
eq("'유아 학부모' → 보호자",     M.classifyPerson('유아 학부모'), '보호자');
eq("'초등학생' → 초",            M.classifyPerson('초등학생'), '초');
eq("'학생'(구버전) → 초",        M.classifyPerson('학생'), '초');
eq("'교직원' → 교원",            M.classifyPerson('교직원'), '교원');
eq("캠프 '고등학생 인공지능수학캠프' → 고", M.schoolLevelOfCamp('고등학생 인공지능수학캠프'), '고');

console.log(fail ? `\n❌ 실패 ${fail}건\n` : '\n✅ 전부 통과\n');
process.exit(fail ? 1 : 0);
