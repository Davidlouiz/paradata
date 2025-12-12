/**
 * UI Module – Manage interface: drawer, toolbar, modals, notifications
 */

const UI = {
    selectedObjectId: null,
    isEditMode: false,

    // ========== Drawer ==========

    showDrawerDetails(obj) {
        document.getElementById('drawer-details').style.display = 'block';
        document.getElementById('drawer-form').style.display = 'none';
        document.getElementById('drawer-empty').style.display = 'none';
        document.getElementById('drawer-title').textContent = `Objet #${obj.id}`;

        document.getElementById('info-id').textContent = obj.id;
        document.getElementById('info-danger-type').textContent = obj.danger_type_id || '—';
        document.getElementById('info-severity').textContent = `${obj.severity}`;
        document.getElementById('info-description').textContent = obj.description || '(aucune description)';
        document.getElementById('info-author').textContent = obj.created_by_username || 'Unknown';
        document.getElementById('info-date').textContent = new Date(obj.created_at).toLocaleString('fr-FR');

        // Show lock info if locked
        const lockInfo = document.getElementById('lock-info');
        if (obj.lock && obj.lock.locked_by) {
            lockInfo.style.display = 'block';
            const expires = new Date(obj.lock.lock_expires_at);
            document.getElementById('lock-message').textContent =
                `⚠️ Édité par ${obj.lock.locked_by_username} jusqu'à ${expires.toLocaleTimeString('fr-FR')}`;
        } else {
            lockInfo.style.display = 'none';
        }

        document.getElementById('drawer').classList.add('open');
        this.selectedObjectId = obj.id;
        this.updateToolbar();
    },

    showDrawerForm(obj = null) {
        document.getElementById('drawer-details').style.display = 'none';
        document.getElementById('drawer-form').style.display = 'block';
        document.getElementById('drawer-empty').style.display = 'none';

        if (obj) {
            document.getElementById('drawer-title').textContent = `Éditer #${obj.id}`;
            document.getElementById('form-danger-type').value = obj.danger_type_id;
            document.getElementById('form-severity').value = obj.severity;
            document.getElementById('form-description').value = obj.description || '';
        } else {
            document.getElementById('drawer-title').textContent = 'Nouveau polygone';
            document.getElementById('form-danger-type').value = '';
            document.getElementById('form-severity').value = '';
            document.getElementById('form-description').value = '';
        }

        this.updateCharCount();
        document.getElementById('drawer').classList.add('open');
        this.isEditMode = true;
    },

    showDrawerEmpty() {
        document.getElementById('drawer-details').style.display = 'none';
        document.getElementById('drawer-form').style.display = 'none';
        document.getElementById('drawer-empty').style.display = 'block';
        document.getElementById('drawer-title').textContent = 'Détails';
        document.getElementById('drawer').classList.remove('open');
        this.selectedObjectId = null;
        this.updateToolbar();
    },

    closeDrawer() {
        document.getElementById('drawer').classList.remove('open');
        this.selectedObjectId = null;
        this.isEditMode = false;
        this.updateToolbar();
    },

    updateCharCount() {
        const textarea = document.getElementById('form-description');
        const count = textarea.value.length;
        document.getElementById('char-count').textContent = `${count}/500`;
    },

    // ========== Toolbar ==========

    updateToolbar() {
        const isAuthenticated = !!APP.currentUser;
        const hasSelection = this.selectedObjectId !== null;
        const isEditMode = this.isEditMode;

        document.getElementById('toolbar').style.display = isAuthenticated ? 'flex' : 'none';
        document.getElementById('btn-edit').disabled = !hasSelection || (hasSelection && this.isDrawing);
        document.getElementById('btn-delete').disabled = !hasSelection;
    },

    showToolbarStatus(msg) {
        document.getElementById('toolbar-status').textContent = msg;
    },

    // ========== Authentication UI ==========

    showLoginModal() {
        document.getElementById('login-modal').style.display = 'flex';
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('auth-message').style.display = 'none';
        // focus username
        const userEl = document.getElementById('login-username');
        if (userEl) userEl.focus();
    },

    hideLoginModal() {
        document.getElementById('login-modal').style.display = 'none';
        document.getElementById('auth-message').style.display = 'none';
    },

    showAuthMessage(msg, isError = false) {
        const el = document.getElementById('auth-message');
        el.textContent = msg;
        el.className = `alert ${isError ? 'alert-error' : 'alert-success'}`;
        el.style.display = 'block';
    },

    shakeAuthModal() {
        const content = document.querySelector('#login-modal .modal-content');
        if (!content) return;
        content.classList.remove('shake');
        // Force reflow
        // eslint-disable-next-line no-unused-expressions
        content.offsetWidth;
        content.classList.add('shake');
        setTimeout(() => content.classList.remove('shake'), 700);
    },

    updateUserDisplay(user) {
        const display = document.getElementById('user-display');
        const btn = document.getElementById('auth-btn');

        if (user) {
            display.textContent = user.username;
            btn.textContent = 'Déconnexion';
            btn.onclick = () => {
                console.log('Logout clicked');
                APP.logout();
            };
            document.getElementById('status-indicator').textContent = 'Contributeur';
        } else {
            display.textContent = '';
            btn.textContent = 'Se connecter';
            btn.onclick = () => {
                console.log('Show login modal clicked');
                UI.showLoginModal();
            };
            document.getElementById('status-indicator').textContent = 'Lecture seule';
        }
    },

    // ========== Notifications ==========

    notify(msg, type = 'info', duration = 3000) {
        const notif = document.getElementById('notification');
        notif.textContent = msg;
        notif.className = `notification notification-${type}`;
        notif.style.display = 'block';

        setTimeout(() => {
            notif.style.display = 'none';
        }, duration);
    },

    // ========== Confirmation Dialog ==========

    async confirm(title, message) {
        return new Promise((resolve) => {
            document.getElementById('confirm-title').textContent = title;
            document.getElementById('confirm-message').textContent = message;
            document.getElementById('confirm-dialog').style.display = 'flex';

            const cleanup = () => {
                document.getElementById('confirm-dialog').style.display = 'none';
                document.getElementById('btn-confirm-yes').onclick = null;
                document.getElementById('btn-confirm-no').onclick = null;
            };

            document.getElementById('btn-confirm-yes').onclick = () => {
                cleanup();
                resolve(true);
            };

            document.getElementById('btn-confirm-no').onclick = () => {
                cleanup();
                resolve(false);
            };
        });
    },
};

