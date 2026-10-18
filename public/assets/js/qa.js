/*
 * 需求访谈问答页面
 * ------------------------------------------------------------------
 * 把《软件工程实验2：模拟需求访谈》的问答系统内嵌到校园活动管理系统中：
 * 三个角色在各自侧边栏都能看到「需求访谈问答」入口，进入后以当前登录身份
 * 作为访谈对象，直接向该角色提问，用于需求获取与需求演化证据收集。
 *
 * 对话内核来自 qa-engine.js，与桌面程序共用同一知识库与匹配算法。
 */
const QA_ROLE_LABEL = { student: '学生用户', organizer: '活动组织教师', admin: '系统管理员' };
const QA_ROLE_HINT = {
    student: '关注活动浏览、报名、候补与个人报名范围',
    organizer: '关注活动发布、人数上限、审核、候补递补',
    admin: '关注账号、角色权限与平台活动秩序'
};
const QA_KIND_TAG = {
    guard: { text: '越界拦截', cls: 'status-rejected' },
    redirect: { text: '需转交其他角色', cls: 'status-pending' },
    repeated: { text: '重复提问', cls: 'status-noreview' },
    unknown: { text: '未命中知识库', cls: 'status-ended' },
    empty: { text: '空问题', cls: 'status-ended' }
};

let qaEngine = null;
let qaLoadPromise = null;
let qaState = { role: null, showDetail: false };
let qaLog = [];

/** 当前登录身份默认对应的访谈对象。 */
function qaDefaultRole() {
    const role = currentUser?.role;
    return role === 'teacher' ? 'organizer' : role === 'admin' ? 'admin' : 'student';
}

function qaEnsureEngine() {
    if (qaEngine) return Promise.resolve(qaEngine);
    if (!qaLoadPromise) {
        qaLoadPromise = QaEngine.loadKnowledge().then(({ factsByRole, rules }) => {
            qaEngine = new QaEngine.Engine(factsByRole, rules);
            return qaEngine;
        });
    }
    return qaLoadPromise;
}

function qaResetLog() {
    qaLog = [{ sender: qaEngine.roleName, text: qaEngine.greeting, meta: { kind: 'greeting' } }];
}

/* ============================== 渲染 ============================== */

function qaBubble(message) {
    const isMe = message.sender === '访谈者';
    const meta = message.meta || {};
    const tag = QA_KIND_TAG[meta.kind];
    const detail = qaState.showDetail && (meta.factId || meta.score !== undefined)
        ? '<div class="qa-meta">' +
            (meta.factId ? '命中知识条目 <code>' + escapeHtml(meta.factId) + '</code>' : '未命中任何知识条目') +
            (meta.topic ? ' · 主题 <code>' + escapeHtml(meta.topic) + '</code>' : '') +
            (meta.score !== undefined ? ' · 相似度 <strong>' + meta.score.toFixed(3) + '</strong>' : '') +
            (meta.matchedQuestion ? '<br>最接近的原始问题：' + escapeHtml(meta.matchedQuestion) : '') +
          '</div>'
        : '';
    return '<div class="qa-msg ' + (isMe ? 'me' : 'bot') + '">' +
        '<div class="qa-avatar">' + (isMe ? '我' : '访') + '</div>' +
        '<div class="qa-bubble-wrap">' +
            '<div class="qa-sender">' + escapeHtml(message.sender) + (tag ? '<span class="status-tag ' + tag.cls + '">' + tag.text + '</span>' : '') + '</div>' +
            '<div class="qa-bubble">' + escapeHtml(message.text) + '</div>' + detail +
        '</div></div>';
}

function qaChips(role) {
    const facts = qaEngine.factsByRole[role] || [];
    const normal = facts.filter((fact) => fact.factType !== 'redirect');
    const redirect = facts.filter((fact) => fact.factType === 'redirect');
    const chip = (fact) => '<button class="qa-chip" data-question="' + escapeHtml(fact.questions[0]) + '">' + escapeHtml(fact.questions[0]) + '</button>';
    return '<div class="qa-chip-group"><h5>本角色可回答（' + normal.length + '）</h5><div class="qa-chips">' + normal.map(chip).join('') + '</div></div>' +
        (redirect.length ? '<div class="qa-chip-group"><h5>需转交其他角色（' + redirect.length + '）</h5><div class="qa-chips">' + redirect.map(chip).join('') + '</div></div>' : '');
}

function qaStats() {
    const session = qaEngine.session;
    const hits = [...session.factHitCounts.values()].reduce((sum, value) => sum + value, 0);
    return '<div class="qa-stats"><div><strong>' + session.questionCount + '</strong><span>已提问</span></div><div><strong>' + session.factHitCounts.size + '</strong><span>命中条目</span></div><div><strong>' + hits + '</strong><span>命中次数</span></div></div>';
}

