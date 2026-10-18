const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.JWT_SECRET || 'campus-activity-local-secret';
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const DATA_DIR = path.resolve(process.env.CAMPUS_ACTIVITY_DATA_DIR || path.resolve(__dirname, '../data'));
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const AVATARS_FILE = path.join(DATA_DIR, 'avatars.json');
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
const BUILTIN_AVATARS = new Set([
  'avatar-astronaut', 'avatar-fox', 'avatar-panda',
  'avatar-rabbit', 'avatar-robot', 'avatar-cat'
]);
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ==========================================================================
 * V2.0 领域常量
 * 需求来源：docs/V2-REQUIREMENTS.md（由三角色访谈证据整理）
 * ========================================================================== */

// 报名状态（R01）：待审核 / 正式参加 / 候补中 / 未通过
const REG = Object.freeze({
  PENDING: '待审核',
  APPROVED: '正式参加',
  WAITLIST: '候补中',
  REJECTED: '未通过'
});
const ACTIVE_REG_STATUS = [REG.PENDING, REG.APPROVED, REG.WAITLIST];

// 平台账号状态（R15）
const USER_STATUS = Object.freeze({ ACTIVE: 'active', DISABLED: 'disabled' });
// 活动平台状态（R16）
const ACTIVITY_STATUS = Object.freeze({ ACTIVE: 'active', SUSPENDED: 'suspended' });

const ROLE_LABEL = { student: '学生', teacher: '教师', admin: '系统管理员' };
const ROLE_LOGIN_HINT = { student: '当前账号不是学生身份', teacher: '当前账号不是教师身份', admin: '当前账号不是系统管理员身份' };

/* ============================ 数据初始化 ============================ */

const seedUsers = [
  { id: 1, username: '10001', real_name: '王建国', class_name: '计算机科学与技术', role: 'teacher', password: '123456' },
  { id: 2, username: '10002', real_name: '李敏华', class_name: '外国语学院', role: 'teacher', password: '123456' },
  { id: 3, username: '10003', real_name: '张志强', class_name: '体育学院', role: 'teacher', password: '123456' },
  { id: 4, username: '10004', real_name: '赵雪梅', class_name: '艺术学院', role: 'teacher', password: '123456' },
  { id: 5, username: '10005', real_name: '陈浩然', class_name: '机械工程学院', role: 'teacher', password: '123456' },
  { id: 6, username: '10006', real_name: '刘雅婷', class_name: '经济管理学院', role: 'teacher', password: '123456' },
  { id: 7, username: '10007', real_name: '周俊杰', class_name: '数学学院', role: 'teacher', password: '123456' },
  { id: 8, username: '10008', real_name: '黄晓琳', class_name: '生命科学学院', role: 'teacher', password: '123456' },
  { id: 9, username: '10009', real_name: '孙伟', class_name: '物理学院', role: 'teacher', password: '123456' },
  { id: 10, username: '10010', real_name: '吴佳怡', class_name: '新闻传播学院', role: 'teacher', password: '123456' },
  { id: 11, username: '2021001', real_name: '陈小明', class_name: '计算机2101班', role: 'student', password: '123456' },
  { id: 12, username: '2021002', real_name: '刘小红', class_name: '英语2102班', role: 'student', password: '123456' }
];

// V2.0 新增：系统管理员预置账号（R14）
const SEED_ADMIN = { username: '90000', real_name: '系统管理员', class_name: '信息中心', role: 'admin', password: '123456' };

function readJson(file, fallback) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch (error) {
    // 启动阶段绝不能用默认值覆盖原文件。保留原文件并做一份可恢复备份，
    // 当前进程只在内存中使用 fallback，避免损坏的用户数据被静默清空。
    if (fs.existsSync(file)) {
      const backup = `${file}.corrupt-${Date.now()}.bak`;
      try { fs.copyFileSync(file, backup); } catch (backupError) { console.warn('无法备份异常数据文件：' + backupError.message); }
      console.warn(`数据文件读取失败，已保留原文件并使用内存默认值：${file}（${error.message}）`);
    }
    return fallback;
  }
}
function writeJson(file, value) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const displaced = `${file}.${process.pid}.${Date.now()}.old`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 保留最近一次成功写入前的副本，便于用户恢复误操作或异常中断。
    if (fs.existsSync(file)) {
      try { fs.copyFileSync(file, `${file}.backup`); } catch (backupError) { console.warn('无法创建数据备份：' + backupError.message); }
    }
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    if (process.platform !== 'win32') {
      try {
        const fd = fs.openSync(temp, 'r');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
      } catch (syncError) { console.warn('数据同步校验未完成：' + syncError.message); }
    }
    // Windows 无法总是直接覆盖已存在的目标文件：先将旧文件移到同目录临时名，
    // 再把完整临时文件换入；若换入失败，尽量恢复旧文件。
    if (fs.existsSync(file)) fs.renameSync(file, displaced);
    try {
      fs.renameSync(temp, file);
    } catch (replaceError) {
      if (fs.existsSync(displaced) && !fs.existsSync(file)) {
        try { fs.renameSync(displaced, file); } catch (restoreError) { console.error('数据文件恢复失败：' + restoreError.message); }
      }
      throw replaceError;
    }
    try { if (fs.existsSync(displaced)) fs.unlinkSync(displaced); } catch (cleanupError) { console.warn('旧数据临时文件清理失败：' + cleanupError.message); }
  } catch (error) {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (cleanupError) { /* 保留现场供恢复 */ }
    // 某些受限运行环境禁止 Node 进程直接写文件，但不应阻断当前请求。
    // 正常运行时会保留原文件和 .backup，并在当前服务内继续使用最新数据。
    if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
    console.warn('数据文件暂时不可写，已保留本次变更于当前服务内：' + file);
  }
}

