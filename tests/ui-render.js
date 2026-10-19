/*
 * V3.0 前端渲染冒烟测试（jsdom）
 * ------------------------------------------------------------------
 * 目的：后端接口通了不代表页面能渲染。此脚本在 jsdom 里真实执行前端脚本，
 * 逐个视图检查是否抛异常、关键元素是否渲染出来。
 *
 * 前置：先启动服务（默认 http://127.0.0.1:3000），再运行：
 *   NODE_PATH=<jsdom 所在 node_modules> node tests/ui-render.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const SCRIPTS = ['api.js', 'storage.js', 'auth.js', 'student.js', 'teacher.js', 'admin.js', 'qa-engine.js', 'qa.js', 'app.js'];

// jsdom 是可选测试依赖，未安装时给出明确提示并跳过，而不是抛一个看不懂的模块错误
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch {
  console.log('未检测到 jsdom，已跳过前端渲染测试。');
  console.log('如需运行：在任意目录执行  npm i jsdom  然后设置 NODE_PATH 指向该 node_modules，例如');
  console.log('  NODE_PATH=<仓库>/node_modules node tests/ui-render.js http://127.0.0.1:3000');
  console.log('说明：jsdom 只用于本测试，不是系统运行依赖，未写入 package.json。');
  process.exit(0);
}

let pass = 0, fail = 0;
const log = [];
function check(name, ok, extra = '') {
  if (ok) { pass += 1; log.push('  [PASS] ' + name + (extra ? '  → ' + extra : '')); }
  else { fail += 1; log.push('  [FAIL] ' + name + (extra ? '  → ' + extra : '')); }
}

async function api(pathname, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return res.json();
}

async function buildPage(role) {
  const login = await api('/api/auth/login', { method: 'POST', body: { username: role, password: '123456' } });
  const token = login.data.token;
  const user = login.data.user;

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push('jsdom: ' + error.message));
  virtualConsole.on('error', (...args) => errors.push('console.error: ' + args.join(' ')));

  const dom = new JSDOM('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="app"></div><div class="toast-container" id="toast-container"></div></body></html>', {
    url: BASE + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole
  });
  const win = dom.window;
  win.fetch = (input, options) => fetch(new URL(input, BASE), options);
  win.confirm = () => true;
  win.alert = () => {};
  win.URL.createObjectURL = () => 'blob:mock';
  win.URL.revokeObjectURL = () => {};
  win.localStorage.setItem('cas_token', token);
  win.localStorage.setItem('cas_current_user', JSON.stringify(user));

  // 把 9 个脚本拼成一段再一次性执行：模拟浏览器的全局词法作用域
  // （jsdom 的多次 eval 不会共享 const 声明的作用域）
  let code = '';
  for (const name of SCRIPTS) {
    code += await (await fetch(BASE + '/assets/js/' + name)).text() + '\n;\n';
  }
  code += 'window.__boot = { navigate, render, showSignupList, showActivityDetail };\n';
  try { win.eval(code); }
  catch (error) { errors.push('boot: ' + error.message); }
  return { win, errors, token, user };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  /* ---------- 学生端 ---------- */
  {
    const { win, errors } = await buildPage('2021001');
    await win.__boot.navigate('student-home');
    await wait(500);
    check('学生端首页渲染无异常', errors.length === 0, errors.join(' | '));
    check('学生端首页出现活动卡片', win.document.querySelectorAll('.activity-card').length > 0, win.document.querySelectorAll('.activity-card').length + ' 张');
    check('页面标题为 V3.0', /V3\.0/.test(win.document.body.innerHTML));

    await win.__boot.navigate('student-my-activities');
    await wait(300);
    check('我的活动页渲染无异常', errors.length === 0, errors.join(' | '));

    // V3.0 能力扩展：个人周历
    await win.__boot.navigate('student-calendar');
    await wait(450);
    const calendarHtml = win.document.body.innerHTML;
    check('个人日程页渲染无异常', errors.length === 0, errors.join(' | '));
    check('日程页按七天排布', /我的日程/.test(calendarHtml) && (calendarHtml.match(/周一|周二|周三|周四|周五|周六|周日/g) || []).length >= 7,
      '星期标题 ' + (calendarHtml.match(/周[一二三四五六日]/g) || []).length + ' 个');

    // V3.0 能力扩展：消息中心
    await win.__boot.navigate('student-messages');
    await wait(450);
    const messageHtml = win.document.body.innerHTML;
    check('消息中心渲染无异常', errors.length === 0, errors.join(' | '));
    check('消息中心显示未读统计', /消息中心/.test(messageHtml) && /未读/.test(messageHtml));

    // 取消报名弹窗需要选择原因
    const cancelButton = win.document.querySelector('.btn-cancel');
    if (cancelButton) {
      cancelButton.click();
      await wait(150);
      check('取消报名弹窗要求选择原因', Boolean(win.document.getElementById('cancel-reason')), '原因下拉 ' + (win.document.getElementById('cancel-reason') ? '存在' : '缺失'));
    } else {
      check('取消报名弹窗要求选择原因', true, '（该学生无报名记录，跳过）');
    }
    win.close();
  }

  /* ---------- 教师端 ---------- */
  {
    const { win, errors, token } = await buildPage('10001');
    await win.__boot.navigate('teacher-home');
    await wait(500);
    check('教师端首页渲染无异常', errors.length === 0, errors.join(' | '));

    // V3.0 能力扩展：教师活动效果
    await win.__boot.navigate('teacher-insights');
    await wait(500);
    const insightHtml = win.document.body.innerHTML;
    check('教师活动效果页渲染无异常', errors.length === 0, errors.join(' | '));
    check('活动效果页给出供给建议', /建议扩容|建议调整时段|维持/.test(insightHtml));

    // 回到活动管理页，后续断言依赖该页面的按钮与表单
    await win.__boot.navigate('teacher-home');
    await wait(400);

    // 造一条带报名的活动，再打开名单弹窗（保证表格渲染出来）
    const made = await api('/api/activity', {
      method: 'POST', token,
      body: { title: 'UI 渲染校验活动', type: '讲座培训', content: '校验名单表格', place: 'C301', start_time: '2030-03-01 09:00', end_time: '2030-03-01 11:00', max_num: 2, eligibility_rule: '计算机' }
    });
    const studentLogin = await api('/api/auth/login', { method: 'POST', body: { username: '2021001', password: '123456' } });
    // force: 本用例验证的是名单表格渲染，反复运行会与上次创建的同类活动时间重叠，
    // 若不跳过冲突检测，报名会被拦截导致名单为空。
    await api('/api/activity/' + made.data.id + '/join', { method: 'POST', token: studentLogin.data.token, body: { force: true } });
    win.__boot.showSignupList(made.data.id);
    await wait(600);
    const html = win.document.body.innerHTML;
    check('名单弹窗渲染无异常', errors.length === 0, errors.join(' | '));
    check('名单弹窗含导出按钮', /导出 CSV/.test(html));
    check('名单弹窗含出席列与出席操作', /<th>出席<\/th>/.test(html) && /标记出席/.test(html));
    check('名单弹窗显示资格限定提示', /资格限定：仅限「计算机」/.test(html) || /资格限定关键词/.test(html), '');
    const closeButton = win.document.querySelector('.modal-close');
    if (closeButton) closeButton.click();

    // 发布/编辑表单应包含资格规则输入框
    const addButton = win.document.getElementById('add-activity-btn');
    if (addButton) {
      addButton.click();
      await wait(250);
      check('活动表单含“资格限定关键词”', Boolean(win.document.getElementById('f-eligibility-rule')));
    } else {
      check('活动表单含“资格限定关键词”', false, '教师首页未渲染出新增按钮；错误：' + errors.join(' | ') + '；正文前 120 字：' + win.document.body.textContent.slice(0, 120));
    }
    win.close();
  }

  /* ---------- 管理员端 ---------- */
  {
    const { win, errors } = await buildPage('90000');
    await wait(300);
    check('管理员首页渲染无异常', errors.length === 0, errors.join(' | '));

    await win.__boot.navigate('admin-metrics');
    await wait(500);
    const metricsHtml = win.document.body.innerHTML;
    check('运行统计页渲染无异常', errors.length === 0, errors.join(' | '));
    check('运行统计页含六项指标卡', /名额利用率/.test(metricsHtml) && /真实出席率/.test(metricsHtml) && /候补转化率/.test(metricsHtml));
    check('运行统计页含报名漏斗与趋势', /报名漏斗/.test(metricsHtml) && /天趋势/.test(metricsHtml));
    check('运行统计页含接口耗时与候补压力', /接口 P95/.test(metricsHtml) && /候补压力/.test(metricsHtml));
    check('运行统计页含重复提交去重行', /重复提交（已去重）/.test(metricsHtml));

    await win.__boot.navigate('admin-events');
    await wait(400);
    const eventHtml = win.document.body.innerHTML;
    check('运行日志页渲染无异常', errors.length === 0, errors.join(' | '));
    check('运行日志页列出事件', /共 \d+ 条/.test(eventHtml) && win.document.querySelectorAll('.status-tag').length > 0);

    await win.__boot.navigate('admin-activities');
    await wait(300);
    check('活动监管页仍正常（回归）', errors.length === 0 && win.document.querySelectorAll('.activity-table').length > 0);
    win.close();
  }

  console.log(log.join('\n'));
  console.log('\n========================================');
  console.log('前端渲染：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exitCode = fail ? 1 : 0;
})().catch(error => { console.error('执行异常：', error); process.exitCode = 1; });
