/**
 * UI Module – basic DOM helpers (drawer, auth UI, notifications)
 */

const UI = (() => {
    /** Convert severity code to readable label */
    function getSeverityLabel(severity) {
        const labels = {
            'NO_ALERT': 'Aucune alerte',
            'ALERT_STANDARD': 'Alerte standard',
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

        const infoUpdate = document.getElementById('info-update');
        const infoUpdater = document.getElementById('info-updater');
        const infoUpdateDate = document.getElementById('info-update-date');
        const infoUpdateTime = document.getElementById('info-update-time');

        if (obj?.updated_by && obj?.updated_at) {
            if (infoUpdater) infoUpdater.textContent = obj.updated_by_username || 'Unknown';
            if (infoUpdateTime) infoUpdateTime.textContent = new Date(obj.updated_at).toLocaleString('fr-FR');
            if (infoUpdate) infoUpdate.style.display = 'block';
            if (infoUpdateDate) infoUpdateDate.style.display = 'block';
        } else {
            if (infoUpdate) infoUpdate.style.display = 'none';
            if (infoUpdateDate) infoUpdateDate.style.display = 'none';
        }

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

        // Fetch and display volunteers covering this zone (separated by coverage type)
        const infoVolunteersTotal = document.getElementById('info-volunteers-total');
        const infoVolunteersTotalList = document.getElementById('info-volunteers-total-list');
        const infoVolunteersPartial = document.getElementById('info-volunteers-partial');
        const infoVolunteersPartialList = document.getElementById('info-volunteers-partial-list');
        const infoVolunteersNone = document.getElementById('info-volunteers-none');
        if (obj?.id && infoVolunteersTotal && infoVolunteersTotalList && infoVolunteersPartial && infoVolunteersPartialList && infoVolunteersNone) {
            API.getVolunteersCovering(obj.id)
                .then(res => {
                    const total = (res?.data || []).filter(v => v.coverage_type === 'totale');
                    const partial = (res?.data || []).filter(v => v.coverage_type === 'partielle');

                    if (total.length > 0) {
                        infoVolunteersTotalList.innerHTML = total.map(v =>
                            `<li style="margin-bottom: 4px;">− ${v.username}</li>`
                        ).join('');
                        infoVolunteersTotal.style.display = 'block';
                    } else {
                        infoVolunteersTotal.style.display = 'none';
                    }

                    if (partial.length > 0) {
                        infoVolunteersPartialList.innerHTML = partial.map(v =>
                            `<li style="margin-bottom: 4px;">− ${v.username}</li>`
                        ).join('');
                        infoVolunteersPartial.style.display = 'block';
                    } else {
                        infoVolunteersPartial.style.display = 'none';
                    }

                    // Show "no volunteers" message if neither total nor partial
                    if (total.length === 0 && partial.length === 0) {
                        infoVolunteersNone.style.display = 'block';
                    } else {
                        infoVolunteersNone.style.display = 'none';
                    }
                })
                .catch(err => {
                    console.warn('Failed to fetch volunteers:', err);
                    infoVolunteersTotal.style.display = 'none';
                    infoVolunteersPartial.style.display = 'none';
                    infoVolunteersNone.style.display = 'none';
                });
        }

        openDrawer();
    }

    function openDrawer() {
        const drawer = document.getElementById('drawer');
        if (drawer && drawer.classList) drawer.classList.add('open');
    }
    // Coverage sheet (modal) controls
    function openCoverageSheet() {
        const sheet = document.getElementById('coverage-sheet');
        if (sheet) {
            sheet.style.display = 'flex';
            if (sheet.classList) sheet.classList.add('open');
        }
        // Désactiver le bouton Mes périmètres d'intervention
        const btnCoverage = document.getElementById('btn-coverage');
        if (btnCoverage) btnCoverage.disabled = true;
        // Masquer le bouton Créer une nouvelle zone
        const btnCreate = document.getElementById('btn-create');
        if (btnCreate) btnCreate.style.display = 'none';
    }

    function closeCoverageSheet() {
        const sheet = document.getElementById('coverage-sheet');
        if (sheet) {
            if (sheet.classList) sheet.classList.remove('open');
            sheet.style.display = 'none';
        }
        // Réactiver le bouton Mes périmètres d'intervention
        const btnCoverage = document.getElementById('btn-coverage');
        if (btnCoverage) btnCoverage.disabled = false;
        // Réafficher le bouton Créer une nouvelle zone
        const btnCreate = document.getElementById('btn-create');
        if (btnCreate) btnCreate.style.display = 'inline-block';
    }

    function renderCoverageList(items, onChange) {
        const ul = document.getElementById('coverage-list');
        if (!ul) return;
        if (!items || !items.length) {
            ul.innerHTML = '<li style="color:#666;">Aucun périmètre défini</li>';
            return;
        }
        ul.innerHTML = items.map(i => (
            `<li class="coverage-list-item" data-coverage-id="${i.id}" style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px; border:1px solid #e5e5e5; border-radius:6px; margin-bottom:6px; background:#fafafa; cursor:pointer;">
                <span>Périmètre #${i.id}</span>
                <span class="actions">
                    <button class="btn btn-secondary" data-action="delete" data-id="${i.id}">Supprimer</button>
                </span>
            </li>`
        )).join('');
        // Ajouter l'événement click sur les éléments de la liste pour surbrillance sur la carte
        ul.querySelectorAll('.coverage-list-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Ne pas déclencher si on clique sur le bouton Supprimer
                if (e.target.closest('[data-action="delete"]')) return;
                const id = Number(item.dataset.coverageId);
                if (window.APP && window.APP.highlightCoverageOnMap) {
                    window.APP.highlightCoverageOnMap(id);
                }
                highlightCoverageListItem(id);
            });
        });
        ul.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Empêcher le click de remonter à l'élément parent
                const id = Number(btn.dataset.id);
                try {
                    await API.deleteCoverage(id);
                    const res = await API.listMyCoverage();
                    const data = (res && res.data) || [];
                    renderCoverageList(data, onChange);
                    if (onChange) onChange(data);
                } catch (err) {
                    console.error('Delete coverage failed', err);
                }
            });
        });
    }

    function highlightCoverageListItem(coverageId) {
        // Retirer la surbrillance de tous les éléments
        document.querySelectorAll('.coverage-list-item').forEach(li => {
            li.classList.remove('highlighted');
        });
        // Ajouter la surbrillance à l'élément sélectionné
        if (coverageId) {
            const item = document.querySelector(`[data-coverage-id="${coverageId}"]`);
            if (item) {
                item.classList.add('highlighted');
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                // Retirer la surbrillance après 2 secondes
                setTimeout(() => {
                    item.classList.remove('highlighted');
                }, 2000);
            }
        }
    }

    async function refreshCoverageList() {
        try {
            const res = await API.listMyCoverage();
            renderCoverageList((res && res.data) || []);
        } catch (e) {
            renderCoverageList([]);
        }
    }

    function showDrawerForm(obj = null) {
        const drawerDetails = document.getElementById('drawer-details');
        const drawerForm = document.getElementById('drawer-form');
        const drawerEmpty = document.getElementById('drawer-empty');
        const drawerMetadata = document.getElementById('drawer-metadata');
        const hrVolunteers = document.getElementById('hr-volunteers');
        const hrMetadata = document.getElementById('hr-metadata');
        if (drawerDetails) drawerDetails.style.display = 'none';
        if (drawerForm) drawerForm.style.display = 'block';
        if (drawerEmpty) drawerEmpty.style.display = 'none';
        if (drawerMetadata) drawerMetadata.style.display = 'none';
        if (hrVolunteers) hrVolunteers.style.display = 'none';
        if (hrMetadata) hrMetadata.style.display = 'none';

        const title = document.getElementById('drawer-title');
        if (title) title.textContent = obj ? `Modifier #${obj.id}` : 'Nouvelle zone';

        const formSeverity = document.getElementById('form-severity');
        if (formSeverity) formSeverity.value = obj?.severity || '';

        const formDescription = document.getElementById('form-description');
        if (formDescription) formDescription.value = obj?.description || '';

        updateCharCount();
        openDrawer();
    }

    function updateCharCount() {
        const textarea = document.getElementById('form-description');
        const counter = document.getElementById('char-count');
        if (!textarea || !counter) return;
        const max = Number(textarea.getAttribute('maxlength')) || 1000;
        const len = textarea.value ? textarea.value.length : 0;
        const remaining = Math.max(0, max - len);
        counter.textContent = `${len}/${max} (${remaining} restants)`;
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

    function closeDrawer() {
        const drawer = document.getElementById('drawer');
        if (drawer && drawer.classList) drawer.classList.remove('open');
    }
    async function updateUserDisplay(user) {
        const display = document.getElementById('user-display');
        const btn = document.getElementById('auth-btn');
        const statusInd = document.getElementById('status-indicator');
        const shellContainer = document.getElementById('toolbar-shell-container');

        if (user) {
            if (display) display.textContent = user.username;
            if (btn) {
                btn.textContent = 'Se déconnecter';
                btn.style.display = 'inline-block';
                btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); APP.logout(); };
            }
            if (shellContainer) shellContainer.style.display = 'flex';
            if (statusInd) {
                statusInd.textContent = 'Contributeur';
                statusInd.style.display = 'inline-block';
            }

            // Update toolbar quota panel
            try {
                const q = await API.getMyQuota();
                updateQuotaPanel(q);
            } catch (e) {
                updateQuotaPanel(null);
                console.warn('Failed to load quota', e);
            }
        } else {
            if (display) display.textContent = '';
            if (btn) {
                btn.textContent = 'Se connecter';
                btn.style.display = 'inline-block';
                btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showLoginModal(); };
            }
            if (shellContainer) shellContainer.style.display = 'none';
            if (statusInd) {
                statusInd.textContent = 'Lecture seule';
                statusInd.style.display = 'inline-block';
            }
            updateQuotaPanel(null);
        }
    }

    function updateQuotaPanel(quota) {
        const panel = document.getElementById('toolbar-quota');
        const valuesEl = document.getElementById('toolbar-quota-values');
        const shell = panel?.closest('.toolbar-shell');
        const infoBtn = document.getElementById('quota-info-btn');
        const modal = document.getElementById('quota-modal');
        const modalClose = document.getElementById('quota-modal-close');
        if (!panel || !valuesEl) return;

        const coverageSheet = document.getElementById('coverage-sheet');
        const coverageOpen = !!(coverageSheet && coverageSheet.style.display !== 'none' && coverageSheet.classList.contains('open'));
        if (coverageOpen) {
            // Masquer uniquement, sans vider le contenu pour pouvoir le réafficher hors-ligne
            panel.style.display = 'none';
            if (shell) shell.style.display = 'none';
            return;
        }

        if (!quota) {
            panel.style.display = 'none';
            valuesEl.textContent = '';
            if (shell) shell.style.display = 'none';
            return;
        }

        const c = quota.create;
        const u = quota.update;
        const d = quota.delete;

        valuesEl.innerHTML = `
            <div class="quota-line">
                <span class="quota-left"><span class="quota-icon">✏️</span><span>Création</span></span>
                <span class="quota-count">${c.used}/${c.limit}</span>
            </div>
            <div class="quota-line">
                <span class="quota-left"><span class="quota-icon">🔄</span><span>Modification</span></span>
                <span class="quota-count">${u.used}/${u.limit}</span>
            </div>
            <div class="quota-line">
                <span class="quota-left"><span class="quota-icon">🗑️</span><span>Suppression</span></span>
                <span class="quota-count">${d.used}/${d.limit}</span>
            </div>
        `;
        panel.style.display = 'flex';
        if (shell) shell.style.display = 'flex';

        // Attach info modal handlers once
        if (infoBtn && modal && !infoBtn._handlersBound) {
            infoBtn._handlersBound = true;
            infoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isShown = modal.style.display === 'flex';
                modal.style.display = isShown ? 'none' : 'flex';
                const body = modal.querySelector('.modal-body');
                if (body) {
                    body.innerHTML = `
                        <p>Vous disposez d’un nombre limité de créations, modifications et suppressions par jour.</p>
                        <p>Une fois la limite atteinte, l’opération concernée est bloquée jusqu’au lendemain.</p>
                    `;
                }
            });
            // Close button
            if (modalClose) {
                modalClose.addEventListener('click', () => { modal.style.display = 'none'; });
            }
            // Hide on outside click (backdrop)
            document.addEventListener('click', (e) => {
                if (!modal || modal.style.display !== 'flex') return;
                const content = modal.querySelector('.modal-content');
                const within = content.contains(e.target) || infoBtn.contains(e.target);
                if (!within) modal.style.display = 'none';
            });
            // Escape key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
                    modal.style.display = 'none';
                }
            });
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

    function openDangerHelpModal() {
        const modal = document.getElementById('danger-help-modal');
        if (modal) modal.style.display = 'flex';
    }

    function closeDangerHelpModal() {
        const modal = document.getElementById('danger-help-modal');
        if (modal) modal.style.display = 'none';
    }

    return {
        showDrawerDetails,
        showDrawerForm,
        showDrawerEmpty,
        openDrawer,
        openCoverageSheet,
        closeCoverageSheet,
        renderCoverageList,
        refreshCoverageList,
        highlightCoverageListItem,
        closeDrawer,
        updateUserDisplay,
        updateQuotaPanel,
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
        openDangerHelpModal,
        closeDangerHelpModal
    };
})();