function qaShell(role) {
    const roleButtons = QaEngine.ROLES.map((item) => '<button class="qa-role-btn ' + (item === role ? 'active' : '') + '" data-role="' + item + '">' + QA_ROLE_LABEL[item] + '</button>').join('');
    return '<div class="page-header"><h2 class="page-title">需求访谈问答</h2><p class="page-desc">以访谈对象身份提问，系统按知识库给出该角色的真实业务口径，用于需求获取与需求演化</p></div>' +
        '<div class="qa-intro"><span class="qa-intro-icon">💬</span><div><strong>内嵌的模拟需求访谈问答系统</strong><p>与《软件工程实验2：模拟需求访谈》桌面程序共用同一套知识库与匹配算法（字符级 TF-IDF + 余弦相似度），并保留越界拦截与跨角色转交规则。当前登录身份为「' + escapeHtml(QA_ROLE_LABEL[qaDefaultRole()]) + '」，已默认选中对应访谈对象。</p></div></div>' +
        '<div class="qa-roles">' + roleButtons + '<span class="qa-role-hint">' + escapeHtml(QA_ROLE_HINT[role]) + '</span></div>' +
        '<div class="qa-body"><div class="qa-chat"><div class="qa-messages" id="qa-messages">' + qaLog.map(qaBubble).join('') + '</div>' +
        '<div class="qa-input-row"><textarea class="input-field qa-textarea" id="qa-input" rows="2" maxlength="200" placeholder="输入你想了解的问题，Enter 发送，Shift + Enter 换行"></textarea><button class="btn btn-primary" id="qa-send">发 送</button></div>' +
        '<div class="qa-toolbar"><button class="btn btn-secondary btn-sm" id="qa-clear">清空对话</button><button class="btn btn-secondary btn-sm" id="qa-copy">复制访谈记录</button><button class="btn btn-secondary btn-sm" id="qa-export">导出访谈记录</button><button class="btn btn-ghost btn-sm" id="qa-toggle-detail">' + (qaState.showDetail ? '隐藏匹配详情' : '显示匹配详情') + '</button></div></div>' +
        '<aside class="qa-side"><div class="qa-side-card"><h4>快捷提问</h4><p class="qa-side-tip">点击任意问题直接发送</p>' + qaChips(role) + '</div>' +
        '<div class="qa-side-card"><h4>访谈进度</h4><div id="qa-stats">' + qaStats() + '</div><p class="qa-side-tip">同一问题重复提问时，系统会提示“我已经回答过这个问题了”，并复述上次的回答，便于确认口径一致。</p></div></aside></div>';
}

async function renderQaPage() {
    if (!qaState.role) qaState.role = qaDefaultRole();
    appRoot().innerHTML = layoutShell(currentUser.role, 'qa', '<div class="empty-state"><div class="empty-icon">⏳</div><div>正在加载问答知识库...</div></div>');
    bindLayoutEvents();
    try {
        await qaEnsureEngine();
    } catch (error) {
        appRoot().innerHTML = layoutShell(currentUser.role, 'qa', '<div class="empty-state"><div class="empty-icon">⚠️</div><div>' + escapeHtml(error.message || '知识库加载失败') + '</div></div>');
        bindLayoutEvents();
        return;
    }
    if (!qaLog.length || qaEngine.session.role !== qaState.role) { qaEngine.setRole(qaState.role); qaResetLog(); }
    appRoot().innerHTML = layoutShell(currentUser.role, 'qa', qaShell(qaState.role));
    bindLayoutEvents();
    bindQaEvents();
}

function qaRepaint() {
    document.getElementById('qa-messages').innerHTML = qaLog.map(qaBubble).join('');
    document.getElementById('qa-stats').innerHTML = qaStats();
    const messages = document.getElementById('qa-messages');
    messages.scrollTop = messages.scrollHeight;
}

function qaAsk(question) {
    const text = String(question ?? '').trim();
    if (!text) return;
    const result = qaEngine.respond(text);
    qaLog.push({ sender: '访谈者', text });
    qaLog.push({
        sender: qaEngine.roleName,
        text: result.text,
        meta: { kind: result.kind, factId: result.factId, topic: result.topic, score: result.score, matchedQuestion: result.matchedQuestion }
    });
    qaRepaint();
}

function qaTranscript() {
    const header = '# 模拟需求访谈记录\n# 访谈对象：' + qaEngine.roleName + '（' + qaState.role + '）\n# 来源：校园活动管理系统 V3.0 内嵌需求访谈问答模块\n';
    return header + '\n' + qaLog.map((message) => '【' + message.sender + '】' + message.text).join('\n') + '\n';
}

function qaDownload() {
    const stamp = formatDate(new Date().toISOString()).replace(/[-: ]/g, '').slice(0, 12);
    const blob = new Blob([qaTranscript()], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '访谈记录_' + QA_ROLE_LABEL[qaState.role] + '_' + stamp + '.txt';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast('访谈记录已导出', 'success');
}

async function qaCopy() {
    const text = qaTranscript();
    try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
        else {
            const area = document.createElement('textarea');
            area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
            document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
        }
        showToast('访谈记录已复制到剪贴板', 'success');
    } catch { showToast('复制失败，请改用导出功能', 'error'); }
}

function bindQaEvents() {
    const input = document.getElementById('qa-input');
    document.getElementById('qa-send').addEventListener('click', () => { qaAsk(input.value); input.value = ''; input.focus(); });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); qaAsk(input.value); input.value = ''; }
    });
    document.querySelectorAll('.qa-chip').forEach((chip) => chip.addEventListener('click', () => { qaAsk(chip.dataset.question); input.focus(); }));
    document.querySelectorAll('.qa-role-btn').forEach((button) => button.addEventListener('click', () => {
        if (button.dataset.role === qaState.role) return;
        qaState.role = button.dataset.role;
        qaEngine.setRole(qaState.role); qaResetLog();
        renderQaPage();
    }));
    document.getElementById('qa-clear').addEventListener('click', () => { qaEngine.reset(); qaResetLog(); renderQaPage(); showToast('对话已清空', 'success'); });
    document.getElementById('qa-copy').addEventListener('click', qaCopy);
    document.getElementById('qa-export').addEventListener('click', qaDownload);
    document.getElementById('qa-toggle-detail').addEventListener('click', () => { qaState.showDetail = !qaState.showDetail; renderQaPage(); });
    input.focus();
}
