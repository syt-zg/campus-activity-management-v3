/*
 * 写入合并效果对比（前后对比实验）
 * ------------------------------------------------------------------
 * 背景：模拟数据显示 09 点一小时占全天 29% 的报名请求，该时段 P50 从 ~210ms
 * 抬升到 850ms、42.4% 请求超过 1 秒；其余时段几乎为 0。推测原因是"每次报名都
 * 全量重写 + 复制备份"在峰值处串行排队。
 *
 * 本脚本对同一业务负载（60 名学生同时报名同一活动）分别用
 *   - WRITE_COALESCE_MS=0  （等价 V2.0 的同步写）
 *   - WRITE_COALESCE_MS=50 （V3.0 合并写）
 * 跑一遍，比较总耗时与单请求 P95。
 *
 * 运行：node tests/perf-compare.js
 * 注意：这是本机微基准，不等同于生产压测；报名人数 60 是刻意取的小规模，
 *      只为验证"写次数下降"这一机制是否成立。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const STUDENTS = 60;
const ROUNDS = 3;

async function runOnce(coalesceMs) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-perf-'));
  process.env.CAMPUS_ACTIVITY_DATA_DIR = dataDir;
  process.env.WRITE_COALESCE_MS = String(coalesceMs);
  process.env.JWT_SECRET = 'perf-secret';

  // 每次都要重新 require，才能让模块级常量读取新的环境变量
  Object.keys(require.cache).forEach(key => {
    if (key.includes(path.join('release v3.0', 'source', 'src'))) delete require.cache[key];
  });
  const { startServer, stopServer } = require('../src/app');
  const port = await startServer(0);
  const base = 'http://127.0.0.1:' + port;

  const call = async (pathname, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(base + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return res.json();
  };

  const teacher = await call('/api/auth/login', { method: 'POST', body: { username: '10001', password: '123456' } });
  const teacherToken = teacher.data.token;
  const activity = await call('/api/activity', {
    method: 'POST', token: teacherToken,
    body: {
      title: '峰值写入测试', type: '讲座培训', content: '写入合并对比', place: 'Z001',
      start_time: '2030-06-01 09:00', end_time: '2030-06-01 11:00', max_num: STUDENTS
    }
  });

  const tokens = [];
  for (let i = 0; i < STUDENTS; i += 1) {
    const username = '3' + String(100000 + i);            // 独立学号，避免重复
    await call('/api/auth/register', { method: 'POST', body: { username, password: '123456', real_name: '压测' + i, class_name: '测试班' } });
    const login = await call('/api/auth/login', { method: 'POST', body: { username, password: '123456' } });
    tokens.push(login.data.token);
  }

  const latencies = [];
  const startedAt = Date.now();
  await Promise.all(tokens.map(async (token, index) => {
    const t0 = Date.now();
    await call('/api/activity/' + activity.data.id + '/join', {
      method: 'POST', token, body: { requestId: 'perf-' + coalesceMs + '-' + index }
    });
    latencies.push(Date.now() - t0);
  }));
  const total = Date.now() - startedAt;

  const metrics = await call('/api/admin/metrics?days=1', { token: (await call('/api/auth/login', { method: 'POST', body: { username: '90000', password: '123456' } })).data.token });
  const perf = metrics.data.perf;

  // 等合并窗口落盘后再关服，保证统计到文件大小
  await new Promise(resolve => setTimeout(resolve, Math.max(80, coalesceMs + 30)));
  const fileSize = fs.statSync(path.join(dataDir, 'activities.json')).size;
  await stopServer();

  latencies.sort((a, b) => a - b);
  return {
    coalesceMs,
    totalMs: total,
    p50: latencies[Math.floor(latencies.length * 0.5)],
    p95: latencies[Math.floor(latencies.length * 0.95)],
    max: latencies[latencies.length - 1],
    writeQueued: perf.writeQueued,
    writeFlushed: perf.writeFlushed,
    writeSaved: perf.writeSaved,
    fileSize
  };
}

(async () => {
  const results = { 0: [], 50: [] };
  for (let round = 1; round <= ROUNDS; round += 1) {
    for (const mode of [0, 50]) {
      const result = await runOnce(mode);
      result.round = round;
      results[mode].push(result);
      console.log(`第 ${round} 轮  合并=${mode}ms  总耗时 ${result.totalMs}ms  P95 ${result.p95}ms  落盘 ${result.writeFlushed} 次 / 请求 ${result.writeQueued} 次`);
    }
  }

  const avg = list => key => Math.round(list.reduce((sum, item) => sum + item[key], 0) / list.length);
  console.log('\n================ 对比结果（%d 轮平均，%d 名学生同时报名）================', ROUNDS, STUDENTS);
  console.log('模式            总耗时(ms)  P50(ms)  P95(ms)  落盘次数  省去写入');
  for (const mode of [0, 50]) {
    const list = results[mode];
    console.log(
      String(mode === 0 ? '同步写(≈V2.0)' : '合并写(V3.0)').padEnd(14),
      String(avg(list)('totalMs')).padEnd(10),
      String(avg(list)('p50')).padEnd(8),
      String(avg(list)('p95')).padEnd(8),
      String(avg(list)('writeFlushed')).padEnd(9),
      avg(list)('writeSaved')
    );
  }
  const sync = avg(results[0])('totalMs');
  const merged = avg(results[50])('totalMs');
  console.log('\n总耗时变化：%s ms → %s ms（%s%），落盘次数 %s → %s',
    sync, merged, sync ? Math.round((merged - sync) / sync * 100) : 0,
    avg(results[0])('writeFlushed'), avg(results[50])('writeFlushed'));
})();