function nextId(list) { return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1; }
function nowText() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

let users = readJson(USERS_FILE, seedUsers);
let activities = readJson(ACTIVITIES_FILE, []);
let avatars = readJson(AVATARS_FILE, {});
// 启动阶段只修正内存视图，不改写用户磁盘数据；后续明确的用户操作才会持久化。
if (!Array.isArray(users) || !users.length) users = seedUsers.slice();
if (!Array.isArray(activities)) activities = [];
if (!avatars || Array.isArray(avatars) || typeof avatars !== 'object') avatars = {};

/* ===================== 数据迁移：V1.0 joined → V2.0 registrations ===================== */

/**
 * V1.0 的 activity.joined 只有"报名/未报名"两种状态。
 * V2.0 升级为带状态的报名记录，迁移时把已报名学生一律视为"正式参加"，
 * 并把时间字段补齐，保证历史数据在候补、递补逻辑下依然自洽。
 */
function migrateActivity(raw) {
  const item = Object.assign({}, raw);
  item.requireReview = raw.requireReview === true;              // R07，默认不需要审核
  item.eligibility = typeof raw.eligibility === 'string' ? raw.eligibility : ''; // R08
  item.status = raw.status === ACTIVITY_STATUS.SUSPENDED ? ACTIVITY_STATUS.SUSPENDED : ACTIVITY_STATUS.ACTIVE; // R16
  item.createTime = raw.createTime || raw.startTime || nowText();

  if (!Array.isArray(item.registrations)) {
    const legacyJoined = Array.isArray(raw.joined) ? raw.joined : [];
    const base = Date.parse(String(item.createTime).replace(' ', 'T')) || Date.now();
    item.registrations = legacyJoined.map((userId, index) => {
      const stamp = new Date(base + index * 1000).toISOString().replace('T', ' ').slice(0, 19);
      return { userId: Number(userId), status: REG.APPROVED, applyTime: stamp, approvedTime: stamp };
    });
  }
  item.registrations = item.registrations
    .filter(reg => reg && reg.userId !== undefined && reg.userId !== null)
    .map(reg => ({
      userId: Number(reg.userId),
      status: ACTIVE_REG_STATUS.concat(REG.REJECTED).includes(reg.status) ? reg.status : REG.APPROVED,
      applyTime: reg.applyTime || item.createTime,
      waitlistTime: reg.waitlistTime || '',
      approvedTime: reg.approvedTime || '',
      reviewTime: reg.reviewTime || ''
    }));
  delete item.joined;
  return item;
}

activities = activities.map(raw => {
  const next = migrateActivity(raw);
  return next;
});

/* ===================== 预置账号 ===================== */

// 固定的十位活动发布教师属于系统预置账号：已完成注册，可直接使用初始密码登录。
// 其他编号仍通过教师认证接口动态创建，不限制在 10001—10010。
const requiredTeachers = [
  ['10001', '王建国', '计算机科学与技术'], ['10002', '李敏华', '外国语学院'],
  ['10003', '张志强', '体育学院'], ['10004', '赵雪梅', '艺术学院'],
  ['10005', '陈浩然', '机械工程学院'], ['10006', '刘雅婷', '经济管理学院'],
  ['10007', '周俊杰', '数学学院'], ['10008', '黄晓琳', '生命科学学院'],
  ['10009', '孙伟', '物理学院'], ['10010', '吴佳怡', '新闻传播学院']
];
function ensureRequiredTeachers() {
  let changed = false;
  requiredTeachers.forEach(([username, real_name, class_name]) => {
    let teacher = users.find(item => String(item.username || item.account) === username);
    if (!teacher) {
      teacher = { id: nextId(users), username, real_name, class_name, role: 'teacher', password: '123456', teacherAuthenticated: true };
      users.push(teacher);
      changed = true;
      return;
    }
    if (teacher.role !== 'teacher') return;
    if (!teacher.password && !teacher.passwordHash) { teacher.password = '123456'; changed = true; }
    if (teacher.teacherAuthenticated !== true) { teacher.teacherAuthenticated = true; changed = true; }
  });
}
ensureRequiredTeachers();

// V2.0：保证存在系统管理员账号（R14）
function ensureAdmin() {
  let changed = false;
  let admin = users.find(item => item.role === 'admin');
  if (!admin) {
    admin = Object.assign({ id: nextId(users), teacherAuthenticated: true }, SEED_ADMIN);
    users.push(admin);
    changed = true;
  }
  users.forEach(user => {
    if (user.status !== USER_STATUS.DISABLED) { user.status = USER_STATUS.ACTIVE; changed = true; }
    if (typeof user.teacherAuthenticated !== 'boolean' && user.role !== 'teacher') { user.teacherAuthenticated = false; }
  });
}
ensureAdmin();

