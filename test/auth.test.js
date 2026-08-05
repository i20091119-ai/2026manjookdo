// Code.gs의 서버 측 비밀번호 검증·토큰 로직 검증.
// Apps Script 서비스(CacheService 등)를 가짜로 끼워 넣고 node로 돌린다.
//   실행:  node test/auth.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.js'), 'utf8');

// ── Apps Script 서비스 스텁 ──
function makeEnv(scriptProps) {
  const store = new Map();
  let uuid = 0;
  let slept = 0;

  const CacheService = { getScriptCache: () => ({
    get:    k => (store.has(k) ? store.get(k) : null),
    put:    (k, v) => { store.set(k, v); },
    remove: k => { store.delete(k); },
  })};
  const PropertiesService = { getScriptProperties: () => ({
    getProperty: k => (scriptProps && k in scriptProps ? scriptProps[k] : null),
  })};
  const Utilities = {
    getUuid: () => 'uuid-' + (++uuid),
    sleep: ms => { slept += ms; },          // 실제로 안 기다린다
    base64Encode: () => 'B64',
  };
  // 시트·드라이브는 이 테스트에서 건드리지 않는다 — 접근하면 실패해야 정상
  const SpreadsheetApp = { openById: () => { throw new Error('시트 접근 불가'); } };
  const DriveApp       = { getFileById: () => { throw new Error('드라이브 접근 불가'); } };
  const Session        = { getActiveUser: () => ({getEmail: () => ''}),
                           getEffectiveUser: () => ({getEmail: () => 'owner@example.com'}) };
  const Logger         = { log: () => {} };
  const HtmlService    = {};

  const fn = new Function(
    'CacheService','PropertiesService','Utilities','SpreadsheetApp','DriveApp','Session','Logger','HtmlService',
    src + '\nreturn {checkPassword, requireAuth_, revokeToken, getAllData, currentPassword_, diagnose, isOwner_};');
  const api = fn(CacheService, PropertiesService, Utilities, SpreadsheetApp, DriveApp, Session, Logger, HtmlService);
  api._slept = () => slept;
  return api;
}

let fail = 0;
const check = (name, cond) => { if (!cond) fail++; console.log((cond?'  ✅ ':'  ❌ ') + name); };
const throws = (name, f, want) => {
  let msg = null;
  try { f(); } catch (e) { msg = e.message; }
  check(name + (msg === want ? '' : `  (던진 값: ${msg})`), msg === want);
};

console.log('\n[기본 비밀번호 3141]');
{
  const A = makeEnv(null);
  check('기본 비밀번호가 3141', A.currentPassword_() === '3141');
  check("'1234' 거부",          A.checkPassword('1234').ok === false);
  check("'314' 거부 (짧음)",    A.checkPassword('314').ok === false);
  check("'31411' 거부 (김)",    A.checkPassword('31411').ok === false);
  check("'' 거부",              A.checkPassword('').ok === false);
  check('null 거부',            A.checkPassword(null).ok === false);
  check('실패 시 지연이 걸린다', A._slept() > 0);

  const ok = A.checkPassword('3141');
  check("'3141' 통과 + 토큰 발급", ok.ok === true && !!ok.token);
  check('비밀번호가 응답에 안 실린다', JSON.stringify(ok).indexOf('3141') === -1);
}

console.log('\n[토큰 검사]');
{
  const A = makeEnv(null);
  const token = A.checkPassword('3141').token;

  check('발급받은 토큰은 통과', (()=>{ try { A.requireAuth_(token); return true; } catch(e){ return false; } })());
  throws('토큰 없이 호출 → AUTH_REQUIRED',      () => A.requireAuth_(),            'AUTH_REQUIRED');
  throws('빈 토큰 → AUTH_REQUIRED',             () => A.requireAuth_(''),          'AUTH_REQUIRED');
  throws('아무 문자열 → AUTH_REQUIRED',         () => A.requireAuth_('아무거나'),   'AUTH_REQUIRED');
  throws('로그아웃 후 그 토큰 → AUTH_REQUIRED', () => { A.revokeToken(token); A.requireAuth_(token); }, 'AUTH_REQUIRED');
}

console.log('\n[getAllData 차단]');
{
  const A = makeEnv(null);
  throws('토큰 없이 getAllData() → AUTH_REQUIRED', () => A.getAllData(),        'AUTH_REQUIRED');
  throws('가짜 토큰 → AUTH_REQUIRED',              () => A.getAllData('가짜'),   'AUTH_REQUIRED');

  const token = A.checkPassword('3141').token;
  const res = A.getAllData(token);
  check('유효 토큰이면 응답한다', !!res && !!res.errors);
  // 이 테스트에선 시트·드라이브 접근이 막혀 있다. 오류는 담되 죽지는 않아야 한다.
  check('시트 4개가 다 실패해도 전체가 죽지 않는다',
        Object.keys(res.errors).length === 4 && Array.isArray(res.free.rows) && res.free.rows.length === 0);
  check('이미지 실패는 자체 처리되어 빈 값으로 온다',
        res.images && res.images.logo === '' && !!res.images.error);
}

console.log('\n[비밀번호를 스크립트 속성으로 바꾼 경우]');
{
  const A = makeEnv({ DASHBOARD_PW: '9182' });
  check('스크립트 속성 값이 우선',  A.currentPassword_() === '9182');
  check("'9182' 통과",             A.checkPassword('9182').ok === true);
  check("기본값 '3141'은 이제 거부", A.checkPassword('3141').ok === false);
}
{
  const A = makeEnv({ DASHBOARD_PW: '   ' });   // 공백만 넣은 경우
  check('빈 속성이면 기본값으로 되돌아간다', A.currentPassword_() === '3141');
}

console.log('\n[익명 호출은 소유자가 아니다]');
{
  const A = makeEnv(null);
  check('익명(getActiveUser 빈 값) → isOwner_ false', A.isOwner_() === false);
  throws('익명이 diagnose() 호출 → AUTH_REQUIRED', () => A.diagnose(), 'AUTH_REQUIRED');
}

console.log('\n[소스에 노출되면 안 되는 것]');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  check('index.html에 비밀번호가 없다', html.indexOf('3141') === -1);
  check('index.html에 CORRECT_PW가 없다', html.indexOf('CORRECT_PW') === -1);

  // google.script.run으로 부를 수 있는 함수 = 이름이 _ 로 끝나지 않는 것
  const pub = (src.match(/^function\s+([A-Za-z0-9_]+)\s*\(/gm) || [])
    .map(s => s.replace(/^function\s+/, '').replace(/\s*\($/, ''))
    .filter(n => !n.endsWith('_'));
  const ALLOWED = ['doGet','checkPassword','revokeToken','getAllData','diagnose',
                   'getImages','parseTs','scoreToNum','toScores','cell','yearKeys'];
  const unexpected = pub.filter(n => ALLOWED.indexOf(n) === -1);
  check('외부에 열린 함수가 예상 목록뿐 ' + (unexpected.length ? '→ ' + unexpected.join(', ') : ''),
        unexpected.length === 0);
  ['getFreeData_','getEducData_','getProgramData_','getCampData_','collectAll_','getSheet_','requireAuth_','currentPassword_']
    .forEach(n => check(n + ' 은 비공개(_)라 외부 호출 불가', src.indexOf('function ' + n + '(') !== -1));
}

console.log(fail ? `\n❌ 실패 ${fail}건\n` : '\n✅ 인증 전부 통과\n');
process.exit(fail ? 1 : 0);
