/*
 * 需求访谈问答引擎（网页版）
 * ------------------------------------------------------------------
 * 本文件是《软件工程实验2：模拟需求访谈》桌面程序的对话内核移植版，
 * 与桌面端共用同一套知识库（public/assets/data/qa/*.json），算法保持一致：
 *
 *   1. Guard   —— 依据 rules.json 的短语/正则规则，在检索之前拦截越界问题；
 *   2. Matcher —— 字符级 TF-IDF（analyzer=char, ngram_range=(2,4),
 *                 sublinear_tf=True, smooth_idf=True, norm='l2'）+ 余弦相似度；
 *                 查询较短时对上一轮主题的相关主题做 context_boost 加权；
 *   3. Session —— 维护 last_topic、fact 命中次数、已回答过的条目，
 *                 从而支持上下文追问与“重复提问”提示。
 *
 * 移植时刻意保留了原实现的细节（包括 raw_score 与 adjusted 得分的区分），
 * 以保证同一问题在网页端与桌面端得到同一个知识条目。
 */
const QaEngine = (() => {
    const ROLES = ['student', 'organizer', 'admin'];
    const ROLE_FILES = { student: 'student.json', organizer: 'organizer.json', admin: 'admin.json' };
    const GUARD_ORDER = ['answer_extraction', 'technical_solution', 'internal_information', 'out_of_scope'];
    const NGRAM_MIN = 2;
    const NGRAM_MAX = 4;

    /* ============================ 文本预处理与向量化 ============================ */

    /** 与 Python 端 Guard.normalize 一致：去掉所有空白字符。 */
    const stripWhitespace = (text) => String(text ?? '').replace(/\s+/g, '').trim();

    /** 与 sklearn 的 char analyzer 预处理一致：小写化，并把连续空白压缩为单个空格。 */
    const preprocess = (doc) => String(doc ?? '').toLowerCase().replace(/\s\s+/g, ' ');

    /** 抽取字符 n-gram（n 从 2 到 4），保留空格，与 sklearn _char_ngrams 行为一致。 */
    function charNgrams(doc) {
        const chars = Array.from(preprocess(doc));
        const length = chars.length;
        const grams = [];
        for (let n = NGRAM_MIN; n <= Math.min(NGRAM_MAX, length); n += 1) {
            for (let i = 0; i + n <= length; i += 1) grams.push(chars.slice(i, i + n).join(''));
        }
        return grams;
    }

    function termCounts(doc) {
        const counts = new Map();
        for (const gram of charNgrams(doc)) counts.set(gram, (counts.get(gram) || 0) + 1);
        return counts;
    }

    /**
     * 构建 TF-IDF 向量器。
     * idf(t) = ln((1 + n) / (1 + df(t))) + 1   —— sklearn smooth_idf=True 的公式
     * 权重   = (1 + ln(tf)) * idf(t)            —— sublinear_tf=True
     * 最后做 L2 归一化，使余弦相似度退化为点积。
     */
    function buildVectorizer(docs) {
        const total = docs.length;
        const countsList = docs.map(termCounts);
        const df = new Map();
        for (const counts of countsList) for (const term of counts.keys()) df.set(term, (df.get(term) || 0) + 1);

        const vocab = new Map();
        for (const term of df.keys()) vocab.set(term, vocab.size);
        const idf = new Float64Array(vocab.size);
        for (const [term, index] of vocab) idf[index] = Math.log((1 + total) / (1 + df.get(term))) + 1;

        const toSparse = (counts) => {
            const vector = new Map();
            for (const [term, count] of counts) {
                const index = vocab.get(term);
                if (index === undefined) continue;
                vector.set(index, (1 + Math.log(count)) * idf[index]);
            }
            let squared = 0;
            for (const value of vector.values()) squared += value * value;
            const norm = Math.sqrt(squared);
            if (norm > 0) for (const [index, value] of vector) vector.set(index, value / norm);
            return vector;
        };

        const vectors = countsList.map(toSparse);
        return { size: vocab.size, vectors, transform: (doc) => toSparse(termCounts(doc)) };
    }

    function dotProduct(left, right) {
        if (left.size > right.size) { const swap = left; left = right; right = swap; }
        let sum = 0;
        for (const [index, value] of left) { const other = right.get(index); if (other !== undefined) sum += value * other; }
        return sum;
    }

    /* ============================ 知识库 ============================ */

    function normalizeFact(raw) {
        return {
            id: raw.id,
            role: raw.role,
            topic: raw.topic,
            fact: raw.fact,
            questions: raw.questions || [],
            answers: raw.answers || [],
            factType: raw.factType || raw.type || 'knowledge',
            redirectRole: raw.redirectRole || raw.redirect_role || null
        };
    }

    /** 从同源 JSON 加载知识库（三个角色的事实 + 规则文件）。 */
    async function loadKnowledge(baseUrl = '/assets/data/qa') {
        const names = [...ROLES.map((role) => ROLE_FILES[role]), 'rules.json'];
        const responses = await Promise.all(names.map((name) => fetch(baseUrl + '/' + name, { cache: 'no-cache' })));
        responses.forEach((response, index) => { if (!response.ok) throw new Error('知识库文件加载失败：' + names[index]); });
        const payloads = await Promise.all(responses.map((response) => response.json()));
        const factsByRole = {};
        ROLES.forEach((role, index) => { factsByRole[role] = payloads[index].map(normalizeFact); });
        return { factsByRole, rules: payloads[payloads.length - 1] };
    }

    /* ============================ 引擎 ============================ */

    class Engine {
        constructor(factsByRole, rules) {
            this.factsByRole = {};
            for (const role of ROLES) this.factsByRole[role] = (factsByRole[role] || []).map(normalizeFact);
            this.rules = rules || {};
            const settings = this.rules.settings || {};
            this.threshold = Number(settings.similarity_threshold ?? 0.25);
            this.contextBoost = Number(settings.context_boost ?? 0.08);
            this.shortQueryLength = Number(settings.short_query_length ?? 12);
            this.relatedTopics = settings.related_topics || {};
            this.guardResponses = (this.rules.guard && this.rules.guard.responses) || {};
            this.guardPatterns = this._compileGuard((this.rules.guard) || {});
            this.indexes = {};
            for (const role of ROLES) this.indexes[role] = this._buildIndex(role);
            this.session = null;
            this.setRole('student');
        }

        _compileGuard(guard) {
            const compiled = {};
            for (const reason of GUARD_ORDER) {
                compiled[reason] = (guard[reason] || []).map((pattern) => new RegExp(pattern, 'i'));
            }
            return compiled;
        }

        _buildIndex(role) {
            const rows = [];
            for (const fact of this.factsByRole[role] || []) {
                for (const question of fact.questions) rows.push({ fact, question });
            }
            return { vectorizer: buildVectorizer(rows.map((row) => row.question)), rows };
        }

        get roles() { return ROLES.slice(); }
        get roleConfig() { return (this.rules.roles && this.rules.roles[this.session.role]) || {}; }
        get roleName() { return this.roleConfig.display_name || this.session.role; }
        get greeting() { return this.roleConfig.greeting || ''; }

        setRole(role) {
            if (!ROLES.includes(role)) throw new Error('未知角色：' + role);
            this.session = {
                role,
                questionCount: 0,
                history: [],
                matchedFactIds: [],
                lastTopic: null,
                factHitCounts: new Map(),
                answeredFactTexts: new Map()
            };
            this.session.history.push({ sender: this.roleName, text: this.greeting });
            return this.session;
        }

        reset() { return this.setRole(this.session.role); }

        /** Guard：命中任一越界规则即拦截，返回预设话术。 */
        _checkGuard(text) {
            const normalized = stripWhitespace(text);
            for (const reason of GUARD_ORDER) {
                if ((this.guardPatterns[reason] || []).some((pattern) => pattern.test(normalized))) {
                    return { blocked: true, reason, response: this.guardResponses[reason] || null };
                }
            }
            return { blocked: false, reason: null, response: null };
        }

        /**
         * 检索最匹配的知识条目。
         * 返回 raw_score（未经 context_boost 的余弦相似度）用于阈值判定，
         * 与桌面端 matcher.search 保持一致。
         */
        search(role, query, lastTopic = null) {
            const { vectorizer, rows } = this.indexes[role];
            const queryVector = vectorizer.transform(query);
            const scores = vectorizer.vectors.map((vector) => dotProduct(queryVector, vector));
            const adjusted = scores.slice();

            const compactLength = String(query).split(/\s+/).join('').length;
            if (lastTopic && compactLength <= this.shortQueryLength) {
                const related = new Set([lastTopic, ...(this.relatedTopics[lastTopic] || [])]);
                rows.forEach((row, index) => { if (related.has(row.fact.topic)) adjusted[index] += this.contextBoost; });
            }

            let bestIndex = 0;
            for (let index = 1; index < adjusted.length; index += 1) if (adjusted[index] > adjusted[bestIndex]) bestIndex = index;
            const rawScore = scores[bestIndex];
            const row = rows[bestIndex];
            return {
                fact: rawScore < this.threshold ? null : row.fact,
                score: rawScore,
                adjustedScore: adjusted[bestIndex],
                matchedQuestion: row.question
            };
        }

        _recordMatch(factId, topic) {
            const session = this.session;
            session.matchedFactIds.push(factId);
            session.lastTopic = topic;
            const hitCount = (session.factHitCounts.get(factId) || 0) + 1;
            session.factHitCounts.set(factId, hitCount);
            return hitCount;
        }

        /**
         * 处理一个问题，返回对话响应。
         * kind 取值：empty / guard / unknown / repeated / redirect / matched
         */
        respond(rawQuestion) {
            const question = String(rawQuestion ?? '').trim();
            if (!question) return { text: '请输入一个具体问题。', kind: 'empty' };
            const session = this.session;
            session.questionCount += 1;
            session.history.push({ sender: '访谈者', text: question });

            const guard = this._checkGuard(question);
            if (guard.blocked) {
                const text = guard.response || '这个问题不在访谈范围内。';
                session.history.push({ sender: this.roleName, text });
                return { text, kind: 'guard', reason: guard.reason };
            }

            const match = this.search(session.role, question, session.lastTopic);
            if (!match.fact) {
                const text = this.roleConfig.fallback || '这个问题我暂时没有对应的信息。';
                session.history.push({ sender: this.roleName, text });
                return { text, kind: 'unknown', score: match.score, matchedQuestion: match.matchedQuestion };
            }

            const previous = session.answeredFactTexts.get(match.fact.id);
            const hitCount = this._recordMatch(match.fact.id, match.fact.topic);
            let answer;
            let kind;
            if (previous !== undefined) {
                answer = '我已经回答过这个问题了。' + previous;
                kind = 'repeated';
            } else {
                answer = match.fact.answers[hitCount % match.fact.answers.length];
                session.answeredFactTexts.set(match.fact.id, answer);
                kind = match.fact.factType === 'redirect' ? 'redirect' : 'matched';
            }
            session.history.push({ sender: this.roleName, text: answer });
            return {
                text: answer,
                kind,
                factId: match.fact.id,
                topic: match.fact.topic,
                redirectRole: match.fact.redirectRole,
                score: match.score,
                matchedQuestion: match.matchedQuestion
            };
        }

        /** 导出与桌面端一致的访谈记录文本。 */
        transcript() {
            return this.session.history.map((message) => '【' + message.sender + '】' + message.text).join('\n');
        }

        /** 当前角色全部知识条目的代表问题，用于页面上的快捷提问。 */
        suggestions() {
            return (this.factsByRole[this.session.role] || []).map((fact) => ({
                id: fact.id,
                topic: fact.topic,
                fact: fact.fact,
                question: fact.questions[0],
                redirect: fact.factType === 'redirect'
            }));
        }
    }

    return { Engine, loadKnowledge, ROLES, ROLE_FILES, charNgrams, buildVectorizer, stripWhitespace };
})();