/* ============================ HTTP 基础设施 ============================ */

function send(res, code, msg, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' });
  res.end(JSON.stringify({ code, msg, data: data === undefined ? null : data }));
}
function ok(res, msg, data) { send(res, 200, msg, data || {}); }
function fail(res, msg, code) { send(res, code || 400, msg, null); }
function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error('请求数据格式错误')); } });
    req.on('error', reject);
  });
}
function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function checkPassword(password, user) {
  if (!user.passwordHash) return user.password === String(password);
  const parts = String(user.passwordHash).split('$');
  if (parts.length !== 3) return false;
  const actual = crypto.scryptSync(String(password), parts[1], 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(parts[2], 'hex'));
}
function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    real_name: user.real_name || user.name || '',
    class_name: user.class_name || user.className || '',
    role: user.role,
    status: user.status || USER_STATUS.ACTIVE,
    avatar_url: avatarUrl(user.id)
  };
}
function avatarUrl(userId) {
  const avatar = avatars[String(userId)];
  if (!avatar || typeof avatar !== 'object') return '';
  if (avatar.type === 'builtin' && BUILTIN_AVATARS.has(avatar.value)) {
    return `/assets/avatars/${avatar.value}.png`;
  }
  if (avatar.type === 'custom' && typeof avatar.file === 'string' && path.basename(avatar.file) === avatar.file) {
    return `/api/avatar/${encodeURIComponent(String(userId))}?v=${Number(avatar.updatedAt) || 0}`;
  }
  return '';
}
function imageType(buffer, declaredType) {
  if (declaredType === 'png' && buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ext: 'png', mime: 'image/png' };
  if (declaredType === 'jpeg' && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (declaredType === 'webp' && buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
function saveCustomAvatar(userId, dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error('请选择 PNG、JPEG 或 WebP 格式的图片');
  if (match[2].length > 3 * 1024 * 1024) throw new Error('头像图片不能超过 2 MB');
  const bytes = Buffer.from(match[2].replace(/[\r\n]/g, ''), 'base64');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('头像图片不能超过 2 MB');
  const type = imageType(bytes, match[1]);
  if (!type) throw new Error('图片内容与文件格式不匹配，请重新选择');
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const fileName = `user-${Number(userId)}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${type.ext}`;
  const finalFile = path.join(AVATAR_DIR, fileName);
  const tempFile = `${finalFile}.tmp`;
  fs.writeFileSync(tempFile, bytes, { flag: 'wx' });
  try { fs.renameSync(tempFile, finalFile); }
  catch (error) { try { fs.unlinkSync(tempFile); } catch { /* 保留原异常 */ } throw error; }
  return { fileName, mime: type.mime };
}
function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 7 * 86400000 })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
function currentUser(req) {
  const parts = String(req.headers.authorization || '').replace(/^Bearer[ ]+/i, '').split('.');
  if (parts.length !== 2) return null;
  if (crypto.createHmac('sha256', SECRET).update(parts[0]).digest('base64url') !== parts[1]) return null;
  try { const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); return payload.exp < Date.now() ? null : users.find(item => item.id === payload.id) || null; } catch { return null; }
}
function auth(req, res, role) {
  const user = currentUser(req);
  if (!user) { fail(res, '登录状态无效或已过期，请重新登录', 401); return null; }
  if ((user.status || USER_STATUS.ACTIVE) === USER_STATUS.DISABLED) { fail(res, '账号已被平台停用，请联系系统管理员', 403); return null; }
  if (role && user.role !== role) { fail(res, ROLE_LOGIN_HINT[role] || '当前账号身份不匹配', 403); return null; }
  return user;
}
function applicationCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

/* ===================== 活动 / 报名领域逻辑 ===================== */

/** 活动按时间计算的状态（V1.0 已有能力，保持字段名 status 以兼容前端） */
function timeStatus(item) {
  const start = new Date(String(item.startTime).replace(' ', 'T')).getTime();
  const end = new Date(String(item.endTime).replace(' ', 'T')).getTime();
  return Date.now() < start ? '未开始' : Date.now() < end ? '进行中' : '已结束';
}

function regs(item) { return Array.isArray(item.registrations) ? item.registrations : (item.registrations = []); }
function findReg(item, userId) { return regs(item).find(reg => Number(reg.userId) === Number(userId)); }
function approvedList(item) { return regs(item).filter(reg => reg.status === REG.APPROVED); }
function pendingList(item) { return regs(item).filter(reg => reg.status === REG.PENDING); }
function rejectedList(item) { return regs(item).filter(reg => reg.status === REG.REJECTED); }
/** R03：候补队列严格按进入候补的时间升序，禁止人工插队 */
function waitlistList(item) {
  return regs(item)
    .filter(reg => reg.status === REG.WAITLIST)
    .sort((a, b) => String(a.waitlistTime || '').localeCompare(String(b.waitlistTime || '')) || Number(a.userId) - Number(b.userId));
}
/** R11：正式参加人数不得超过活动上限 */
function remainingSeats(item) { return Math.max(0, Number(item.maxParticipants || 0) - approvedList(item).length); }
/** R04：候补位次（1 为队首） */
function waitlistPosition(item, userId) {
  const index = waitlistList(item).findIndex(reg => Number(reg.userId) === Number(userId));
  return index < 0 ? 0 : index + 1;
}
/** R06：名额释放后按候补顺序自动递补，不允许人工指定 */
function promoteFromWaitlist(item) {
  const promoted = [];
  while (remainingSeats(item) > 0) {
    const queue = waitlistList(item);
    if (!queue.length) break;
    const next = queue[0];
    next.status = REG.APPROVED;
    next.approvedTime = nowText();
    promoted.push(next);
  }
  return promoted;
}

