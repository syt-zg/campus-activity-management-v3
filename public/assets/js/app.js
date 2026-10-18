/* 页面编排层：只负责渲染和交互，业务数据统一来自 Api。 */
const ACTIVITY_TYPES = ['文体活动', '学术竞赛', '志愿服务', '社团活动', '社会实践', '讲座培训', '其他'];
const ACTIVITY_STATUSES = ['未开始', '进行中', '已结束'];
const REG_STATUS = ['待审核', '正式参加', '候补中', '未通过'];

let currentView = 'login';
let currentUser = null;

const BUILTIN_AVATARS = [
    ['avatar-astronaut', '宇航员'], ['avatar-fox', '小狐狸'], ['avatar-panda', '小熊猫'],
    ['avatar-rabbit', '小白兔'], ['avatar-robot', '机器人'], ['avatar-cat', '眼镜猫']
];

const appRoot = () => document.getElementById('app');
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const formatDate = (value) => value ? String(value).replace('T', ' ').slice(0, 19) : '';
const inputDate = (value) => formatDate(value).replace(' ', 'T').slice(0, 16);
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function avatarContent(user) {
    const name = user?.real_name || user?.name || '';
    return user?.avatar_url
        ? '<img src="' + escapeHtml(user.avatar_url) + '" alt="' + escapeHtml(name || '用户') + '的头像" draggable="false">'
        : '<span class="avatar-initial">' + escapeHtml(name).charAt(0) + '</span>';
}

function renderAvatar(user, className, attributes = '') {
    return '<div class="' + className + '" ' + attributes + '>' + avatarContent(user) + '</div>';
}

const normalizeActivity = (item = {}) => {
    const maxParticipants = number(item.max_num ?? item.maxParticipants);
    const approvedCount = number(item.approvedCount ?? item.signupCount ?? item.join_num);
    return {
        id: item.id, title: item.title || '', type: item.type || '其他',
        description: item.content || item.description || '', notice: item.notice || '',
        location: item.place || item.location || '',
        startTime: formatDate(item.start_time || item.startTime),
        endTime: formatDate(item.end_time || item.endTime),
        maxParticipants, approvedCount,
        signupCount: approvedCount,
        waitlistCount: number(item.waitlistCount),
        pendingCount: number(item.pendingCount),
        rejectedCount: number(item.rejectedCount),
        remaining: item.remaining !== undefined ? number(item.remaining) : Math.max(0, maxParticipants - approvedCount),
        publisher: item.teacher_name || item.publisher || '',
        status: item.status || '未开始',
        platformStatus: item.platformStatus || 'active',
        requireReview: item.requireReview === true,
        eligibility: item.eligibility || '',
        signupTime: formatDate(item.signup_time || item.signupTime || item.create_time),
        myRegistration: item.myRegistration || null,
        summary: item.summary || null
    };
};

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type; toast.textContent = message; container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2800);
}
async function navigate(view) { currentView = view; await render(); }

async function render() {
    if (currentView !== 'login' && !Auth.isLoggedIn()) currentView = 'login';
    if (currentView === 'login') { appRoot().innerHTML = renderLogin(); bindLoginEvents(); return; }
    appRoot().innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div>正在加载...</div></div>';
    currentUser = currentUser || Storage.getCurrentUser();
    try {
        if (!currentUser) currentUser = await Auth.info();
        if (!currentUser) throw new Error('登录状态已失效，请重新登录');
        if (currentView === 'student-home') await renderStudentHome();
        else if (currentView === 'student-my-activities') await renderMyActivities();
        else if (currentView === 'qa') await renderQaPage();
        else if (currentView === 'student-profile' || currentView === 'teacher-profile' || currentView === 'admin-profile') renderProfile();
        else if (currentView === 'teacher-home') await renderTeacherHome();
        else if (currentView === 'admin-home') await renderAdminHome();
        else if (currentView === 'admin-users') await renderAdminUsers();
        else if (currentView === 'admin-activities') await renderAdminActivities();
        else {
            currentView = currentUser.role === 'student' ? 'student-home' : currentUser.role === 'teacher' ? 'teacher-home' : 'admin-home';
            await render();
        }
    } catch (error) {
        if (error.message && (error.message.includes('登录') || error.message.includes('token'))) {
            await Auth.logout(); currentUser = null; currentView = 'login'; showToast(error.message, 'error'); await render();
        } else appRoot().innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div>' + escapeHtml(error.message || '加载失败') + '</div></div>';
    }
}

/* ===== 标签渲染 ===== */
const TIME_STATUS_CLASS = { '未开始': 'status-pending', '进行中': 'status-ongoing', '已结束': 'status-ended' };
const REG_STATUS_CLASS = { '待审核': 'status-pending', '正式参加': 'status-joined', '候补中': 'status-waitlist', '未通过': 'status-rejected' };

function statusTag(status) {
    return '<span class="status-tag ' + (TIME_STATUS_CLASS[status] || 'status-ended') + '">' + escapeHtml(status) + '</span>';
}
function typeTag(type) { return '<span class="status-tag status-joined">' + escapeHtml(type) + '</span>'; }
function regTag(status, position) {
    const extra = status === '候补中' && position ? '·第 ' + position + ' 位' : '';
    return '<span class="status-tag ' + (REG_STATUS_CLASS[status] || 'status-joined') + '">' + escapeHtml(status) + extra + '</span>';
}
function reviewTag(required) {
    return required
        ? '<span class="status-tag status-review">需审核</span>'
        : '<span class="status-tag status-noreview">直接报名</span>';
}

/* ============================== 登录 / 注册 / 认证 ============================== */

