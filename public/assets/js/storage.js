/* 仅保存登录态和界面偏好，不保存业务数据。 */
const Storage = {
    getCurrentUser() {
        const value = localStorage.getItem('cas_current_user');
        try { return value ? JSON.parse(value) : null; } catch { return null; }
    },
    setCurrentUser(user) { localStorage.setItem('cas_current_user', JSON.stringify(user)); },
    clearCurrentUser() { localStorage.removeItem('cas_current_user'); },
    getRemembered() {
        const value = localStorage.getItem('cas_remember');
        try { return value ? JSON.parse(value) : null; } catch { return null; }
    },
    setRemembered(data) { localStorage.setItem('cas_remember', JSON.stringify(data)); },
    clearRemembered() { localStorage.removeItem('cas_remember'); }
};