function activityView(item) {
  const approved = approvedList(item).length;
  return Object.assign({}, item, {
    status: timeStatus(item),
    platformStatus: item.status || ACTIVITY_STATUS.ACTIVE,
    signupCount: approved,                                   // V1.0 字段兼容
    approvedCount: approved,
    waitlistCount: waitlistList(item).length,
    pendingCount: pendingList(item).length,
    rejectedCount: rejectedList(item).length,
    remaining: Math.max(0, Number(item.maxParticipants || 0) - approved)
  });
}

/** 学生视角：本人在这条活动上的报名状态 */
function myRegistration(item, userId) {
  const reg = findReg(item, userId);
  if (!reg) return null;
  return {
    status: reg.status,
    applyTime: reg.applyTime || '',
    waitlistTime: reg.waitlistTime || '',
    approvedTime: reg.approvedTime || '',
    reviewTime: reg.reviewTime || '',
    position: reg.status === REG.WAITLIST ? waitlistPosition(item, userId) : 0
  };
}

function registrationRows(item) {
  const order = { [REG.APPROVED]: 0, [REG.WAITLIST]: 1, [REG.PENDING]: 2, [REG.REJECTED]: 3 };
  return regs(item)
    .slice()
    .sort((a, b) => (order[a.status] - order[b.status]) || String(a.applyTime || '').localeCompare(String(b.applyTime || '')))
    .map(reg => {
      const student = users.find(user => Number(user.id) === Number(reg.userId));
      return {
        userId: reg.userId,
        username: student ? student.username : '',
        real_name: student ? student.real_name : '（账号已删除）',
        class_name: student ? (student.class_name || '') : '',
        status: reg.status,
        applyTime: reg.applyTime || '',
        waitlistTime: reg.waitlistTime || '',
        approvedTime: reg.approvedTime || '',
        position: reg.status === REG.WAITLIST ? waitlistPosition(item, reg.userId) : 0
      };
    });
}

function activitySummary(item) {
  return {
    maxParticipants: Number(item.maxParticipants || 0),
    approvedCount: approvedList(item).length,
    waitlistCount: waitlistList(item).length,
    pendingCount: pendingList(item).length,
    rejectedCount: rejectedList(item).length,
    remaining: remainingSeats(item),
    requireReview: item.requireReview === true
  };
}

/* ============================== 接口层 ============================== */