function renderLogin() {
    const remembered = Storage.getRemembered(); const role = remembered?.role || 'student';
    const actionText = role === 'student' ? '学生注册' : role === 'teacher' ? '教师认证' : '';
    const accountLabel = role === 'student' ? '学号' : role === 'teacher' ? '教师编号' : '管理员账号';
    return '<div class="login-wrapper"><div class="login-card"><div class="login-header"><div class="login-logo">校</div><h1 class="login-title">校园活动管理系统</h1><p class="login-subtitle">Campus Activity Management System V2.0</p></div>' +
        '<div class="tab-switch" id="role-tabs"><div class="tab-item ' + (role === 'student' ? 'active' : '') + '" data-role="student">学生登录</div><div class="tab-item ' + (role === 'teacher' ? 'active' : '') + '" data-role="teacher">教师登录</div><div class="tab-item ' + (role === 'admin' ? 'active' : '') + '" data-role="admin">管理员登录</div></div>' +
        '<form id="login-form"><div class="input-group"><label class="input-label" id="account-label">' + accountLabel + '</label><input type="text" class="input-field" id="login-account" value="' + escapeHtml(remembered?.account || '') + '" placeholder="请输入账号" maxlength="20" ' + (role === 'admin' ? '' : 'inputmode="numeric"') + '></div>' +
        '<div class="input-group"><label class="input-label">登录密码</label><input type="password" class="input-field" id="login-password" value="' + escapeHtml(remembered?.password || '') + '" placeholder="请输入密码"><span class="password-toggle" id="toggle-pwd">👁</span></div>' +
        '<div class="login-options"><label class="remember-me"><input type="checkbox" id="remember-me" ' + (remembered ? 'checked' : '') + '><span>记住密码</span></label>' + (actionText ? '<span class="register-link" id="login-action-link">' + actionText + '</span>' : '<span class="login-tip">管理员账号由平台统一分配</span>') + '</div><button type="submit" class="btn btn-primary btn-block">登 录</button><button type="button" class="btn btn-secondary btn-block mt-16" id="clear-btn">清 空</button></form>' +
        '<div class="login-footer">© 2026 校园活动管理系统 V2.0 | 仅供演示使用</div></div></div>';
}
function bindLoginEvents() {
    let role = Storage.getRemembered()?.role || 'student';
    const syncRoleUi = () => {
        document.getElementById('account-label').textContent = role === 'student' ? '学号' : role === 'teacher' ? '教师编号' : '管理员账号';
        const action = document.getElementById('login-action-link');
        if (action) { action.textContent = role === 'student' ? '学生注册' : '教师认证'; action.onclick = () => role === 'student' ? showRegister() : showTeacherAuth(); }
    };
    document.querySelectorAll('#role-tabs .tab-item').forEach(tab => tab.addEventListener('click', () => {
        role = tab.dataset.role; document.querySelectorAll('#role-tabs .tab-item').forEach(item => item.classList.toggle('active', item === tab));
        document.getElementById('login-account').value = ''; document.getElementById('login-password').value = '';
        syncRoleUi();
    }));
    document.getElementById('toggle-pwd').addEventListener('click', () => { const input = document.getElementById('login-password'); input.type = input.type === 'password' ? 'text' : 'password'; });
    document.getElementById('clear-btn').addEventListener('click', () => { document.getElementById('login-account').value = ''; document.getElementById('login-password').value = ''; });
    document.getElementById('login-action-link')?.addEventListener('click', () => role === 'student' ? showRegister() : showTeacherAuth());
    document.getElementById('login-form').addEventListener('submit', async event => {
        event.preventDefault(); const account = document.getElementById('login-account').value.trim(); const password = document.getElementById('login-password').value.trim();
        if (!account) return showToast('请输入账号', 'error'); if (!password) return showToast('请输入密码', 'error');
        const result = await Auth.login(account, password, role, document.getElementById('remember-me').checked);
        if (!result.success) return showToast(result.message, 'error'); currentUser = result.user; showToast('登录成功', 'success');
        const home = role === 'student' ? 'student-home' : role === 'teacher' ? 'teacher-home' : 'admin-home';
        setTimeout(() => navigate(home), 350);
    });
}

function showRegister() {
    appRoot().innerHTML = '<div class="login-wrapper"><div class="login-card"><div class="login-header"><div class="login-logo">注</div><h1 class="login-title">学生注册</h1><p class="login-subtitle">创建校园活动系统学生账号</p></div><form id="register-form"><div class="input-group"><label class="input-label">学号</label><input class="input-field" id="reg-account" maxlength="20" inputmode="numeric" required></div><div class="input-group"><label class="input-label">姓名</label><input class="input-field" id="reg-name" maxlength="50" required></div><div class="input-group"><label class="input-label">所属班级</label><input class="input-field" id="reg-class" maxlength="100" required></div><div class="input-group"><label class="input-label">密码</label><input type="password" class="input-field" id="reg-password" minlength="6" required></div><div class="input-group"><label class="input-label">确认密码</label><input type="password" class="input-field" id="reg-password2" minlength="6" required></div><button type="submit" class="btn btn-primary btn-block">注册</button><button type="button" class="btn btn-secondary btn-block mt-16" id="back-login">返回登录</button></form><div class="login-footer">注册后即可使用学生端功能</div></div></div>';
    document.getElementById('back-login').addEventListener('click', () => { currentView = 'login'; render(); });
    document.getElementById('register-form').addEventListener('submit', async event => {
        event.preventDefault(); const account = document.getElementById('reg-account').value.trim(); const name = document.getElementById('reg-name').value.trim(); const className = document.getElementById('reg-class').value.trim(); const password = document.getElementById('reg-password').value; const password2 = document.getElementById('reg-password2').value;
        if (!/^\d{1,20}$/.test(account)) return showToast('学号必须为数字', 'error'); if (!name || !className) return showToast('请完整填写个人信息', 'error'); if (password.length < 6) return showToast('密码至少6位', 'error'); if (password !== password2) return showToast('两次密码不一致', 'error');
        const result = await Auth.register(account, password, name, className); if (!result.success) return showToast(result.message, 'error'); showToast('注册成功，请登录', 'success'); currentView = 'login'; setTimeout(() => render(), 350);
    });
}

function showTeacherAuth() {
    appRoot().innerHTML = '<div class="login-wrapper"><div class="login-card"><div class="login-header"><div class="login-logo">师</div><h1 class="login-title">教师认证</h1><p class="login-subtitle">认证完成后可使用教师编号和初始密码 123456 登录</p></div><form id="teacher-auth-form"><div class="input-group"><label class="input-label">教师姓名</label><input class="input-field" id="teacher-name" maxlength="50" required></div><div class="input-group"><label class="input-label">教师编号</label><input class="input-field" id="teacher-number" maxlength="20" inputmode="numeric" placeholder="请输入教师编号，例如 10011" required></div><div class="input-group"><label class="input-label">年龄</label><input type="number" class="input-field" id="teacher-age" min="18" max="80" required></div><button type="submit" class="btn btn-primary btn-block">提交认证申请</button><button type="button" class="btn btn-secondary btn-block mt-16" id="teacher-back-login">返回登录</button></form><div class="login-footer">教师编号可填写任意数字；认证成功后无需重复认证</div></div></div>';
    document.getElementById('teacher-back-login').addEventListener('click', () => render());
    document.getElementById('teacher-auth-form').addEventListener('submit', async event => {
        event.preventDefault();
        const name = document.getElementById('teacher-name').value.trim();
        const numberEl = document.getElementById('teacher-number');
        const number = numberEl.value.trim();
        const age = Number(document.getElementById('teacher-age').value);
        if (!/^\d{1,20}$/.test(number)) return showToast('教师编号必须为数字', 'error');
        const result = await Auth.applyTeacher(number, name, age);
        if (!result.success) return showToast(result.message, 'error');
        showTeacherApplicationDialog(number, result.data.applicationPassword);
    });
}

function showTeacherApplicationDialog(username, applicationPassword) {
    const dialog = document.createElement('div');
    dialog.className = 'teacher-application-dialog';
    dialog.style.cssText = 'position:fixed;top:20px;left:20px;z-index:9999;width:360px;background:#fff;border:2px solid #2563eb;border-radius:12px;box-shadow:0 12px 35px rgba(0,0,0,.22);padding:22px;';
    dialog.innerHTML = '<h3 style="margin:0 0 10px;color:#1d4ed8">教师申请密码</h3><p style="margin:0 0 12px">请记下申请密码，并在下方输入完成认证：</p><div style="font-size:32px;letter-spacing:8px;font-weight:700;text-align:center;color:#dc2626;margin:12px 0">' + applicationPassword + '</div><input class="input-field" id="teacher-application-code" maxlength="6" inputmode="numeric" placeholder="请输入六位申请密码"><div style="display:flex;gap:8px;margin-top:14px"><button class="btn btn-primary" id="teacher-verify-btn">确认认证</button><button class="btn btn-secondary" id="teacher-close-btn">关闭</button></div>';
    document.body.appendChild(dialog);
    dialog.querySelector('#teacher-close-btn').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#teacher-verify-btn').addEventListener('click', async () => {
        const code = dialog.querySelector('#teacher-application-code').value.trim();
        const result = await Auth.verifyTeacher(username, code);
        if (!result.success) return showToast(result.message, 'error');
        dialog.remove(); showToast('教师认证成功，请使用教师编号和初始密码 123456 登录', 'success'); render();
    });
}

/* ============================== 主布局 ============================== */

