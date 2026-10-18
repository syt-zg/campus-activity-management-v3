/*
 * V3.0 冒烟测试（可复跑）
 * ------------------------------------------------------------------
 * 目的：把"验证"变成可执行的证据，而不是演示一遍没报错。
 * 覆盖：资格校验 / 候补排队 / 取消原因留痕 / 递补确认窗口 / 超时释放顺延
 *      / 出席记录 / 名单导出 / 运行统计与事件日志。
 *
 * 运行：
 *   node tests/v3-smoke.js
 * 说明：使用临时数据目录，不会污染 data/ 下的真实数据。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-v3-test-'));
process.env.CAMPUS_ACTIVITY_DATA_DIR = DATA_DIR;
process.env.WAITLIST_CONFIRM_HOURS = '0.0012';  // 约 4.3 秒，避免等真实的 24 小时
process.env.JWT_SECRET = 'test-secret';

const { startServer, stopServer } = require('../src/app');

let pass = 0, fail = 0;
const results = [];
function check(name, condition, extra = '') {
  if (condition) { pass += 1; results.push('  [PASS] ' + name + (extra ? '  → ' + extra : '')); }
  else { fail += 1; results.push('  [FAIL] ' + name + (extra ? '  → ' + extra : '')); }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeClient(base) {
  return async function call(pathname, { method = 'GET', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* CSV 等非 JSON 响应 */ }
    return { status: res.status, json, text, data: json ? json.data : null, code: json ? json.code : null, msg: json ? json.msg : '' };
  };
}