async function api(req, res, url) {
  const p = url.pathname;

  const avatarFileMatch = p.match(/^\/api\/avatar\/(\d+)$/);
  if (avatarFileMatch && req.method === 'GET') {
    const avatar = avatars[String(Number(avatarFileMatch[1]))];
    if (!avatar || avatar.type !== 'custom' || typeof avatar.file !== 'string' || path.basename(avatar.file) !== avatar.file) return fail(res, '头像不存在', 404);
    const file = path.join(AVATAR_DIR, avatar.file);
    if (!file.startsWith(AVATAR_DIR + path.sep) || !fs.existsSync(file)) return fail(res, '头像不存在', 404);
    const ext = path.extname(avatar.file).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : '';
    if (!mime) return fail(res, '头像格式不受支持', 415);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'private, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(file).pipe(res);
    return;
  }

  if (p === '/api/health') return ok(res, '服务正常', { mode: 'local-json', version: 'V2.0' });

  /* ---------------- 认证 ---------------- */
  if (p === '/api/auth/login' && req.method === 'POST') {
    const data = await body(req); const username = String(data.username || '').trim(); const password = String(data.password || '');
    if (!username || !password) return fail(res, '账号和密码不能为空');
    const user = users.find(item => String(item.username || item.account) === username);
    if (!user) return fail(res, '账号不存在，请先注册或检查账号是否正确', 401);
    if (user.role === 'teacher' && !user.teacherAuthenticated) return fail(res, '教师尚未完成认证，请先点击“教师认证”提交申请', 403);
    if ((user.status || USER_STATUS.ACTIVE) === USER_STATUS.DISABLED) return fail(res, '账号已被平台停用，请联系系统管理员', 403); // R15
    if (!checkPassword(password, user)) return fail(res, '密码错误，请检查密码是否正确', 401);
    // 兼容 V1.0 的明文密码字段，但登录本身不改写用户文件，避免首次登录造成数据变化。
    return ok(res, '登录成功', { token: makeToken(user), user: publicUser(user) });
  }
  if (p === '/api/auth/teacher/apply' && req.method === 'POST') {
    const data = await body(req);
    const username = String(data.username || '').trim();
    const name = String(data.real_name || '').trim();
    const age = Number(data.age);
    if (!/^[0-9]{1,20}$/.test(username)) return fail(res, '教师编号必须为数字');
    if (!name) return fail(res, '请填写教师姓名');
    if (!Number.isInteger(age) || age < 18 || age > 80) return fail(res, '年龄必须是 18 至 80 岁之间的整数');
    let teacher = users.find(item => String(item.username || item.account) === username);
    if (teacher && teacher.role !== 'teacher') return fail(res, '该编号已被其他身份使用');
    if (!teacher) {
      teacher = {
        id: nextId(users), username, real_name: name, class_name: '', age,
        role: 'teacher', password: '123456', teacherAuthenticated: false, status: USER_STATUS.ACTIVE
      };
      users.push(teacher);
    }
    if (teacher.teacherAuthenticated) return fail(res, '该教师已完成认证，可直接使用初始密码 123456 登录');
    teacher.real_name = name;
    teacher.age = age;
    teacher.teacherApplicationCode = applicationCode();
    writeJson(USERS_FILE, users);
    return ok(res, '申请已提交，请输入六位申请密码完成认证', { username, applicationPassword: teacher.teacherApplicationCode });
  }
  if (p === '/api/auth/teacher/verify' && req.method === 'POST') {
    const data = await body(req);
    const username = String(data.username || '').trim();
    const code = String(data.application_password || '').trim();
    const teacher = users.find(item => item.role === 'teacher' && String(item.username || item.account) === username);
    if (!teacher) return fail(res, '教师编号不存在');
    if (teacher.teacherAuthenticated) return ok(res, '该教师已经认证，无需重复认证');
    if (!teacher.teacherApplicationCode) return fail(res, '尚未提交认证申请，请先提交申请');
    if (teacher.teacherApplicationCode !== code) return fail(res, '申请密码错误，请重新输入');
    teacher.teacherAuthenticated = true;
    delete teacher.teacherApplicationCode;
    writeJson(USERS_FILE, users);
    return ok(res, '教师认证成功，以后可直接使用教师编号和初始密码 123456 登录');
  }
  if (p === '/api/auth/register' && req.method === 'POST') {
    const data = await body(req); const username = String(data.username || '').trim(); const name = String(data.real_name || '').trim(); const password = String(data.password || '');
    if (!username || !name || !password) return fail(res, '学号、姓名和密码不能为空');
    if (!/^[0-9]{1,20}$/.test(username)) return fail(res, '学号必须为数字');
    if (password.length < 6) return fail(res, '密码至少需要 6 位');
    if (users.some(item => String(item.username || item.account) === username)) return fail(res, '该学号已被注册，请直接登录', 409);
    const user = { id: nextId(users), username, real_name: name, class_name: String(data.class_name || '').trim(), role: 'student', passwordHash: hash(password), status: USER_STATUS.ACTIVE };
    users.push(user); writeJson(USERS_FILE, users); return ok(res, '注册成功', { user: publicUser(user) });
  }
  if (p === '/api/auth/info' && req.method === 'GET') { const user = auth(req, res); return user ? ok(res, '获取成功', publicUser(user)) : undefined; }
  if (p === '/api/auth/avatar' && req.method === 'PUT') {
    const user = auth(req, res); if (!user) return;
    const data = await body(req);
    const mode = String(data.mode || '');
    if (mode === 'builtin') {
      const value = String(data.avatar || '');
      if (!BUILTIN_AVATARS.has(value)) return fail(res, '请选择系统提供的头像');
      avatars[String(user.id)] = { type: 'builtin', value, updatedAt: Date.now() };
    } else if (mode === 'custom') {
      let saved;
      try { saved = saveCustomAvatar(user.id, data.data_url); }
      catch (error) { return fail(res, error.message || '头像保存失败'); }
      avatars[String(user.id)] = { type: 'custom', file: saved.fileName, mime: saved.mime, updatedAt: Date.now() };
    } else return fail(res, '头像设置方式不正确');
    writeJson(AVATARS_FILE, avatars);
    return ok(res, '头像已更新', publicUser(user));
  }
  if (p === '/api/auth/password' && req.method === 'PUT') {
    const user = auth(req, res); if (!user) return;
    const data = await body(req);
    const currentPassword = String(data.current_password || '');
    const newPassword = String(data.new_password || '');
    const confirmPassword = String(data.confirm_password || '');
    if (!currentPassword) return fail(res, '请输入当前密码');
    if (!newPassword) return fail(res, '请输入新密码');
    if (newPassword.length < 6) return fail(res, '新密码至少需要 6 位');
    if (newPassword.length > 100) return fail(res, '新密码不能超过 100 位');
    if (confirmPassword && newPassword !== confirmPassword) return fail(res, '两次输入的新密码不一致');
    if (!checkPassword(currentPassword, user)) return fail(res, '当前密码错误，请重新输入', 401);
    if (checkPassword(newPassword, user)) return fail(res, '新密码不能与当前密码相同');
    user.passwordHash = hash(newPassword);
    delete user.password;
    writeJson(USERS_FILE, users);
    return ok(res, '密码修改成功');
  }
  if (p === '/api/auth/logout' && req.method === 'POST') return ok(res, '退出成功');

  /* ---------------- 活动：公共与教师 ---------------- */
  if (p === '/api/activity/list' && req.method === 'GET') {
    const user = auth(req, res); if (!user) return;
    // R16：被平台停用的活动对学生不可见；教师/管理员仍需在各自后台看到
    let list = activities
      .filter(item => user.role !== 'student' || (item.status || ACTIVITY_STATUS.ACTIVE) === ACTIVITY_STATUS.ACTIVE)
      .map(item => Object.assign(activityView(item), { myRegistration: user.role === 'student' ? myRegistration(item, user.id) : null }));
    const keyword = String(url.searchParams.get('keyword') || '').toLowerCase();
    const type = String(url.searchParams.get('type') || '');
    if (keyword) list = list.filter(item => (item.title + ' ' + item.description + ' ' + item.location).toLowerCase().includes(keyword));
    if (type) list = list.filter(item => item.type === type);
    return ok(res, '获取成功', { list, total: list.length, page: 1, size: list.length });
  }
  if (p === '/api/activity/my' && req.method === 'GET') {
    const user = auth(req, res, 'teacher'); if (!user) return;
    return ok(res, '获取成功', activities.filter(item => Number(item.publisherId) === Number(user.id)).map(item => Object.assign(activityView(item), { summary: activitySummary(item) })));
  }
  if (p === '/api/activity/myjoin' && req.method === 'GET') {
    const user = auth(req, res, 'student'); if (!user) return;
    const list = activities
      .filter(item => findReg(item, user.id))
      .map(item => Object.assign(activityView(item), { myRegistration: myRegistration(item, user.id) }));
    return ok(res, '获取成功', list);
  }
  if (p === '/api/activity' && req.method === 'POST') {
    const user = auth(req, res, 'teacher'); if (!user) return; const data = await body(req);
    if (!data.title || !data.content || !data.place || !data.start_time || !data.end_time || !data.max_num) return fail(res, '活动参数不完整');
    const item = {
      id: nextId(activities), title: data.title, type: data.type || '其他',
      description: data.content, notice: data.notice || '', location: data.place,
      startTime: data.start_time, endTime: data.end_time, maxParticipants: Number(data.max_num),
      publisherId: user.id, publisher: user.real_name,
      requireReview: data.require_review === true,                 // R07
      eligibility: String(data.eligibility || '').trim(),          // R08
      status: ACTIVITY_STATUS.ACTIVE,                              // R16
      createTime: nowText(),
      registrations: []
    };
    activities.push(item); writeJson(ACTIVITIES_FILE, activities); return ok(res, '发布成功', { id: item.id });
  }

  const match = p.match(/^\/api\/activity\/(\d+)(?:\/(join|joinlist|review|registrations))?$/);
  if (!match) return fail(res, '接口不存在', 404);
  const id = Number(match[1]);
  const item = activities.find(activity => Number(activity.id) === id);
  if (!item) return fail(res, '活动不存在', 404);

  if (!match[2] && req.method === 'GET') {
    const user = auth(req, res); if (!user) return;
    if (user.role === 'student' && (item.status || ACTIVITY_STATUS.ACTIVE) === ACTIVITY_STATUS.SUSPENDED) return fail(res, '该活动已被平台停用', 403);
    return ok(res, '获取成功', Object.assign(activityView(item), { myRegistration: user.role === 'student' ? myRegistration(item, user.id) : null }));
  }

  /* ---------------- 学生：报名 / 取消（R02 / R04 / R05 / R06） ---------------- */
  if (match[2] === 'join' && req.method === 'POST') {
    const user = auth(req, res, 'student'); if (!user) return;
    if ((item.status || ACTIVITY_STATUS.ACTIVE) === ACTIVITY_STATUS.SUSPENDED) return fail(res, '该活动已被平台停用，无法报名');
    if (timeStatus(item) !== '未开始') return fail(res, '活动已开始或结束，禁止报名');
    const existing = findReg(item, user.id);
    if (existing && ACTIVE_REG_STATUS.includes(existing.status)) return fail(res, '您已报名该活动');
    if (existing && existing.status === REG.REJECTED) return fail(res, '您的报名未通过审核，无法重复报名');

    const stamp = nowText();
    let record;
    if (item.requireReview === true) {
      // R10：需要审核的活动先进入"待审核"，不占用正式名额
      record = { userId: user.id, status: REG.PENDING, applyTime: stamp, waitlistTime: '', approvedTime: '', reviewTime: '' };
    } else if (remainingSeats(item) > 0) {
      record = { userId: user.id, status: REG.APPROVED, applyTime: stamp, waitlistTime: '', approvedTime: stamp, reviewTime: '' };
    } else {
      // R02 / R03：满员后进入候补队列，按进入时间排序
      record = { userId: user.id, status: REG.WAITLIST, applyTime: stamp, waitlistTime: stamp, approvedTime: '', reviewTime: '' };
    }
    if (existing) Object.assign(existing, record); else regs(item).push(record);
    writeJson(ACTIVITIES_FILE, activities);

    const mine = myRegistration(item, user.id);
    const message = record.status === REG.PENDING ? '报名申请已提交，等待活动组织教师审核'
      : record.status === REG.WAITLIST ? '活动名额已满，已加入候补队列（第 ' + mine.position + ' 位）'
        : '报名成功';
    return ok(res, message, { registration: mine, activity: activityView(item) });
  }

  if (match[2] === 'join' && req.method === 'DELETE') {
    const user = auth(req, res, 'student'); if (!user) return;
    const existing = findReg(item, user.id);
    if (!existing) return fail(res, '您尚未报名该活动');
    if (timeStatus(item) === '已结束') return fail(res, '活动已结束，无法取消报名');
    const wasApproved = existing.status === REG.APPROVED;
    const wasWaitlist = existing.status === REG.WAITLIST;
    item.registrations = regs(item).filter(reg => Number(reg.userId) !== Number(user.id));
    // R05 / R06：正式名额被释放后，按候补顺序自动递补
    const promoted = wasApproved ? promoteFromWaitlist(item) : [];
    writeJson(ACTIVITIES_FILE, activities);
    const promotedNames = promoted.map(reg => {
      const student = users.find(u => Number(u.id) === Number(reg.userId));
      return student ? student.real_name : '';
    }).filter(Boolean);
    const message = wasWaitlist ? '已退出候补队列'
      : wasApproved && promotedNames.length ? '取消报名成功，已自动递补：' + promotedNames.join('、')
        : '取消报名成功';
    return ok(res, message, { promotedCount: promoted.length, promotedNames });
  }

  /* ---------------- 教师：报名名单（R09 / R11） ---------------- */
  if (match[2] === 'joinlist' && req.method === 'GET') {
    const user = auth(req, res, 'teacher'); if (!user) return;
    if (Number(item.publisherId) !== Number(user.id)) return fail(res, '活动不存在或非本人发布', 403);
    return ok(res, '获取成功', { activity: activityView(item), summary: activitySummary(item), registrations: registrationRows(item) });
  }

  /* ---------------- 教师：审核报名申请（R09 / R10） ---------------- */
  if (match[2] === 'review' && req.method === 'PUT') {
    const user = auth(req, res, 'teacher'); if (!user) return;
    if (Number(item.publisherId) !== Number(user.id)) return fail(res, '活动不存在或非本人发布', 403);
    const data = await body(req);
    const targetId = Number(data.userId);
    const action = String(data.action || '');
    if (!targetId) return fail(res, '请指定报名学生');
    if (!['approve', 'reject'].includes(action)) return fail(res, '审核操作不合法');
    const reg = findReg(item, targetId);
    if (!reg) return fail(res, '该学生没有报名记录');
    if (reg.status !== REG.PENDING) return fail(res, '该报名当前状态为“' + reg.status + '”，无法再次审核');
    const stamp = nowText();
    reg.reviewTime = stamp;
    reg.reviewBy = user.id;
    if (action === 'reject') {
      reg.status = REG.REJECTED;                 // R10：不通过 → 未通过，不占名额
    } else if (remainingSeats(item) > 0) {
      reg.status = REG.APPROVED;                 // R10：通过且有名额 → 正式参加
      reg.approvedTime = stamp;
    } else {
      reg.status = REG.WAITLIST;                 // R10：通过但已满员 → 进入候补
      reg.waitlistTime = stamp;
    }
    writeJson(ACTIVITIES_FILE, activities);
    const student = users.find(u => Number(u.id) === targetId);
    const name = student ? student.real_name : '';
    const message = reg.status === REG.REJECTED ? '已拒绝 ' + name + ' 的报名申请'
      : reg.status === REG.WAITLIST ? '已通过 ' + name + ' 的报名，因名额已满已转入候补'
        : '已通过 ' + name + ' 的报名申请';
    return ok(res, message, { registration: myRegistration(item, targetId), activity: activityView(item) });
  }

  /* ---------------- 教师：活动维护（R12 归属校验） ---------------- */
  if (!match[2] && req.method === 'PUT') {
    const user = auth(req, res, 'teacher'); if (!user) return;
    if (Number(item.publisherId) !== Number(user.id)) return fail(res, '活动不存在或非本人发布', 403);
    const data = await body(req);
    const nextMax = Number(data.max_num);
    if (!data.title || !data.content || !data.place || !data.start_time || !data.end_time || !nextMax) return fail(res, '活动参数不完整');
    // R11：修改上限时不得低于已确定的正式人数
    if (nextMax < approvedList(item).length) return fail(res, '招募人数不能小于已确定参加的 ' + approvedList(item).length + ' 人');
    Object.assign(item, {
      title: data.title, type: data.type || '其他', description: data.content, notice: data.notice || '',
      location: data.place, startTime: data.start_time, endTime: data.end_time, maxParticipants: nextMax,
      requireReview: data.require_review === true,
      eligibility: String(data.eligibility || '').trim()
    });
    // 上限调大后，候补队列可自动补位
    promoteFromWaitlist(item);
    writeJson(ACTIVITIES_FILE, activities);
    return ok(res, '修改成功', { activity: activityView(item) });
  }
  if (!match[2] && req.method === 'DELETE') {
    const user = auth(req, res, 'teacher'); if (!user) return;
    if (Number(item.publisherId) !== Number(user.id)) return fail(res, '活动不存在或非本人发布', 403);
    activities = activities.filter(activity => Number(activity.id) !== id);
    writeJson(ACTIVITIES_FILE, activities);
    return ok(res, '删除成功');
  }

  return fail(res, '接口不存在', 404);
}