const MENUS = {
    student: [['student-home', '🏠', '活动首页'], ['student-my-activities', '📋', '我的活动'], ['qa', '💬', '需求访谈问答'], ['student-profile', '👤', '个人中心']],
    teacher: [['teacher-home', '📊', '活动管理'], ['qa', '💬', '需求访谈问答'], ['teacher-profile', '👤', '个人中心']],
    admin: [['admin-home', '🧭', '平台概览'], ['admin-users', '👥', '用户管理'], ['admin-activities', '🗂', '活动监管'], ['qa', '💬', '需求访谈问答'], ['admin-profile', '👤', '个人中心']]
};
const ROLE_LABEL = { student: '学生端', teacher: '教师端', admin: '管理端' };
const ROLE_TAG_CLASS = { student: 'status-joined', teacher: 'status-pending', admin: 'status-admin' };

function layoutShell(role, activeMenu, contentHtml) {
    const menus = MENUS[role] || MENUS.student;
    const name = currentUser?.real_name || currentUser?.name || '';
    return '<div class="app-layout"><nav class="top-nav"><div class="nav-left"><div class="nav-logo">校</div><span class="nav-title">校园活动管理系统</span><span class="status-tag ' + ROLE_TAG_CLASS[role] + '" style="margin-left:8px">' + ROLE_LABEL[role] + '</span></div><div class="nav-right"><button class="btn btn-ghost btn-sm" id="refresh-btn">🔄 刷新</button><div class="user-info" id="user-info">' + renderAvatar(currentUser, 'user-avatar') + '<span class="user-name">' + escapeHtml(name) + '</span></div><button class="btn btn-secondary btn-sm" id="logout-btn">退出</button></div></nav>' +
        '<div class="body-layout"><aside class="sidebar"><ul class="sidebar-menu">' + menus.map(([key, icon, label]) => '<li class="sidebar-item ' + (activeMenu === key ? 'active' : '') + '" data-view="' + key + '"><span class="sidebar-icon">' + icon + '</span><span>' + label + '</span></li>').join('') + '</ul></aside><main class="main-content" id="main-content">' + contentHtml + '</main></div><footer class="footer">© 2026 校园活动管理系统 V2.0 | 校园官方活动管理平台</footer></div>';
}
function bindLayoutEvents() {
    document.querySelectorAll('.sidebar-item').forEach(item => item.addEventListener('click', () => navigate(item.dataset.view)));
    document.getElementById('refresh-btn')?.addEventListener('click', () => { render(); showToast('已刷新', 'success'); });
    document.getElementById('logout-btn')?.addEventListener('click', async () => { await Auth.logout(); currentUser = null; showToast('已退出登录', 'success'); navigate('login'); });
    document.getElementById('user-info')?.addEventListener('click', () => {
        const role = currentUser.role;
        navigate(role === 'student' ? 'student-profile' : role === 'teacher' ? 'teacher-profile' : 'admin-profile');
    });
}

/* ============================== 学生端 ============================== */

/** 根据本人报名状态与名额情况决定按钮文案（R02 / R04 / R10） */
function signupButton(activity) {
    const reg = activity.myRegistration;
    if (reg) {
        const label = reg.status === '候补中' ? '候补中·第 ' + reg.position + ' 位'
            : reg.status === '正式参加' ? '已报名（正式参加）'
                : reg.status === '待审核' ? '等待教师审核' : '未通过审核';
        return { label, disabled: true, kind: 'ghost' };
    }
    if (activity.status !== '未开始') return { label: activity.status === '进行中' ? '活动进行中' : '已结束', disabled: true, kind: 'ghost' };
    if (activity.requireReview) return { label: '提交报名申请', disabled: false, kind: 'primary' };
    if (activity.remaining > 0) return { label: '立即报名', disabled: false, kind: 'primary' };
    return { label: '加入候补', disabled: false, kind: 'warning' };
}

async function renderStudentHome() {
    const activities = (await Student.getActivities({ page: 1, size: 100 })).map(normalizeActivity);
    const content = '<div class="page-header"><h2 class="page-title">活动首页</h2><p class="page-desc">浏览并参与您感兴趣的校园活动，名额已满的活动可以加入候补队列</p></div><div class="filter-bar"><div class="search-box"><span class="search-icon">🔍</span><input type="text" class="input-field" id="search-keyword" placeholder="搜索活动标题、地点..."></div><select class="input-field filter-select" id="filter-type"><option value="">全部类型</option>' + ACTIVITY_TYPES.map(type => '<option value="' + type + '">' + type + '</option>').join('') + '</select><select class="input-field filter-select" id="filter-status"><option value="">全部状态</option>' + ACTIVITY_STATUSES.map(status => '<option value="' + status + '">' + status + '</option>').join('') + '</select><button class="btn btn-secondary btn-sm" id="reset-filter">重置</button></div><div class="activity-grid activity-timeline" id="activity-list">' + renderActivityCards(activities) + '</div>';
    appRoot().innerHTML = layoutShell('student', 'student-home', content); bindLayoutEvents();
    const search = async () => {
        const params = { page: 1, size: 100, keyword: document.getElementById('search-keyword').value, type: document.getElementById('filter-type').value };
        try {
            const list = (await Student.getActivities(params)).map(normalizeActivity);
            const status = document.getElementById('filter-status').value;
            document.getElementById('activity-list').innerHTML = renderActivityCards(status ? list.filter(item => item.status === status) : list);
            bindCardEvents();
        } catch (error) { showToast(error.message, 'error'); }
    };
    document.getElementById('search-keyword').addEventListener('input', search); document.getElementById('filter-type').addEventListener('change', search); document.getElementById('filter-status').addEventListener('change', search);
    document.getElementById('reset-filter').addEventListener('click', () => { document.getElementById('search-keyword').value = ''; document.getElementById('filter-type').value = ''; document.getElementById('filter-status').value = ''; search(); });
    bindCardEvents();
}

function renderActivityCards(activities) {
    if (!activities.length) return '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📭</div><div>暂无符合条件的活动</div></div>';
    return activities.slice().sort((a, b) => a.startTime.localeCompare(b.startTime)).map(activity => {
        const button = signupButton(activity);
        const seats = '<span>正式 ' + activity.approvedCount + ' / ' + activity.maxParticipants + ' 人' +
            (activity.waitlistCount ? '，候补 ' + activity.waitlistCount + ' 人' : '') + '</span>';
        return '<div class="activity-card"><div class="card-header"><div class="card-title"><span>' + escapeHtml(activity.title) + '</span>' + statusTag(activity.status) + '</div><div class="card-tags">' + typeTag(activity.type) + (activity.requireReview ? reviewTag(true) : '') + '</div></div><div class="card-body"><div class="card-info"><span class="card-info-icon">🕒</span><span>' + escapeHtml(activity.startTime) + ' ~ ' + escapeHtml(activity.endTime.split(' ')[1] || '') + '</span></div><div class="card-info"><span class="card-info-icon">📍</span><span>' + escapeHtml(activity.location) + '</span></div><div class="card-info"><span class="card-info-icon">👥</span>' + seats + '</div>' + (activity.myRegistration ? '<div class="card-info"><span class="card-info-icon">📌</span><span>我的状态：</span>' + regTag(activity.myRegistration.status, activity.myRegistration.position) + '</div>' : '') + '<p class="card-desc">' + escapeHtml(activity.description) + '</p></div><div class="card-footer"><span class="publisher">发布老师：' + escapeHtml(activity.publisher) + '</span><div class="card-actions"><button class="btn btn-secondary btn-sm btn-detail" data-id="' + activity.id + '">查看详情</button><button class="btn btn-' + button.kind + ' btn-sm btn-signup" data-id="' + activity.id + '" ' + (button.disabled ? 'disabled' : '') + '>' + button.label + '</button></div></div></div>';
    }).join('');
}
function bindCardEvents() {
    document.querySelectorAll('.btn-detail').forEach(button => button.addEventListener('click', () => showActivityDetail(button.dataset.id)));
    document.querySelectorAll('.btn-signup').forEach(button => button.addEventListener('click', () => { if (!button.disabled) showSignupConfirm(button.dataset.id); }));
}