// ========== Event Handlers ==========

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, setting up event listeners');

    // Close drawer
    const closeBtn = document.getElementById('btn-close-drawer');
    if (closeBtn) closeBtn.onclick = () => UI.closeDrawer();

    // Close auth modal button
    const closeAuthBtn = document.getElementById('btn-close-auth');
    if (closeAuthBtn) closeAuthBtn.onclick = () => UI.hideLoginModal();

    // Clicking outside modal-content closes the auth modal
    const loginModal = document.getElementById('login-modal');
    if (loginModal) {
        loginModal.addEventListener('click', (e) => {
            if (e.target === loginModal) {
                UI.hideLoginModal();
            }
        });
    }

    // Form input handlers
    const descInput = document.getElementById('form-description');
    if (descInput) descInput.addEventListener('input', () => UI.updateCharCount());

    // Toggle auth forms
    const toggleRegBtn = document.getElementById('btn-toggle-register');
    if (toggleRegBtn) {
        toggleRegBtn.onclick = (e) => {
            e.preventDefault();
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('register-form').style.display = 'block';
        };
    }

    const toggleLoginBtn = document.getElementById('btn-toggle-login');
    if (toggleLoginBtn) {
        toggleLoginBtn.onclick = (e) => {
            e.preventDefault();
            document.getElementById('login-form').style.display = 'block';
            document.getElementById('register-form').style.display = 'none';
        };
    }

    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            console.log('Login form submitted');
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;

            try {
                await APP.login(username, password);
                UI.hideLoginModal();
                loginForm.reset();
            } catch (err) {
                console.error('Login error:', err);
                const msg = err && err.message ? err.message : 'Erreur inconnue';
                UI.notify(`Connexion échouée: ${msg}`, 'error');
                UI.shakeAuthModal();
                // focus username for retry
                const userEl = document.getElementById('login-username');
                if (userEl) userEl.focus();
            }
        };
    } else {
        console.warn('Login form not found');
    }

    // Register form
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.onsubmit = async (e) => {
            e.preventDefault();
            console.log('Register form submitted');
            const username = document.getElementById('register-username').value;
            const password = document.getElementById('register-password').value;
            const confirm = document.getElementById('register-password-confirm').value;

            if (password !== confirm) {
                UI.showAuthMessage('Les mots de passe ne correspondent pas', true);
                return;
            }

            try {
                await APP.register(username, password);
                UI.hideLoginModal();
                registerForm.reset();
            } catch (err) {
                console.error('Register error:', err);
                UI.showAuthMessage(`Erreur: ${err.message}`, true);
            }
        };
    } else {
        console.warn('Register form not found');
    }

    // Close modal with Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const lm = document.getElementById('login-modal');
            if (lm && lm.style.display === 'flex') UI.hideLoginModal();
        }
    });

    console.log('Event listeners setup complete');
});
