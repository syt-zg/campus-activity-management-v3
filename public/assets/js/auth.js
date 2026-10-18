const Auth = {
    async login(account, password, role, remember) {
        try {
            let result;
            try { result = await Api.login(account, password); }
            catch (error) {
                const legacy = role === 'student' ? readLegacyUser(account, password, role) : null;
                if (!legacy) throw error;
                const migrated = await this.register(legacy.account, legacy.password, legacy.name, legacy.className);
                if (!migrated.success && !migrated.message.includes('已被注册')) return migrated;
                result = await Api.login(account, password);
            }
            const { token, user } = result;
            if (user.role !== role) throw new Error('账号、密码错误或身份不匹配');
            localStorage.setItem('cas_token', token);
            Storage.setCurrentUser(user);
            if (remember) Storage.setRemembered({ account, password, role });
            else Storage.clearRemembered();
            return { success: true, user };
        } catch (error) {
            return { success: false, message: error.message || '登录失败' };
        }
    },
    async register(account, password, name, className) {
        try {
            await Api.register({ username: account, password, real_name: name, role: 'student', class_name: className });
            return { success: true };
        } catch (error) { return { success: false, message: error.message || '注册失败' }; }
    },
    async applyTeacher(username, name, age) {
        try { return { success: true, data: await Api.teacherApply({ username, real_name: name, age }) }; }
        catch (error) { return { success: false, message: error.message || '教师认证申请失败' }; }
    },
    async verifyTeacher(username, applicationPassword) {
        try { await Api.teacherVerify({ username, application_password: applicationPassword }); return { success: true }; }
        catch (error) { return { success: false, message: error.message || '教师认证失败' }; }
    },
    async changePassword(currentPassword, newPassword, confirmPassword) {
        try {
            await Api.changePassword({ current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword });
            const remembered = Storage.getRemembered();
            if (remembered) Storage.setRemembered({ ...remembered, password: newPassword });
            return { success: true };
        } catch (error) { return { success: false, message: error.message || '密码修改失败' }; }
    },
    async info() {
        try {
            const user = await Api.info();
            Storage.setCurrentUser(user);
            return user;
        } catch { return null; }
    },
    async setAvatar(data) {
        try {
            const user = await Api.setAvatar(data);
            Storage.setCurrentUser(user);
            return { success: true, user };
        } catch (error) { return { success: false, message: error.message || '头像更新失败' }; }
    },
    async logout() {
        try { if (this.isLoggedIn()) await Api.logout(); }
        finally {
            localStorage.removeItem('cas_token');
            Storage.clearCurrentUser();
        }
    },
    isLoggedIn() { return Boolean(localStorage.getItem('cas_token')); }
};

function readLegacyUser(account, password, role) {
    try {
        const users = JSON.parse(localStorage.getItem('cas_users') || '[]');
        return users.find(user => String(user.account) === String(account) && user.password === password && user.role === role) || null;
    } catch { return null; }
}