async function showActivityDetail(activityId) {
    try {
        const activity = normalizeActivity(await Api.detail(activityId));
        const isStudent = currentUser.role === 'student';
        const reg = activity.myRegistration;
        const rows = [
            ['活动标题', activity.title],
            ['活动类型', activity.type + ' ' + activity.status],
            ['开始时间', activity.startTime],
            ['结束时间', activity.endTime],
            ['活动地点', activity.location],
            ['名额情况', '正式 ' + activity.approvedCount + ' / ' + activity.maxParticipants + ' 人，剩余 ' + activity.remaining + ' 个名额' + (activity.waitlistCount ? '，候补 ' + activity.waitlistCount + ' 人' : '')],
            ['报名方式', activity.requireReview ? '需要活动组织教师审核' : '提交后直接确定'],
            ['发布老师', activity.publisher],
            ['活动简介', activity.description],
            ['活动须知', activity.notice || '暂无']
        ];
        if (activity.eligibility) rows.splice(7, 0, ['参加资格', activity.eligibility]);
        if (isStudent && reg) rows.push(['我的报名状态', reg.status + (reg.status === '候补中' ? '（第 ' + reg.position + ' 位）' : '')]);
        const modal = document.createElement('div'); modal.className = 'modal-mask';
        const footer = isStudent && !reg && activity.status === '未开始'
            ? '<button class="btn btn-primary modal-signup">' + (activity.requireReview ? '提交报名申请' : activity.remaining > 0 ? '立即报名' : '加入候补') + '</button>'
            : '';
        modal.innerHTML = '<div class="modal modal-lg"><div class="modal-header"><h3 class="modal-title">活动详情</h3><span class="modal-close">✕</span></div><div class="modal-body">' + rows.map(([label, value]) => '<div class="detail-row"><div class="detail-label">' + label + '</div><div class="detail-value">' + escapeHtml(value) + '</div></div>').join('') + '</div><div class="modal-footer"><button class="btn btn-secondary modal-cancel">关闭</button>' + footer + '</div></div>';
        document.body.appendChild(modal); const close = () => modal.remove();
        modal.querySelector('.modal-close').addEventListener('click', close); modal.querySelector('.modal-cancel').addEventListener('click', close);
        modal.addEventListener('click', event => { if (event.target === modal) close(); });
        modal.querySelector('.modal-signup')?.addEventListener('click', () => { close(); showSignupConfirm(activityId); });
    } catch (error) { showToast(error.message, 'error'); }
}

async function showSignupConfirm(activityId) {
    try {
        const activity = normalizeActivity(await Api.detail(activityId));
        const isWaitlist = !activity.requireReview && activity.remaining <= 0;
        const hint = activity.requireReview
            ? '<p class="hint-line">该活动需要活动组织教师审核，提交后请等待审核结果。</p>'
            : isWaitlist
                ? '<p class="hint-line">该活动正式名额已满，提交后将进入候补队列，按进入候补的时间先后等待名额。</p>'
                : '<p class="hint-line">提交后即确定为正式参加，可在活动开始前取消报名。</p>';
        const modal = document.createElement('div'); modal.className = 'modal-mask';
        modal.innerHTML = '<div class="modal"><div class="modal-header"><h3 class="modal-title">' + (activity.requireReview ? '提交报名申请' : isWaitlist ? '加入候补队列' : '报名确认') + '</h3><span class="modal-close">✕</span></div><div class="modal-body"><p>确定要报名参加 <strong>「' + escapeHtml(activity.title) + '」</strong> 吗？</p><p class="hint-line">活动时间：' + escapeHtml(activity.startTime) + '</p><p class="hint-line">活动地点：' + escapeHtml(activity.location) + '</p>' + hint + '</div><div class="modal-footer"><button class="btn btn-secondary modal-cancel">取消</button><button class="btn btn-primary modal-confirm">' + (isWaitlist ? '确认加入候补' : '确认报名') + '</button></div></div>';
        document.body.appendChild(modal); const close = () => modal.remove();
        modal.querySelector('.modal-close').addEventListener('click', close); modal.querySelector('.modal-cancel').addEventListener('click', close);
        modal.querySelector('.modal-confirm').addEventListener('click', async () => {
            const result = await Student.signup(activityId); close();
            if (!result.success) return showToast(result.message, 'error');
            const reg = result.data?.registration;
            showToast(reg?.status === '待审核' ? '报名申请已提交，等待教师审核'
                : reg?.status === '候补中' ? '活动名额已满，已加入候补队列（第 ' + reg.position + ' 位）'
                    : '报名成功', 'success');
            render();
        });
    } catch (error) { showToast(error.message, 'error'); }
}

async function renderMyActivities() {
    const activities = (await Student.getMySignups()).map(normalizeActivity).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const cards = activities.length ? activities.map(activity => {
        const reg = activity.myRegistration || {};
        const canCancel = reg.status !== '未通过' && activity.status !== '已结束';
        const actionLabel = reg.status === '候补中' ? '退出候补' : '取消报名';
        return '<div class="activity-card"><div class="card-header"><div class="card-title"><span>' + escapeHtml(activity.title) + '</span>' + statusTag(activity.status) + '</div><div class="card-tags">' + typeTag(activity.type) + regTag(reg.status, reg.position) + '</div></div><div class="card-body"><div class="card-info"><span class="card-info-icon">🕒</span><span>' + escapeHtml(activity.startTime) + '</span></div><div class="card-info"><span class="card-info-icon">📍</span><span>' + escapeHtml(activity.location) + '</span></div><div class="card-info"><span class="card-info-icon">👥</span><span>正式 ' + activity.approvedCount + ' / ' + activity.maxParticipants + ' 人' + (activity.waitlistCount ? '，候补 ' + activity.waitlistCount + ' 人' : '') + '</span></div><div class="card-info"><span class="card-info-icon">📝</span><span>申请时间：' + escapeHtml(formatDate(reg.applyTime) || activity.signupTime) + '</span></div>' + (reg.status === '候补中' ? '<p class="card-desc">您当前排在第 ' + reg.position + ' 位，有正式名额释放时会按顺序自动递补。</p>' : reg.status === '待审核' ? '<p class="card-desc">报名申请已提交，等待活动组织教师审核。</p>' : reg.status === '未通过' ? '<p class="card-desc">很抱歉，您的报名未通过该活动的参加条件。</p>' : '<p class="card-desc">您已确定为正式参加，如需取消请在活动开始前处理。</p>') + '</div><div class="card-footer"><span class="publisher">发布：' + escapeHtml(activity.publisher) + '</span><div class="card-actions"><button class="btn btn-secondary btn-sm btn-detail" data-id="' + activity.id + '">查看详情</button>' + (canCancel ? '<button class="btn ' + (reg.status === '候补中' ? 'btn-secondary' : 'btn-danger') + ' btn-sm btn-cancel" data-id="' + activity.id + '">' + actionLabel + '</button>' : '') + '</div></div></div>';
    }).join('') : '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📭</div><div>您还没有报名任何活动</div></div>';
    appRoot().innerHTML = layoutShell('student', 'student-my-activities', '<div class="page-header"><h2 class="page-title">我的活动</h2><p class="page-desc">共 ' + activities.length + ' 条报名记录，可在此查看报名状态与候补位次</p></div><div class="activity-grid">' + cards + '</div>');
    bindLayoutEvents();
    document.querySelectorAll('.btn-detail').forEach(button => button.addEventListener('click', () => showActivityDetail(button.dataset.id)));
    document.querySelectorAll('.btn-cancel').forEach(button => button.addEventListener('click', () => showCancelConfirm(button.dataset.id)));
}