(async () => {
  const port = await startServer(0);
  const base = 'http://127.0.0.1:' + port;
  const call = makeClient(base);
  console.log('测试服务已启动：' + base + '\n数据目录：' + DATA_DIR + '\n');

  /* ---------- 1. 登录与基础数据 ---------- */
  const teacherLogin = await call('/api/auth/login', { method: 'POST', body: { username: '10001', password: '123456' } });
  const teacherToken = teacherLogin.data.token;
  const studentALogin = await call('/api/auth/login', { method: 'POST', body: { username: '2021001', password: '123456' } }); // 计算机2101班
  const studentAToken = studentALogin.data.token;
  const studentBLogin = await call('/api/auth/login', { method: 'POST', body: { username: '2021002', password: '123456' } }); // 英语2102班
  const studentBToken = studentBLogin.data.token;
  const adminLogin = await call('/api/auth/login', { method: 'POST', body: { username: '90000', password: '123456' } });
  const adminToken = adminLogin.data.token;
  check('三角色均可登录', Boolean(teacherToken && studentAToken && studentBToken && adminToken));

  /* ---------- 2. 资格校验生效（V2.0 的 R08 只存不校验） ---------- */
  const limited = await call('/api/activity', {
    method: 'POST', token: teacherToken,
    body: {
      title: '资格限定活动', type: '讲座培训', content: '仅限计算机专业', place: 'A101',
      start_time: '2030-01-01 09:00', end_time: '2030-01-01 11:00', max_num: 2,
      require_review: false, eligibility: '仅限计算机专业学生', eligibility_rule: '计算机'
    }
  });
  const limitedId = limited.data.id;
  const blocked = await call('/api/activity/' + limitedId + '/join', { method: 'POST', token: studentBToken });
  check('不符合资格的学生被拒绝报名', blocked.code !== 200 && /计算机/.test(blocked.msg), blocked.msg);
  const allowed = await call('/api/activity/' + limitedId + '/join', { method: 'POST', token: studentAToken });
  check('符合资格的学生可正常报名', allowed.code === 200, allowed.msg);

  /* ---------- 3. 候补排队 + 取消原因 + 递补 ---------- */
  const open = await call('/api/activity', {
    method: 'POST', token: teacherToken,
    body: {
      title: '名额紧张活动', type: '文体活动', content: '测试候补', place: 'B201',
      start_time: '2030-02-01 09:00', end_time: '2030-02-01 11:00', max_num: 1
    }
  });
  const openId = open.data.id;
  const regC = await call('/api/auth/register', { method: 'POST', body: { username: '2021003', password: '123456', real_name: '张三', class_name: '计算机2102班' } });
  const regD = await call('/api/auth/register', { method: 'POST', body: { username: '2021004', password: '123456', real_name: '李四', class_name: '数学2101班' } });
  check('可注册新学生', regC.code === 200 && regD.code === 200);
  const cLogin = await call('/api/auth/login', { method: 'POST', body: { username: '2021003', password: '123456' } });
  const dLogin = await call('/api/auth/login', { method: 'POST', body: { username: '2021004', password: '123456' } });
  const tokenC = cLogin.data.token;
  const tokenD = dLogin.data.token;

  const joinA = await call('/api/activity/' + openId + '/join', { method: 'POST', token: studentAToken });
  const joinC = await call('/api/activity/' + openId + '/join', { method: 'POST', token: tokenC });
  const joinD = await call('/api/activity/' + openId + '/join', { method: 'POST', token: tokenD });
  check('第 1 人直接确定为正式参加', joinA.data.registration.status === '正式参加', joinA.data.registration.status);
  check('满员后第 2 人进入候补', joinC.data.registration.status === '候补中' && joinC.data.registration.position === 1, '第 ' + joinC.data.registration.position + ' 位');
  check('第 3 人候补位次为 2', joinD.data.registration.position === 2, '第 ' + joinD.data.registration.position + ' 位');

  // 正式参加者取消：应记录原因并自动递补候补第 1 位
  const cancelA = await call('/api/activity/' + openId + '/join', { method: 'DELETE', token: studentAToken, body: { reason: '时间冲突', note: '与实验课冲突' } });
  check('取消时记录原因并触发自动递补', cancelA.code === 200 && cancelA.data.promotedCount >= 1, '递补 ' + (cancelA.data.promotedNames || []).join('、'));

  const listAfter = await call('/api/activity/' + openId, { token: studentAToken });
  check('递补后出现“待确认”状态', listAfter.data.needConfirmCount >= 1, '待确认 ' + listAfter.data.needConfirmCount + ' 人');

  const cDetail = await call('/api/activity/' + openId, { token: tokenC });
  const regCInfo = cDetail.data.myRegistration;
  check('被递补学生本人看到确认截止时间', regCInfo.needConfirm && Boolean(regCInfo.confirmDeadline), regCInfo.confirmDeadline);

  /* ---------- 4. 确认窗口超时 → 释放并顺延 ---------- */
  // C 故意不确认，等窗口过期（测试用 0.0012 小时 ≈ 4.3 秒）后读取名单触发惰性结算
  await sleep(5200);
  const afterExpire = await call('/api/activity/' + openId + '/joinlist', { token: teacherToken });
  const expiredInList = (afterExpire.data.cancellations || []).some(item => /自动释放/.test(item.reason));
  check('超时未确认的名额被自动释放并留痕', expiredInList, '取消流水 ' + (afterExpire.data.cancellations || []).length + ' 条');
  check('取消原因已完整记录', (afterExpire.data.cancellations || []).some(item => /时间冲突/.test(item.reason)), JSON.stringify((afterExpire.data.cancellations || []).map(i => i.reason)));

  const rowsAfterExpire = (afterExpire.data.registrations || []);
  const dRow = rowsAfterExpire.find(item => Number(item.userId) === Number(dLogin.data.user.id));
  check('释放后顺延递补给下一位候补', Boolean(dRow) && dRow.status === '正式参加', dRow ? dRow.status : '未找到');

  const dConfirm = await call('/api/activity/' + openId + '/confirm', { method: 'POST', token: tokenD });
  check('学生可主动确认名额', dConfirm.code === 200 && dConfirm.data.registration.confirmedTime !== '', dConfirm.msg);

  /* ---------- 5. 出席记录 ---------- */
  // 签到只允许在活动开始后进行，因此把该活动的时间改到过去（报名逻辑已在上一步验证完）
  await call('/api/activity/' + openId, {
    method: 'PUT', token: teacherToken,
    body: {
      title: '名额紧张活动', type: '文体活动', content: '测试候补', place: 'B201',
      start_time: '2020-01-01 09:00', end_time: '2020-01-01 11:00', max_num: 1
    }
  });
  const listForCheckin = await call('/api/activity/' + openId + '/joinlist', { token: teacherToken });
  const approvedRows = (listForCheckin.data.registrations || []).filter(item => item.status === '正式参加');
  check('活动开始后教师可查看名单', listForCheckin.code === 200, '正式 ' + approvedRows.length + ' 人');
  if (approvedRows.length) {
    const marked = await call('/api/activity/' + openId + '/checkin', { method: 'PUT', token: teacherToken, body: { userId: approvedRows[0].userId, attended: true } });
    check('教师可标记出席', marked.code === 200, marked.msg);
    check('统计中出现出席人数', marked.code === 200 && (marked.data.summary.attendedCount || 0) >= 1, '已出席 ' + (marked.data ? marked.data.summary.attendedCount : '—'));
  } else {
    check('教师可标记出席', false, '没有正式参加记录可标记');
  }

  /* ---------- 6. 导出名单 ---------- */
  const csv = await call('/api/activity/' + openId + '/export', { token: teacherToken });
  check('名单可导出为 CSV（含表头与出席列）', /序号,姓名,学号,班级/.test(csv.text) && /出席情况/.test(csv.text));

  /* ---------- 7. 归档（软删除）保留历史 ---------- */
  const archived = await call('/api/activity/' + limitedId, { method: 'DELETE', token: teacherToken });
  const listAfterArchive = await call('/api/activity/list', { token: studentAToken });
  check('删除活动后列表不再展示', archived.code === 200 && !listAfterArchive.data.list.some(item => item.id === limitedId));

  /* ---------- 8. 运行统计与事件日志 ---------- */
  const metrics = await call('/api/admin/metrics?days=7', { token: adminToken });
  check('管理员可获取运行统计', metrics.code === 200 && metrics.data.funnel && metrics.data.rates !== undefined);
  check('统计含取消原因分布', Array.isArray(metrics.data.cancelReasons) && metrics.data.cancelReasons.length >= 1, JSON.stringify(metrics.data.cancelReasons.slice(0, 3)));
  check('统计含按活动类型聚合', Array.isArray(metrics.data.byType) && metrics.data.byType.length >= 1);
  check('统计含近 7 天趋势', Array.isArray(metrics.data.trend) && metrics.data.trend.length === 7);
  check('统计含接口耗时分布', metrics.data.perf && metrics.data.perf.p95 !== null, 'P95 ' + (metrics.data.perf ? metrics.data.perf.p95 : '—') + 'ms');
  check('统计含候补压力', Array.isArray(metrics.data.waitlistPressure));

  const events = await call('/api/admin/events?limit=200', { token: adminToken });
  const types = new Set((events.data.list || []).map(item => item.type));
  check('事件日志覆盖关键类型', ['login', 'activity_create', 'join_approved', 'join_waitlist', 'join_blocked', 'cancel', 'promote', 'waitlist_expire', 'checkin', 'export', 'activity_archive'].every(type => types.has(type)), Array.from(types).join(','));

  const filtered = await call('/api/admin/events?type=cancel&limit=50', { token: adminToken });
  check('事件可按类型筛选', (filtered.data.list || []).every(item => item.type === 'cancel'));

  /* ---------- 9. V3.0 对照数据包新增的两项能力 ---------- */
  const idem = await call('/api/activity', {
    method: 'POST', token: teacherToken,
    body: {
      title: '幂等校验活动', type: '技能提升', content: '验证重复提交去重', place: 'D401',
      start_time: '2030-04-01 09:00', end_time: '2030-04-01 11:00', max_num: 5
    }
  });
  const rid = 'test-rid-' + Date.now();
  const first = await call('/api/activity/' + idem.data.id + '/join', { method: 'POST', token: studentAToken, body: { requestId: rid } });
  const second = await call('/api/activity/' + idem.data.id + '/join', { method: 'POST', token: studentAToken, body: { requestId: rid } });
  check('同 requestId 重复提交被去重', second.code === 200 && /已处理过/.test(second.msg), second.msg);
  const idemDetail = await call('/api/activity/' + idem.data.id, { token: teacherToken });
  check('重复提交未重复占用名额', idemDetail.data.approvedCount === 1, '正式 ' + idemDetail.data.approvedCount + ' 人');
  const third = await call('/api/activity/' + idem.data.id + '/join', { method: 'POST', token: studentAToken, body: { requestId: rid + '-new' } });
  check('换 requestId 后仍按“已报名”拒绝', third.code !== 200 && /已报名/.test(third.msg), third.msg);

  // 候补深度信息（模拟数据显示热门活动候补可达名额 3～5 倍）
  const depth = await call('/api/activity', {
    method: 'POST', token: teacherToken,
    body: {
      title: '候补深度校验活动', type: '文化艺术', content: '验证候补提示', place: 'E501',
      start_time: '2030-05-01 09:00', end_time: '2030-05-01 11:00', max_num: 1
    }
  });
  const depthFull = await call('/api/activity/' + depth.data.id + '/join', { method: 'POST', token: tokenD, body: { requestId: 'depth-a-' + Date.now() } });
  const depthWait = await call('/api/activity/' + depth.data.id + '/join', { method: 'POST', token: tokenC, body: { requestId: 'depth-b-' + Date.now() } });
  check('满员后报名响应返回候补深度信息',
    depthFull.code === 200 && depthWait.data && depthWait.data.waitlistDepth && depthWait.data.waitlistDepth.count === 1,
    depthWait.data ? JSON.stringify(depthWait.data.waitlistDepth) : depthWait.msg);

  // 错峰开放：未到开放时间应拒绝报名（模拟数据 24 个活动只有 09:00/18:00 两个开放时刻）
  const staggered = await call('/api/activity', {
    method: 'POST', token: teacherToken,
    body: {
      title: '错峰开放校验', type: '公益实践', content: '验证开放时间', place: 'F601',
      start_time: '2030-07-01 09:00', end_time: '2030-07-01 11:00', max_num: 10,
      registration_open: '2030-06-01 09:00'
    }
  });
  const early = await call('/api/activity/' + staggered.data.id + '/join', { method: 'POST', token: studentAToken, body: { requestId: 'early-' + Date.now() } });
  check('未到开放时间拒绝报名', early.code !== 200 && /开放/.test(early.msg), early.msg);
  const openDetail = await call('/api/activity/' + staggered.data.id, { token: studentAToken });
  check('活动详情带开放状态', openDetail.data.signupOpen === false, 'signupOpen=' + openDetail.data.signupOpen);

  /* ---------- 10. 回归：原有主流程仍可用 ---------- */
  const myJoin = await call('/api/activity/myjoin', { token: studentAToken });
  check('学生“我的活动”接口正常', myJoin.code === 200 && Array.isArray(myJoin.data));
  const myActivities = await call('/api/activity/my', { token: teacherToken });
  check('教师“我的活动”接口正常', myActivities.code === 200 && Array.isArray(myActivities.data));
  const adminOverview = await call('/api/admin/overview', { token: adminToken });
  check('管理员概览接口正常且含新指标', adminOverview.code === 200 && adminOverview.data.eventCount > 0);
  const health = await call('/api/health');
  check('版本号已升级为 V3.0', health.data.version === 'V3.0', health.data.version);

  await stopServer();

  console.log(results.join('\n'));
  console.log('\n========================================');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  const eventFile = path.join(DATA_DIR, 'events.jsonl');
  const eventCount = fs.existsSync(eventFile) ? fs.readFileSync(eventFile, 'utf8').split('\n').filter(Boolean).length : 0;
  console.log('生成事件 ' + eventCount + ' 条（' + eventFile + '）');
  console.log('========================================');
  process.exitCode = fail ? 1 : 0;
})().catch(async error => {
  console.error('测试执行异常：', error);
  try { await stopServer(); } catch { /* ignore */ }
  process.exitCode = 1;
});
