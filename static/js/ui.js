/**
 * UI Module – basic DOM helpers (drawer, auth UI, notifications)
 */

const UI = (() => {
    /** Convert severity code to readable label */
    function getSeverityLabel(severity) {
        const labels = {
            'SAFE': "Pas d'alerte",
            'LOW_RISK': 'Danger faible',
            'RISK': 'Danger significatif',
            'HIGH_RISK': 'Danger sérieux',
            'CRITICAL': 'Danger vital',
        };
        return labels[severity] || severity || '—';
    }

    function showDrawerDetails(obj) {
        const drawerDetails = document.getElementById('drawer-details');
        const drawerForm = document.getElementById('drawer-form');
        const drawerEmpty = document.getElementById('drawer-empty');
        if (drawerDetails) drawerDetails.style.display = 'block';
        if (drawerForm) drawerForm.style.display = 'none';
        if (drawerEmpty) drawerEmpty.style.display = 'none';

        const title = document.getElementById('drawer-title');
        if (title) title.textContent = `Zone #${obj?.id ?? ''}`;

        const infoSeverity = document.getElementById('info-severity');
        if (infoSeverity) infoSeverity.textContent = getSeverityLabel(obj?.severity);

        const infoDescription = document.getElementById('info-description');
        if (infoDescription) infoDescription.textContent = obj?.description || '(aucune description)';

        const infoAuthor = document.getElementById('info-author');
        if (infoAuthor) infoAuthor.textContent = obj?.created_by_username || 'Unknown';

        const infoDate = document.getElementById('info-date');
        if (infoDate && obj?.created_at) infoDate.textContent = new Date(obj.created_at).toLocaleString('fr-FR');

        const lockInfo = document.getElementById('lock-info');
        if (lockInfo) {
            if (obj?.locked_by) {
                lockInfo.style.display = 'block';
                const lockMsg = document.getElementById('lock-message');
                if (lockMsg && obj.lock_expires_at) {
                    const expires = new Date(obj.lock_expires_at).toLocaleTimeString('fr-FR');
                    lockMsg.textContent = `⚠️ Modifié par ${obj.locked_by_username} jusqu'à ${expires}`;
                }
            } else {
                lockInfo.style.display = 'none';
            }
        }

        openDrawer();
    }

    function showDrawerForm(obj = null) {
        const drawerDetails = document.getElementById('drawer-details');
        const drawerForm = document.getElementById('drawer-form');
        const drawerEmpty = document.getElementById('drawer-empty');
        if (drawerDetails) drawerDetails.style.display = 'none';
        if (drawerForm) drawerForm.style.display = 'block';
        if (drawerEmpty) drawerEmpty.style.display = 'none';

        const title = document.getElementById('drawer-title');
        if (title) title.textContent = obj ? `Modifier #${obj.id}` : 'Nouvelle zone';

        const formSeverity = document.getElementById('form-severity');
        if (formSeverity) formSeverity.value = obj?.severity || '';

        const formDescription = document.getElementById('form-description');
        if (formDescription) formDescription.value = obj?.description || '';

        updateCharCount();
        openDrawer();
    }

    function showDrawerEmpty() {
        const drawerDetails = document.getElementById('drawer-details');
        const drawerForm = document.getElementById('drawer-form');
        const drawerEmpty = document.getElementById('drawer-empty');
        if (drawerDetails) drawerDetails.style.display = 'none';
        if (drawerForm) drawerForm.style.display = 'none';
        if (drawerEmpty) drawerEmpty.style.display = 'block';
        closeDrawer();
    }

    function openDrawer() {
        const drawer = document.getElementById('drawer');
        if (drawer && drawer.classList) drawer.classList.add('open');
    }

    function closeDrawer() {
        const drawer = document.getElementById('drawer');
        if (drawer && drawer.classList) drawer.classList.remove('open');
    }

    function updateCharCount() {
        const textarea = document.getElementById('form-description');
        const counter = document.getElementById('char-count');
        if (textarea && counter) {
            counter.textContent = `${textarea.value.length}/500`;
        }
    }

    function updateUserDisplay(user) {
        const display = document.getElementById('user-display');
        const btn = document.getElementById('auth-btn');
        const statusInd = document.getElementById('status-indicator');

        if (user) {
            if (display) display.textContent = user.username;
            if (btn) {
                btn.textContent = 'Se déconnecter';
                btn.style.display = 'inline-block';
                btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); APP.logout(); };
            }
            if (statusInd) {
                statusInd.textContent = 'Contributeur';
                statusInd.style.display = 'inline-block';
            }
        } else {
            if (display) display.textContent = '';
            if (btn) {
                btn.textContent = 'Se connecter';
                btn.style.display = 'inline-block';
                btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showLoginModal(); };
            }
            if (statusInd) {
                statusInd.textContent = 'Lecture seule';
                statusInd.style.display = 'inline-block';
            }
        }
    }

    function notify(msg, type = 'info', duration = 3000) {
        const notif = document.getElementById('notification');
        if (!notif) return;
        notif.textContent = msg;
        notif.className = `notification notification-${type}`;
        notif.style.display = 'block';
        setTimeout(() => { notif.style.display = 'none'; }, duration);
    }

    function confirm(title, message) {
        return new Promise((resolve) => {
            const dialog = document.getElementById('confirm-dialog');
            const titleEl = document.getElementById('confirm-title');
            const msgEl = document.getElementById('confirm-message');
            const yesBtn = document.getElementById('btn-confirm-yes');
            const noBtn = document.getElementById('btn-confirm-no');
            const map = document.getElementById('map');

            if (!dialog || !titleEl || !msgEl || !yesBtn || !noBtn) {
                resolve(window.confirm(`${title}\n${message}`));
                return;
            }

            let settled = false;
            const cleanup = (result) => {
                if (settled) return;
                settled = true;
                dialog.style.display = 'none';
                dialog.style.pointerEvents = 'auto';
                if (map) map.style.pointerEvents = 'auto';
                document.removeEventListener('keydown', onKeyDown);
                dialog.removeEventListener('click', onOverlayClick);
                yesBtn.removeEventListener('click', onYes);
                noBtn.removeEventListener('click', onNo);
                resolve(result);
            };

            const onYes = (e) => { e.preventDefault(); cleanup(true); };
            const onNo = (e) => { e.preventDefault(); cleanup(false); };
            const onOverlayClick = (e) => { if (e.target === dialog) cleanup(false); };
            const onKeyDown = (e) => {
                if (e.key === 'Escape') cleanup(false);
                if (e.key === 'Enter') cleanup(true);
            };

            titleEl.textContent = title;
            msgEl.textContent = message;
            dialog.style.display = 'flex';
            dialog.style.pointerEvents = 'auto';
            if (map) map.style.pointerEvents = 'none';

            yesBtn.addEventListener('click', onYes);
            noBtn.addEventListener('click', onNo);
            dialog.addEventListener('click', onOverlayClick);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    function updateDrawStatus(msg) {
        const el = document.getElementById('toolbar-status');
        if (!el) return;
        el.textContent = msg || '';
        el.style.display = msg ? 'inline-block' : 'none';
    }

    function showSaveCancel() {
        const btnSave = document.getElementById('btn-save');
        const btnCancel = document.getElementById('btn-cancel');
        if (btnSave) btnSave.style.display = 'inline-block';
        if (btnCancel) btnCancel.style.display = 'inline-block';
    }

    function hideSaveCancel() {
        const btnSave = document.getElementById('btn-save');
        const btnCancel = document.getElementById('btn-cancel');
        if (btnSave) btnSave.style.display = 'none';
        if (btnCancel) btnCancel.style.display = 'none';
    }

    function showLockBadge() {
        const badge = document.getElementById('lock-badge');
        if (badge) badge.style.display = 'inline-block';
    }

    function hideLockBadge() {
        const badge = document.getElementById('lock-badge');
        if (badge) badge.style.display = 'none';
    }

    function showLoginModal() {
        const modal = document.getElementById('login-modal');
        const map = document.getElementById('map');
        if (modal) {
            modal.style.display = 'flex';
            modal.style.pointerEvents = 'auto';
        }
        if (map) map.style.pointerEvents = 'none';
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        if (loginForm) loginForm.style.display = 'block';
        if (registerForm) registerForm.style.display = 'none';
        const authMsg = document.getElementById('auth-message');
        if (authMsg) authMsg.style.display = 'none';
        const userEl = document.getElementById('login-username');
        if (userEl) userEl.focus();
    }

    function hideLoginModal() {
        const modal = document.getElementById('login-modal');
        const map = document.getElementById('map');
        if (modal) {
            modal.style.display = 'none';
            modal.style.pointerEvents = 'auto';
        }
        if (map) map.style.pointerEvents = 'auto';
        const authMsg = document.getElementById('auth-message');
        if (authMsg) authMsg.style.display = 'none';
    }

    function showAuthMessage(msg, isError = false) {
        // L'alerte inline est désormais inutilisée; on s'appuie sur le toast + shake.
        const el = document.getElementById('auth-message');
        if (el) {
            el.style.display = 'none';
        }

        if (isError) {
            notify(msg || 'Erreur', 'error');
            const modalContent = document.querySelector('#login-modal .modal-content');
            if (modalContent) {
                modalContent.classList.remove('shake');
                void modalContent.offsetWidth;
                modalContent.classList.add('shake');
            }
        } else if (msg) {
            notify(msg, 'info');
        }
    }

    return {
        showDrawerDetails,
        showDrawerForm,
        showDrawerEmpty,
        closeDrawer,
        updateUserDisplay,
        notify,
        confirm,
        updateDrawStatus,
        showSaveCancel,
        hideSaveCancel,
        showLockBadge,
        hideLockBadge,
        showLoginModal,
        hideLoginModal,
        showAuthMessage,
        updateCharCount,
    };
})();