async function showCancelConfirm(activityId) {
    let activity = null;
    try { activity = normalizeActivity(await Api.detail(activityId)); } catch { /* 忽略，使用默认文案 */ }
    const isWaitlist = activity?.myRegistration?.status === '候补中';
    const modal = document.createElement('div'); modal.className = 'modal-mask';
    modal.innerHTML = '<div class="modal"><div class="modal-header"><h3 class="modal-title">' + (isWaitlist ? '退出候补' : '取消报名') + '</h3><span class="modal-close">✕</span></div><div class="modal-body"><p>' + (isWaitlist ? '确定要退出该活动的候补队列吗？退出后您后面的候补者位次会依次前移。' : '确定要取消该活动的报名吗？取消后名额会释放，并自动递补给候补队列中排在最前面的同学。') + '</p></div><div class="modal-footer"><button class="btn btn-secondary modal-cancel">再想想</button><button class="btn btn-danger modal-confirm">' + (isWaitlist ? '确认退出候补' : '确认取消报名') + '</button></div></div>';
    document.body.appendChild(modal); const close = () => modal.remove();
    modal.querySelector('.modal-close').addEventListener('click', close); modal.querySelector('.modal-cancel').addEventListener('click', close);
    modal.querySelector('.modal-confirm').addEventListener('click', async () => {
        const result = await Student.cancelSignup(activityId); close();
        if (!result.success) return showToast(result.message, 'error');
        const names = result.data?.promotedNames || [];
        showToast(names.length ? '操作成功，已自动递补：' + names.join('、') : (isWaitlist ? '已退出候补队列' : '已取消报名'), 'success');
        render();
    });
}

/* ============================== 个人中心 ============================== */

function renderProfile() {
    const role = currentUser.role;
    const isStudent = role === 'student';
    const name = currentUser.real_name || currentUser.name || '';
    const account = currentUser.username || currentUser.account || '';
    const roleText = isStudent ? '学生' : role === 'teacher' ? '教师' : '系统管理员';
    const accountLabel = isStudent ? '学号' : role === 'teacher' ? '教师编号' : '管理员账号';
    const profileAvatar = renderAvatar(currentUser, 'profile-avatar profile-avatar-editable', 'id="profile-avatar-picker" role="button" tabindex="0" aria-label="更换头像" title="点击更换头像"');
    const content = '<div class="page-header"><h2 class="page-title">个人中心</h2><p class="page-desc">查看您的个人信息</p></div><div class="profile-card"><div class="profile-header"><div class="profile-avatar-wrap">' + profileAvatar + '<span class="profile-avatar-tip">点击头像更换</span></div><div class="profile-info"><h3>' + escapeHtml(name) + '</h3><p>' + roleText + '</p></div></div><ul class="info-list"><li class="info-item"><span class="info-key">' + accountLabel + '</span><span class="info-val">' + escapeHtml(account) + '</span></li><li class="info-item"><span class="info-key">姓名</span><span class="info-val">' + escapeHtml(name) + '</span></li>' + (currentUser.class_name ? '<li class="info-item"><span class="info-key">' + (isStudent ? '所属班级' : '所属单位') + '</span><span class="info-val">' + escapeHtml(currentUser.class_name) + '</span></li>' : '') + '<li class="info-item"><span class="info-key">身份</span><span class="info-val">' + roleText + '</span></li><li class="info-item"><span class="info-key">账号状态</span><span class="info-val">' + ((currentUser.status || 'active') === 'active' ? '正常' : '已停用') + '</span></li></ul><div style="margin-top:24px;text-align:center"><button class="btn btn-primary" id="change-password-btn">修改密码</button></div></div>';
    appRoot().innerHTML = layoutShell(role, isStudent ? 'student-profile' : role === 'teacher' ? 'teacher-profile' : 'admin-profile', content); bindLayoutEvents();
    document.getElementById('change-password-btn').addEventListener('click', showChangePassword);
    const avatarButton = document.getElementById('profile-avatar-picker');
    avatarButton.addEventListener('click', showAvatarPicker);
    avatarButton.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showAvatarPicker(); } });
}

function showAvatarPicker() {
    const modal = document.createElement('div');
    modal.className = 'modal-mask';
    const options = BUILTIN_AVATARS.map(([id, label]) => {
        const selected = String(currentUser.avatar_url || '').includes('/' + id + '.png');
        return '<button type="button" class="avatar-option ' + (selected ? 'selected' : '') + '" data-avatar="' + id + '"><img src="/assets/avatars/' + id + '.png" alt="' + label + '"><span>' + label + '</span></button>';
    }).join('');
    modal.innerHTML = '<div class="modal modal-lg"><div class="modal-header"><h3 class="modal-title">更换头像</h3><span class="modal-close">✕</span></div><div class="modal-body"><p class="avatar-picker-help">选择系统卡通头像，或上传本机照片。仅头像设置会被保存，不会改动账号和活动数据。</p><div class="avatar-grid">' + options + '</div><div class="avatar-upload-row"><input type="file" id="avatar-file-input" accept="image/png,image/jpeg,image/webp" hidden><button type="button" class="btn btn-secondary" id="avatar-upload-btn">选择本机照片</button><span>支持 PNG、JPEG、WebP，最大 2 MB</span></div></div><div class="modal-footer"><button class="btn btn-secondary modal-cancel">取消</button></div></div>';
    document.body.appendChild(modal);
    const close = () => modal.remove();
    const setBusy = busy => modal.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    const applyAvatar = async data => {
        setBusy(true);
        const result = await Auth.setAvatar(data);
        if (!result.success) { setBusy(false); return showToast(result.message, 'error'); }
        currentUser = result.user;
        close();
        showToast('头像已更新', 'success');
        await render();
    };
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.querySelector('.modal-cancel').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelectorAll('.avatar-option').forEach(button => button.addEventListener('click', () => applyAvatar({ mode: 'builtin', avatar: button.dataset.avatar })));
    const fileInput = modal.querySelector('#avatar-file-input');
    modal.querySelector('#avatar-upload-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return showToast('请选择 PNG、JPEG 或 WebP 图片', 'error');
        if (file.size > 2 * 1024 * 1024) return showToast('头像图片不能超过 2 MB', 'error');
        const reader = new FileReader();
        reader.onerror = () => showToast('无法读取所选图片，请重新选择', 'error');
        reader.onload = () => applyAvatar({ mode: 'custom', data_url: reader.result });
        reader.readAsDataURL(file);
    });
}