/* ===================== 管理员接口（R14 / R15 / R16） ===================== */

async function adminApi(req, res, url) {
  const user = auth(req, res, 'admin');
  if (!user) return;
  const p = url.pathname;

  if (p === '/api/admin/overview' && req.method === 'GET') {
    return ok(res, '获取成功', {
      userCount: users.length,
      studentCount: users.filter(item => item.role === 'student').length,
      teacherCount: users.filter(item => item.role === 'teacher').length,
      disabledCount: users.filter(item => (item.status || USER_STATUS.ACTIVE) === USER_STATUS.DISABLED).length,
      activityCount: activities.length,
      suspendedCount: activities.filter(item => (item.status || ACTIVITY_STATUS.ACTIVE) === ACTIVITY_STATUS.SUSPENDED).length
    });
  }

  if (p === '/api/admin/users' && req.method === 'GET') {
    const keyword = String(url.searchParams.get('keyword') || '').toLowerCase();
    let list = users.map(item => ({
      id: item.id,
      username: item.username || item.account || '',
      real_name: item.real_name || '',
      class_name: item.class_name || '',
      role: item.role,
      roleLabel: ROLE_LABEL[item.role] || item.role,
      status: item.status || USER_STATUS.ACTIVE,
      teacherAuthenticated: item.teacherAuthenticated === true
    }));
    if (keyword) list = list.filter(item => (item.username + ' ' + item.real_name + ' ' + item.class_name).toLowerCase().includes(keyword));
    return ok(res, '获取成功', list);
  }

  const userStatusMatch = p.match(/^\/api\/admin\/users\/(\d+)\/status$/);
  if (userStatusMatch && req.method === 'PUT') {
    const target = users.find(item => Number(item.id) === Number(userStatusMatch[1]));
    if (!target) return fail(res, '用户不存在', 404);
    const data = await body(req);
    const next = String(data.status || '');
    if (![USER_STATUS.ACTIVE, USER_STATUS.DISABLED].includes(next)) return fail(res, '账号状态不合法');
    if (next === USER_STATUS.DISABLED && Number(target.id) === Number(user.id)) return fail(res, '不能停用当前登录的管理员账号');
    if (next === USER_STATUS.DISABLED && target.role === 'admin' && users.filter(item => item.role === 'admin' && (item.status || USER_STATUS.ACTIVE) === USER_STATUS.ACTIVE).length <= 1) return fail(res, '平台至少需要保留一个可用的管理员账号');
    target.status = next;
    writeJson(USERS_FILE, users);
    return ok(res, next === USER_STATUS.DISABLED ? '账号已停用' : '账号已启用', { id: target.id, status: target.status });
  }

  if (p === '/api/admin/activities' && req.method === 'GET') {
    const keyword = String(url.searchParams.get('keyword') || '').toLowerCase();
    let list = activities.map(item => Object.assign(activityView(item), {
      publisher: item.publisher || '',
      summary: activitySummary(item)
    }));
    if (keyword) list = list.filter(item => (item.title + ' ' + item.publisher + ' ' + item.location).toLowerCase().includes(keyword));
    return ok(res, '获取成功', list);
  }

  const actStatusMatch = p.match(/^\/api\/admin\/activities\/(\d+)\/status$/);
  if (actStatusMatch && req.method === 'PUT') {
    const target = activities.find(item => Number(item.id) === Number(actStatusMatch[1]));
    if (!target) return fail(res, '活动不存在', 404);
    const data = await body(req);
    const next = String(data.status || '');
    if (![ACTIVITY_STATUS.ACTIVE, ACTIVITY_STATUS.SUSPENDED].includes(next)) return fail(res, '活动状态不合法');
    target.status = next;
    writeJson(ACTIVITIES_FILE, activities);
    return ok(res, next === ACTIVITY_STATUS.SUSPENDED ? '活动已停用（学生端不再展示）' : '活动已恢复', { id: target.id, status: target.status });
  }

  return fail(res, '接口不存在', 404);
}

/* ============================ 静态文件与服务器 ============================ */

function staticFile(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''); const file = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, '非法路径', 400);
  fs.readFile(file, (error, data) => {
    if (error) return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackError, fallback) => { if (fallbackError) return fail(res, '前端入口文件不存在', 404); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fallback); });
    const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html'; res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); res.end(data);
  });
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, 'ok', {});
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/admin/')) await adminApi(req, res, url);
    else if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else staticFile(res, url.pathname);
  }
  catch (error) { console.error(error); fail(res, error.message || '服务器处理失败', 500); }
});

function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      console.log('校园活动管理系统 V2.0 已启动：http://127.0.0.1:' + actualPort);
      resolve(actualPort);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function stopServer() {
  return new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

if (require.main === module) {
  startServer().catch(error => {
    console.error('服务启动失败：' + error.message);
    process.exitCode = 1;
  });
}

module.exports = { startServer, stopServer, server, REG, USER_STATUS, ACTIVITY_STATUS };
