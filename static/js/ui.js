/**
 * UI Module – Manage interface: drawer, toolbar, modals, notifications
 */

const UI = (() => {
    /**
     * Convertir le code de sévérité interne en label lisible
     */
    function getSeverityLabel(severity) {
        const labels = {
            'SAFE': 'Pas d\'alerte',
            'LOW_RISK': 'Danger faible',
            'RISK': 'Danger significatif',
            'HIGH_RISK': 'Danger sérieux',
            'CRITICAL': 'Danger vital',
        };
        return labels[severity] || severity;
    }

    /**
     * Afficher le panneau de détails (lecture seule)
     */
    function showDrawerDetails(obj) {
        document.getElementById('drawer-details').style.display = 'block';
        document.getElementById('drawer-form').style.display = 'none';
        document.getElementById('drawer-empty').style.display = 'none';
        document.getElementById('drawer-title').textContent = `Zone #${obj.id}`;

        document.getElementById('info-severity').textContent = getSeverityLabel(obj.severity) || '—';
        document.getElementById('info-description').textContent = obj.description || '(aucune description)';
        document.getElementById('info-author').textContent = obj.created_by_username || 'Unknown';
        document.getElementById('info-date').textContent = new Date(obj.created_at).toLocaleString('fr-FR');

        // Afficher les infos de verrou si verrouillé
        const lockInfo = document.getElementById('lock-info');
        if (obj.locked_by) {
            lockInfo.style.display = 'block';
            const expires = new Date(obj.lock_expires_at);
            document.getElementById('lock-message').textContent =
                `⚠️ Modifié par ${obj.locked_by_username} jusqu'à ${expires.toLocaleTimeString('fr-FR')}`;
        } else {
            lockInfo.style.display = 'none';
        }

        document.getElementById('drawer').classList.add('open');
    }

    /**
     * Afficher le formulaire d'édition/création
     */
    function showDrawerForm(obj = null) {
        document.getElementById('drawer-details').style.display = 'none';
        document.getElementById('drawer-form').style.display = 'block';
        document.getElementById('drawer-empty').style.display = 'none';

        if (obj) {
            document.getElementById('drawer-title').textContent = `Modifier #${obj.id}`;
            document.getElementById('form-severity').value = obj.severity || '';
            document.getElementById('form-description').value = obj.description || '';
        } else {
            document.getElementById('drawer-title').textContent = 'Nouvelle zone';
            document.getElementById('form-severity').value = '';
            document.getElementById('form-description').value = '';
        }

        updateCharCount();
        document.getElementById('drawer').classList.add('open');
    }

    /**
     * Afficher le panneau vide (pas de sélection)
     */
    function showDrawerEmpty() {
        document.getElementById('drawer-details').style.display = 'none';
        document.getElementById('drawer-form').style.display = 'none';
        document.getElementById('drawer-empty').style.display = 'block';
        document.getElementById('drawer-title').textContent = 'Détails';
        document.getElementById('drawer').classList.remove('open');
    }

    /**
     * Fermer le drawer
     */
    function closeDrawer() {
        document.getElementById('drawer').classList.remove('open');
    }

    /**
     * Mettre à jour le compteur de caractères
     */
    function updateCharCount() {
        const textarea = document.getElementById('form-description');
        const count = textarea.value.length;
        document.getElementById('char-count').textContent = `${count}/500`;
    }

    /**
     * Afficher un message dans la barre d'outils
     */
    function showToolbarStatus(msg) {
        document.getElementById('toolbar-status').textContent = msg;
    }

    /**
     * Afficher la modal de connexion
     */
    function showLoginModal() {
        const modal = document.getElementById('login-modal');
        modal.style.display = 'flex';
        modal.style.pointerEvents = 'auto';
        document.getElementById('map').style.pointerEvents = 'none';
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('auth-message').style.display = 'none';
        const userEl = document.getElementById('login-username');
        if (userEl) userEl.focus();
    }
    /**
     * Masquer la modal de connexion
     */
    function hideLoginModal() {
        const modal = document.getElementById('login-modal');
        modal.style.display = 'none';
        modal.style.pointerEvents = 'auto';
        document.getElementById('map').style.pointerEvents = 'auto';
        document.getElementById('auth-message').style.display = 'none';
    }

    /**
     * Afficher un message d'authentification
     */
    function showAuthMessage(msg, isError = false) {
        const el = document.getElementById('auth-message');
        el.textContent = msg;
        el.className = `alert ${isError ? 'alert-error' : 'alert-success'}`;
        el.style.display = 'block';
    }

    /**
     * Animer la modal d'auth (shake)
     */
    function shakeAuthModal() {
        const content = document.querySelector('#login-modal .modal-content');
        if (!content) return;
        content.classList.remove('shake');
        content.offsetWidth; // Force reflow
        content.classList.add('shake');
        setTimeout(() => content.classList.remove('shake'), 700);
    }

    /**
     * Mettre à jour l'affichage de l'utilisateur
     */
    function updateUserDisplay(user) {
        const display = document.getElementById('user-display');
        const btn = document.getElementById('auth-btn');

        if (!btn) {
            console.warn('Auth button not found in DOM');
            return;
        }

        // Store reference to avoid nested closures
        let handleAuthBtnClick = null;

        if (user) {
            if (display) display.textContent = user.username;
            btn.textContent = 'Déconnexion';
            handleAuthBtnClick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Logout clicked');
                APP.logout();
            };
            const statusInd = document.getElementById('status-indicator');
            if (statusInd) statusInd.textContent = 'Contributeur';
        } else {
            if (display) display.textContent = '';
            btn.textContent = 'Se connecter';
            handleAuthBtnClick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Show login modal clicked');
                UI.showLoginModal();
            };
            const statusInd = document.getElementById('status-indicator');
            if (statusInd) statusInd.textContent = 'Lecture seule';
        }

        // Always attach the listener (remove old ones first to prevent duplicates)
        btn.removeEventListener('click', btn._authHandler);
        btn._authHandler = handleAuthBtnClick;
        btn.addEventListener('click', handleAuthBtnClick);
    }

    /**
     * Afficher une notification (toast)
     */
    function notify(msg, type = 'info', duration = 3000) {
        const notif = document.getElementById('notification');
        notif.textContent = msg;
        notif.className = `notification notification-${type}`;
        notif.style.display = 'block';

        setTimeout(() => {
            notif.style.display = 'none';
        }, duration);
    }

    /**
     * Afficher une boîte de confirmation et retourner la réponse
     */
    async function confirm(title, message) {
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
    }

    /**
     * Mettre à jour le statut du dessin
     */
    function updateDrawStatus(msg) {
        const el = document.getElementById('toolbar-status');
        if (!el) return;

        el.textContent = msg || '';
        el.style.display = msg ? 'inline-block' : 'none';
    }

    /**
    * Afficher le badge "Modification en cours"
     */
    function showLockBadge(expirySeconds) {
        // Si pas de valeur ou temps écoulé, cacher le badge pour éviter "expiré" dès le début
        if (expirySeconds === null || expirySeconds === undefined || expirySeconds <= 0) {
            hideLockBadge();
            return;
        }

        let badge = document.getElementById('lock-badge');
        if (!badge) {
            const container = document.querySelector('.drawer-header');
            badge = document.createElement('span');
            badge.id = 'lock-badge';
            badge.className = 'lock-badge';
            container.appendChild(badge);
        }

        // Afficher "expiré" plutôt que 0s pour éviter la confusion
        badge.textContent = `🔒 Modification en cours (${expirySeconds}s)`;
        badge.style.display = 'block';
    }

    /**
    * Masquer le badge de modification
     */
    function hideLockBadge() {
        const badge = document.getElementById('lock-badge');
        if (badge) badge.style.display = 'none';
    }

    /**
     * Afficher les boutons Enregistrer/Annuler
     */
    function showSaveCancel() {
        document.getElementById('btn-save').style.display = 'inline-block';
        document.getElementById('btn-cancel').style.display = 'inline-block';
    }

    /**
     * Masquer les boutons Enregistrer/Annuler
     */
    function hideSaveCancel() {
        document.getElementById('btn-save').style.display = 'none';
        document.getElementById('btn-cancel').style.display = 'none';
    }

    return {
        showDrawerDetails,
        showDrawerForm,
        showDrawerEmpty,
        closeDrawer,
        updateCharCount,
        showToolbarStatus,
        showLoginModal,
        hideLoginModal,
        showAuthMessage,
        shakeAuthModal,
        updateUserDisplay,
        notify,
        confirm,
        updateDrawStatus,
        showLockBadge,
        hideLockBadge,
        showSaveCancel,
        hideSaveCancel,
    };
})();

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
            const confirm_val = document.getElementById('register-password-confirm').value;

            if (password !== confirm_val) {
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