function showChangePassword() {
    const modal = document.createElement('div');
    modal.className = 'modal-mask';
    modal.innerHTML = '<div class="modal"><div class="modal-header"><h3 class="modal-title">修改密码</h3><span class="modal-close">✕</span></div><div class="modal-body"><p style="margin-bottom:16px;color:var(--gray-500)">请输入当前密码和新密码，修改后可使用新密码登录。</p><div class="input-group"><label class="input-label">当前密码</label><input type="password" class="input-field" id="current-password" autocomplete="current-password" placeholder="请输入当前密码"></div><div class="input-group"><label class="input-label">新密码</label><input type="password" class="input-field" id="new-password" autocomplete="new-password" minlength="6" maxlength="100" placeholder="请输入至少 6 位的新密码"></div><div class="input-group"><label class="input-label">确认新密码</label><input type="password" class="input-field" id="confirm-password" autocomplete="new-password" minlength="6" maxlength="100" placeholder="请再次输入新密码"></div></div><div class="modal-footer"><button class="btn btn-secondary modal-cancel">取消</button><button class="btn btn-primary modal-confirm">确认修改</button></div></div>';
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.querySelector('.modal-cancel').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('.modal-confirm').addEventListener('click', async () => {
        const currentPassword = modal.querySelector('#current-password').value;
        const newPassword = modal.querySelector('#new-password').value;
        const confirmPassword = modal.querySelector('#confirm-password').value;
        if (!currentPassword) return showToast('请输入当前密码', 'error');
        if (newPassword.length < 6) return showToast('新密码至少需要 6 位', 'error');
        if (newPassword !== confirmPassword) return showToast('两次输入的新密码不一致', 'error');
        const result = await Auth.changePassword(currentPassword, newPassword, confirmPassword);
        if (!result.success) return showToast(result.message, 'error');
        close(); showToast('密码修改成功', 'success');
    });
}

/* ============================== 教师端 ============================== */

async function renderTeacherHome() {
    const activities = (await Teacher.getMyActivities()).map(normalizeActivity);
    const totals = activities.reduce((acc, item) => {
        acc.approved += item.approvedCount; acc.waitlist += item.waitlistCount; acc.pending += item.pendingCount; return acc;
    }, { approved: 0, waitlist: 0, pending: 0 });
    const rows = activities.length ? activities.map(activity => '<tr><td style="max-width:180px">' + escapeHtml(activity.title) + '</td><td>' + typeTag(activity.type) + '</td><td style="font-size:12px;color:var(--gray-500)">' + escapeHtml(activity.startTime) + '</td><td>' + escapeHtml(activity.location) + '</td><td><strong>' + activity.approvedCount + '</strong> / ' + activity.maxParticipants + '<div class="cell-sub">剩余 ' + activity.remaining + ' 个名额</div></td><td>' + (activity.waitlistCount ? '<span class="status-tag status-waitlist">候补 ' + activity.waitlistCount + '</span>' : '—') + '</td><td>' + (activity.pendingCount ? '<span class="status-tag status-pending">待审核 ' + activity.pendingCount + '</span>' : '—') + '</td><td>' + statusTag(activity.status) + (activity.platformStatus === 'suspended' ? '<div class="cell-sub"><span class="status-tag status-suspended">已停用</span></div>' : '') + '</td><td><div class="table-actions"><button class="btn btn-secondary btn-sm btn-detail" data-id="' + activity.id + '">详情</button>' + (activity.status === '未开始' ? '<button class="btn btn-secondary btn-sm btn-edit" data-id="' + activity.id + '">编辑</button>' : '') + '<button class="btn ' + (activity.pendingCount ? 'btn-primary' : 'btn-secondary') + ' btn-sm btn-signups" data-id="' + activity.id + '">报名名单' + (activity.pendingCount ? ' (' + activity.pendingCount + ')' : '') + '</button><button class="btn btn-danger btn-sm btn-delete" data-id="' + activity.id + '">删除</button></div></td></tr>').join('') : '<tr><td colspan="9" class="empty-state"><div class="empty-icon">📭</div><div>暂无活动，点击“新增活动”发布</div></td></tr>';
    const content = '<div class="page-header" style="display:flex;justify-content:space-between;align-items:center"><div><h2 class="page-title">活动管理</h2><p class="page-desc">发布和管理您负责的活动，并处理学生报名</p></div><button class="btn btn-primary" id="add-activity-btn">+ 新增活动</button></div><div class="stats-grid"><div class="stat-card"><div class="stat-value">' + activities.length + '</div><div class="stat-label">活动总数</div></div><div class="stat-card" style="border-left-color:var(--success)"><div class="stat-value" style="color:var(--success)">' + totals.approved + '</div><div class="stat-label">正式参加合计</div></div><div class="stat-card" style="border-left-color:var(--primary-light)"><div class="stat-value" style="color:var(--primary-light)">' + totals.waitlist + '</div><div class="stat-label">候补中合计</div></div><div class="stat-card" style="border-left-color:var(--warning)"><div class="stat-value" style="color:var(--warning)">' + totals.pending + '</div><div class="stat-label">待审核合计</div></div></div><div class="activity-table"><table><thead><tr><th>活动标题</th><th>类型</th><th>时间</th><th>地点</th><th>正式/上限</th><th>候补</th><th>待审核</th><th>状态</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    appRoot().innerHTML = layoutShell('teacher', 'teacher-home', content); bindLayoutEvents();
    document.getElementById('add-activity-btn').addEventListener('click', () => showActivityForm());
    document.querySelectorAll('.btn-detail').forEach(button => button.addEventListener('click', () => showActivityDetail(button.dataset.id)));
    document.querySelectorAll('.btn-edit').forEach(button => button.addEventListener('click', () => showActivityForm(button.dataset.id)));
    document.querySelectorAll('.btn-delete').forEach(button => button.addEventListener('click', () => confirmDelete(button.dataset.id)));
    document.querySelectorAll('.btn-signups').forEach(button => button.addEventListener('click', () => showSignupList(button.dataset.id)));
}
async function confirmDelete(activityId) { if (!confirm('确定要删除该活动吗？删除后不可恢复，相关报名记录也将被清除。')) return; const result = await Teacher.deleteActivity(activityId); if (result.success) { showToast('活动已删除', 'success'); render(); } else showToast(result.message, 'error'); }

async function showActivityForm(activityId = null) {
    const isEdit = Boolean(activityId);
    let activity = { title: '', type: '', startTime: '', endTime: '', location: '', maxParticipants: 50, description: '', notice: '', requireReview: false, eligibility: '' };
    if (isEdit) activity = normalizeActivity(await Api.detail(activityId));
    const modal = document.createElement('div'); modal.className = 'modal-mask';
    modal.innerHTML = '<div class="modal modal-lg"><div class="modal-header"><h3 class="modal-title">' + (isEdit ? '编辑活动' : '发布新活动') + '</h3><span class="modal-close">✕</span></div><div class="modal-body"><div class="input-group"><label class="input-label">活动标题 *</label><input class="input-field" id="f-title" value="' + escapeHtml(activity.title) + '" maxlength="50"></div><div class="flex gap-8"><div class="input-group" style="flex:1"><label class="input-label">活动类型 *</label><select class="input-field" id="f-type"><option value="">请选择</option>' + ACTIVITY_TYPES.map(type => '<option value="' + type + '" ' + (type === activity.type ? 'selected' : '') + '>' + type + '</option>').join('') + '</select></div><div class="input-group" style="flex:1"><label class="input-label">招募人数（正式名额上限）*</label><input type="number" class="input-field" id="f-max" value="' + activity.maxParticipants + '" min="1"></div></div><div class="flex gap-8"><div class="input-group" style="flex:1"><label class="input-label">开始时间 *</label><input type="datetime-local" class="input-field" id="f-start" value="' + inputDate(activity.startTime) + '"></div><div class="input-group" style="flex:1"><label class="input-label">结束时间 *</label><input type="datetime-local" class="input-field" id="f-end" value="' + inputDate(activity.endTime) + '"></div></div><div class="input-group"><label class="input-label">活动地点 *</label><input class="input-field" id="f-location" value="' + escapeHtml(activity.location) + '" maxlength="50"></div><div class="input-group"><label class="input-label">活动简介 *</label><textarea class="input-field" id="f-desc" rows="3" maxlength="300">' + escapeHtml(activity.description) + '</textarea></div><div class="input-group"><label class="input-label">活动须知</label><textarea class="input-field" id="f-notice" rows="2" maxlength="200">' + escapeHtml(activity.notice) + '</textarea></div><div class="input-group"><label class="checkbox"><input type="checkbox" id="f-review" ' + (activity.requireReview ? 'checked' : '') + '><span>该活动需要审核报名资格</span></label><div class="form-hint">勾选后，学生报名先进入“待审核”，由您确认通过或拒绝；通过后仍按剩余名额决定正式参加或候补。</div></div><div class="input-group"><label class="input-label">参加资格说明（需要审核时建议填写）</label><textarea class="input-field" id="f-eligibility" rows="2" maxlength="200" placeholder="例如：仅限计算机专业大二以上学生">' + escapeHtml(activity.eligibility) + '</textarea></div></div><div class="modal-footer"><button class="btn btn-secondary modal-cancel">取消</button><button class="btn btn-primary modal-confirm">' + (isEdit ? '保存修改' : '确认发布') + '</button></div></div>';
    document.body.appendChild(modal); const close = () => modal.remove();
    modal.querySelector('.modal-close').addEventListener('click', close); modal.querySelector('.modal-cancel').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('.modal-confirm').addEventListener('click', async () => {
        const data = {
            title: document.getElementById('f-title').value.trim(), type: document.getElementById('f-type').value,
            startTime: document.getElementById('f-start').value.replace('T', ' '), endTime: document.getElementById('f-end').value.replace('T', ' '),
            location: document.getElementById('f-location').value.trim(), maxParticipants: Number(document.getElementById('f-max').value),
            description: document.getElementById('f-desc').value.trim(), notice: document.getElementById('f-notice').value.trim(),
            requireReview: document.getElementById('f-review').checked, eligibility: document.getElementById('f-eligibility').value.trim()
        };
        if (!data.title || !data.type || !data.startTime || !data.endTime || !data.location || !data.description || data.maxParticipants <= 0) return showToast('请完整填写必填项', 'error');
        if (data.startTime >= data.endTime) return showToast('结束时间必须晚于开始时间', 'error');
        if (data.requireReview && !data.eligibility) return showToast('需要审核的活动请填写参加资格说明', 'error');
        const result = isEdit ? await Teacher.updateActivity(activityId, data) : await Teacher.createActivity(data);
        if (!result.success) return showToast(result.message, 'error');
        close(); showToast(isEdit ? '修改成功' : '发布成功', 'success'); render();
    });
}

async function showSignupList(activityId) {
    try {
        const data = await Teacher.getSignupList(activityId);
        const item = normalizeActivity(data.activity);
        const summary = data.summary;
        const registrations = data.registrations;
        const group = (status) => registrations.filter(reg => reg.status === status);
        const renderRow = (reg, index) => {
            const actions = reg.status === '待审核'
                ? '<div class="table-actions"><button class="btn btn-primary btn-sm btn-approve" data-user="' + reg.userId + '">通过</button><button class="btn btn-danger btn-sm btn-reject" data-user="' + reg.userId + '">拒绝</button></div>'
                : '';
            return '<tr><td>' + (index + 1) + '</td><td>' + escapeHtml(reg.real_name) + '</td><td>' + escapeHtml(reg.username) + '</td><td>' + escapeHtml(reg.class_name || '—') + '</td><td>' + regTag(reg.status, reg.position) + '</td><td class="cell-sub">' + escapeHtml(formatDate(reg.applyTime) || '—') + '</td><td>' + actions + '</td></tr>';
        };
        const section = (title, list, tip) => '<div class="list-section"><h4 class="list-section-title">' + title + '<span class="list-count">' + list.length + ' 人</span></h4>' + (tip ? '<p class="form-hint">' + tip + '</p>' : '') + (list.length ? '<div class="activity-table"><table><thead><tr><th>#</th><th>姓名</th><th>学号</th><th>班级</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead><tbody>' + list.map(renderRow).join('') + '</tbody></table></div>' : '<div class="empty-state" style="padding:24px"><div>暂无记录</div></div>') + '</div>';
        const modal = document.createElement('div'); modal.className = 'modal-mask';
        modal.innerHTML = '<div class="modal modal-xl"><div class="modal-header"><h3 class="modal-title">报名名单 - ' + escapeHtml(item.title) + '</h3><span class="modal-close">✕</span></div><div class="modal-body"><div class="summary-bar"><span>正式参加 <strong>' + summary.approvedCount + '</strong> / ' + summary.maxParticipants + '</span><span>剩余名额 <strong>' + summary.remaining + '</strong></span><span>候补 <strong>' + summary.waitlistCount + '</strong></span><span>待审核 <strong>' + summary.pendingCount + '</strong></span><span>未通过 <strong>' + summary.rejectedCount + '</strong></span></div>' + section('待审核申请', group('待审核'), '通过后将按当前剩余名额自动确定为“正式参加”或“候补中”。') + section('正式参加名单', group('正式参加')) + section('候补队列（按进入候补时间排序）', group('候补中')) + section('未通过', group('未通过')) + '</div><div class="modal-footer"><button class="btn btn-secondary modal-cancel">关闭</button></div></div>';
        document.body.appendChild(modal); const close = () => modal.remove();
        modal.querySelector('.modal-close').addEventListener('click', close); modal.querySelector('.modal-cancel').addEventListener('click', close);
        modal.addEventListener('click', event => { if (event.target === modal) close(); });
        const doReview = async (userId, action) => {
            const result = await Teacher.reviewRegistration(activityId, userId, action);
            if (!result.success) return showToast(result.message, 'error');
            const reg = result.data?.registration;
            showToast(action === 'reject' ? '已拒绝该报名申请' : reg?.status === '候补中' ? '已通过审核，因名额已满转入候补' : '已通过审核，该学生成为正式参加', 'success');
            close(); await render(); showSignupList(activityId);
        };
        modal.querySelectorAll('.btn-approve').forEach(button => button.addEventListener('click', () => doReview(Number(button.dataset.user), 'approve')));
        modal.querySelectorAll('.btn-reject').forEach(button => button.addEventListener('click', () => doReview(Number(button.dataset.user), 'reject')));
    } catch (error) { showToast(error.message, 'error'); }
}

/* ============================== 管理员端 ============================== */

async function renderAdminHome() {
    const [overview, activities] = await Promise.all([Admin.getOverview(), Admin.getActivities()]);
    const content = '<div class="page-header"><h2 class="page-title">平台概览</h2><p class="page-desc">从平台角度维护账号、角色与活动秩序，不介入具体活动的人数与报名业务</p></div>' +
        '<div class="stats-grid"><div class="stat-card"><div class="stat-value">' + overview.userCount + '</div><div class="stat-label">平台账号总数</div></div><div class="stat-card" style="border-left-color:var(--primary-light)"><div class="stat-value" style="color:var(--primary-light)">' + overview.studentCount + '</div><div class="stat-label">学生账号</div></div><div class="stat-card" style="border-left-color:var(--success)"><div class="stat-value" style="color:var(--success)">' + overview.teacherCount + '</div><div class="stat-label">教师账号</div></div><div class="stat-card" style="border-left-color:var(--danger)"><div class="stat-value" style="color:var(--danger)">' + overview.disabledCount + '</div><div class="stat-label">已停用账号</div></div><div class="stat-card" style="border-left-color:var(--primary)"><div class="stat-value">' + overview.activityCount + '</div><div class="stat-label">平台活动总数</div></div><div class="stat-card" style="border-left-color:var(--warning)"><div class="stat-value" style="color:var(--warning)">' + overview.suspendedCount + '</div><div class="stat-label">已停用活动</div></div></div>' +
        '<div class="admin-grid"><div class="admin-card"><h3>用户管理</h3><p>查看平台全部账号与状态，停用异常账号或恢复使用。</p><button class="btn btn-primary btn-sm" id="go-users">进入用户管理</button></div><div class="admin-card"><h3>活动监管</h3><p>查看平台全部活动，停用不符合平台管理要求的活动。</p><button class="btn btn-primary btn-sm" id="go-activities">进入活动监管</button></div><div class="admin-card"><h3>职责边界</h3><p>管理员不决定活动人数、参加资格与候补顺序，也不代替教师审核报名。</p><span class="status-tag status-noreview">仅平台秩序</span></div></div>' +
        '<div class="page-header" style="margin-top:24px"><h2 class="page-title">最近活动</h2><p class="page-desc">共 ' + activities.length + ' 条活动记录</p></div>' + activityAdminTable(activities.slice(0, 5));
    appRoot().innerHTML = layoutShell('admin', 'admin-home', content); bindLayoutEvents();
    document.getElementById('go-users').addEventListener('click', () => navigate('admin-users'));
    document.getElementById('go-activities').addEventListener('click', () => navigate('admin-activities'));
    bindAdminActivityEvents();
}

function activityAdminTable(activities) {
    if (!activities.length) return '<div class="empty-state"><div class="empty-icon">🗂</div><div>平台暂无活动</div></div>';
    return '<div class="activity-table"><table><thead><tr><th>活动标题</th><th>发布老师</th><th>时间</th><th>正式/上限</th><th>候补</th><th>状态</th><th>平台状态</th><th>操作</th></tr></thead><tbody>' + activities.map(activity => '<tr><td style="max-width:180px">' + escapeHtml(activity.title) + '</td><td>' + escapeHtml(activity.publisher) + '</td><td style="font-size:12px;color:var(--gray-500)">' + escapeHtml(activity.startTime) + '</td><td>' + activity.approvedCount + ' / ' + activity.maxParticipants + '</td><td>' + (activity.waitlistCount || '—') + '</td><td>' + statusTag(activity.status) + '</td><td>' + (activity.platformStatus === 'suspended' ? '<span class="status-tag status-suspended">已停用</span>' : '<span class="status-tag status-noreview">正常</span>') + '</td><td><div class="table-actions">' + (activity.platformStatus === 'suspended' ? '<button class="btn btn-secondary btn-sm btn-restore" data-id="' + activity.id + '">恢复</button>' : '<button class="btn btn-danger btn-sm btn-suspend" data-id="' + activity.id + '">停用</button>') + '</div></td></tr>').join('') + '</tbody></table></div>';
}
function bindAdminActivityEvents() {
    document.querySelectorAll('.btn-suspend').forEach(button => button.addEventListener('click', () => changeActivityStatus(button.dataset.id, 'suspended')));
    document.querySelectorAll('.btn-restore').forEach(button => button.addEventListener('click', () => changeActivityStatus(button.dataset.id, 'active')));
}
async function changeActivityStatus(activityId, status) {
    if (status === 'suspended' && !confirm('确定要停用该活动吗？停用后学生端不再展示该活动，也无法报名。')) return;
    const result = await Admin.setActivityStatus(activityId, status);
    if (!result.success) return showToast(result.message, 'error');
    showToast(status === 'suspended' ? '活动已停用' : '活动已恢复', 'success'); render();
}

async function renderAdminActivities() {
    const activities = await Admin.getActivities();
    const content = '<div class="page-header"><h2 class="page-title">活动监管</h2><p class="page-desc">查看平台全部活动，处理违规或明显错误的活动状态</p></div><div class="filter-bar"><div class="search-box"><span class="search-icon">🔍</span><input type="text" class="input-field" id="admin-activity-keyword" placeholder="搜索活动标题、发布老师或地点..."></div><button class="btn btn-secondary btn-sm" id="admin-activity-reset">重置</button></div><div id="admin-activity-table">' + activityAdminTable(activities) + '</div>';
    appRoot().innerHTML = layoutShell('admin', 'admin-activities', content); bindLayoutEvents();
    bindAdminActivityEvents();
    const search = async () => { const list = await Admin.getActivities(document.getElementById('admin-activity-keyword').value); document.getElementById('admin-activity-table').innerHTML = activityAdminTable(list); bindAdminActivityEvents(); };
    document.getElementById('admin-activity-keyword').addEventListener('input', search);
    document.getElementById('admin-activity-reset').addEventListener('click', () => { document.getElementById('admin-activity-keyword').value = ''; search(); });
}

async function renderAdminUsers() {
    const users = await Admin.getUsers();
    const content = '<div class="page-header"><h2 class="page-title">用户管理</h2><p class="page-desc">查看平台全部账号与状态，停用异常账号或恢复使用</p></div><div class="filter-bar"><div class="search-box"><span class="search-icon">🔍</span><input type="text" class="input-field" id="admin-user-keyword" placeholder="搜索账号、姓名或班级..."></div><button class="btn btn-secondary btn-sm" id="admin-user-reset">重置</button></div><div id="admin-user-table">' + userTable(users) + '</div>';
    appRoot().innerHTML = layoutShell('admin', 'admin-users', content); bindLayoutEvents();
    bindUserEvents();
    const search = async () => { const list = await Admin.getUsers(document.getElementById('admin-user-keyword').value); document.getElementById('admin-user-table').innerHTML = userTable(list); bindUserEvents(); };
    document.getElementById('admin-user-keyword').addEventListener('input', search);
    document.getElementById('admin-user-reset').addEventListener('click', () => { document.getElementById('admin-user-keyword').value = ''; search(); });
}

function userTable(users) {
    if (!users.length) return '<div class="empty-state"><div class="empty-icon">👥</div><div>没有匹配的账号</div></div>';
    return '<div class="activity-table"><table><thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>班级/单位</th><th>教师认证</th><th>账号状态</th><th>操作</th></tr></thead><tbody>' + users.map(user => '<tr><td>' + escapeHtml(user.username) + '</td><td>' + escapeHtml(user.real_name) + '</td><td><span class="status-tag ' + (user.role === 'admin' ? 'status-admin' : user.role === 'teacher' ? 'status-pending' : 'status-joined') + '">' + escapeHtml(user.roleLabel) + '</span></td><td>' + escapeHtml(user.class_name || '—') + '</td><td>' + (user.role === 'teacher' ? (user.teacherAuthenticated ? '已认证' : '未认证') : '—') + '</td><td>' + (user.status === 'disabled' ? '<span class="status-tag status-rejected">已停用</span>' : '<span class="status-tag status-noreview">正常</span>') + '</td><td><div class="table-actions">' + (user.status === 'disabled' ? '<button class="btn btn-secondary btn-sm btn-enable" data-id="' + user.id + '">启用账号</button>' : '<button class="btn btn-danger btn-sm btn-disable" data-id="' + user.id + '">停用账号</button>') + '</div></td></tr>').join('') + '</tbody></table></div>';
}
function bindUserEvents() {
    document.querySelectorAll('.btn-disable').forEach(button => button.addEventListener('click', () => changeUserStatus(button.dataset.id, 'disabled')));
    document.querySelectorAll('.btn-enable').forEach(button => button.addEventListener('click', () => changeUserStatus(button.dataset.id, 'active')));
}
async function changeUserStatus(userId, status) {
    if (status === 'disabled' && !confirm('确定要停用该账号吗？停用后该用户将无法登录系统。')) return;
    const result = await Admin.setUserStatus(userId, status);
    if (!result.success) return showToast(result.message, 'error');
    showToast(status === 'disabled' ? '账号已停用' : '账号已启用', 'success'); render();
}

render();
