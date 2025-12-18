/**
 * UI Module – basic DOM helpers (drawer, auth UI, notifications)
 */

const UI = (() => {
    let zoneTypes = [];
    /** Afficher/masquer le panneau des plafonds (et son shell) */
    function setQuotaPanelVisible(visible) {
        const panel = document.getElementById('toolbar-quota');
        const shell = panel?.closest('.toolbar-shell');
        if (!panel) return;
        panel.style.display = visible ? 'flex' : 'none';
        if (shell) shell.style.display = visible ? 'flex' : 'none';
    }
    /** Convert zone_type code to readable label */
    function getZoneTypeLabel(zone_type) {
        const found = zoneTypes.find(t => t.code === zone_type);
        if (found) return found.name;
        return zone_type || '—';
    }

    /** Get zone type description (if available) */
    function getZoneTypeDescription(zone_type) {
        const found = zoneTypes.find(t => t.code === zone_type);
        return found?.description || '';
    }

    /** Inject zone types and refresh select options */
    function setZoneTypes(types) {
        zoneTypes = Array.isArray(types) ? [...types] : [];
        populateZoneTypeOptions();
        updateZoneTypeDescription(document.getElementById('form-zone-type')?.value);
    }

    function populateZoneTypeOptions(selectedValue) {
        const select = document.getElementById('form-zone-type');
        if (!select) return;
        const targetValue = selectedValue !== undefined ? selectedValue : select.value;
        select.innerHTML = '';

        if (zoneTypes.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Aucun type disponible';
            select.appendChild(opt);
            select.value = '';
            return;
        }

        // Ajouter une option vide par défaut
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '-- Sélectionner un type --';
        select.appendChild(emptyOpt);

        zoneTypes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.code;
            opt.textContent = t.name;
            select.appendChild(opt);
        });

        if (targetValue) {
            select.value = targetValue;
        }
        // Ne pas présélectionner automatiquement si aucune valeur n'est fournie
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

        const infoZoneType = document.getElementById('info-zone-type');
        if (infoZoneType) infoZoneType.textContent = getZoneTypeLabel(obj?.zone_type);

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

        // Affichages de volontaires supprimés
        const drawerFooter = document.querySelector('.drawer-footer');

        openDrawer();

        if (drawerFooter) drawerFooter.style.display = 'flex';
    }

    function openDrawer() {
        const drawer = document.getElementById('drawer');
        if (drawer && drawer.classList) drawer.classList.add('open');
    }
    // Feuille de périmètres supprimée

    function showDrawerForm(obj = null) {
        const drawerDetails = document.getElementById('drawer-details');
        const drawerForm = document.getElementById('drawer-form');
        const drawerEmpty = document.getElementById('drawer-empty');
        const drawerMetadata = document.getElementById('drawer-metadata');
        const hrVolunteers = document.getElementById('hr-volunteers');
        const hrMetadata = document.getElementById('hr-metadata');
        const infoVolunteersTotal = document.getElementById('info-volunteers-total');
        const infoVolunteersPartial = document.getElementById('info-volunteers-partial');
        const infoVolunteersNone = document.getElementById('info-volunteers-none');
        const drawerFooter = document.querySelector('.drawer-footer');
        if (drawerDetails) drawerDetails.style.display = 'none';
        if (drawerForm) drawerForm.style.display = 'block';
        if (drawerEmpty) drawerEmpty.style.display = 'none';
        if (drawerMetadata) drawerMetadata.style.display = 'none';
        if (hrVolunteers) hrVolunteers.style.display = 'none';
        if (hrMetadata) hrMetadata.style.display = 'none';
        if (infoVolunteersTotal) infoVolunteersTotal.style.display = 'none';
        if (infoVolunteersPartial) infoVolunteersPartial.style.display = 'none';
        if (infoVolunteersNone) infoVolunteersNone.style.display = 'none';
        if (drawerFooter) drawerFooter.style.display = obj ? 'flex' : 'none';

        const title = document.getElementById('drawer-title');
        if (title) title.textContent = obj ? `Modifier #${obj.id}` : 'Nouvelle zone';

        const formZoneType = document.getElementById('form-zone-type');
        if (formZoneType) {
            populateZoneTypeOptions(obj?.zone_type || '');
            formZoneType.value = obj?.zone_type || formZoneType.value;
            updateZoneTypeDescription(formZoneType.value);
        }

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

        if (!quota) {
            // Masquer si pas de données
            setQuotaPanelVisible(false);
            valuesEl.textContent = '';
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
        // Ne pas forcer l'affichage ici; l'app gère via la touche Q

        // Attach info modal handlers once
        if (infoBtn && modal && !infoBtn._handlersBound) {
            infoBtn._handlersBound = true;
            infoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isShown = modal.style.display === 'flex';
                modal.style.display = isShown ? 'none' : 'flex';
                if (window.APP?.applyQuotaVisibility) {
                    window.APP.applyQuotaVisibility();
                }
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
                modalClose.addEventListener('click', () => {
                    modal.style.display = 'none';
                    if (window.APP?.applyQuotaVisibility) {
                        window.APP.applyQuotaVisibility();
                    }
                });
            }
            // Hide on outside click (backdrop)
            document.addEventListener('click', (e) => {
                if (!modal || modal.style.display !== 'flex') return;
                const content = modal.querySelector('.modal-content');
                const within = content.contains(e.target) || infoBtn.contains(e.target);
                if (!within) {
                    modal.style.display = 'none';
                    if (window.APP?.applyQuotaVisibility) {
                        window.APP.applyQuotaVisibility();
                    }
                }
            });
            // Escape key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
                    modal.style.display = 'none';
                    if (window.APP?.applyQuotaVisibility) {
                        window.APP.applyQuotaVisibility();
                    }
                }
            });
        }
    }

    // Initialize zone types modal handlers
    {
        const link = document.getElementById('zone-types-manage-link');
        const modal = document.getElementById('zone-types-modal');
        const modalClose = document.getElementById('zone-types-modal-close');
        const addBtn = document.getElementById('zone-type-add-btn');
        let preventCloseUntil = 0;
        if (link && modal) {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showZoneTypesModal();
            });
            if (modalClose) {
                modalClose.addEventListener('click', () => {
                    hideZoneTypesModal();
                });
            }
            if (addBtn) {
                addBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showAddZoneTypeInlineForm();
                });
            }
            // Close modal when clicking outside
            document.addEventListener('click', (e) => {
                if (!modal || modal.style.display !== 'flex') return;
                // Don't close if confirmation dialog is open
                const confirmDialog = document.getElementById('confirm-dialog');
                if (confirmDialog && confirmDialog.style.display === 'flex') return;
                // Don't close right after confirmation closes
                if (Date.now() < preventCloseUntil) return;
                const content = modal.querySelector('.modal-content');
                const within = content.contains(e.target) || link.contains(e.target);
                if (!within) {
                    hideZoneTypesModal();
                }
            });
            // Close with Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
                    hideZoneTypesModal();
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
        const el = document.getElementById('auth-message');
        if (el) {
            el.style.display = 'none';
        }

        if (msg) {
            notify(msg, isError ? 'error' : 'info');
        }

        if (isError) {
            const modalContent = document.querySelector('#login-modal .modal-content');
            if (modalContent) {
                modalContent.classList.remove('shake');
                void modalContent.offsetWidth;
                modalContent.classList.add('shake');
            }
        }
    }

    function updateZoneTypeDescription(selectedCode) {
        const descEl = document.getElementById('form-zone-type-desc');
        if (!descEl) return;
        const desc = selectedCode ? getZoneTypeDescription(selectedCode) : '';
        const label = selectedCode ? getZoneTypeLabel(selectedCode) : '';
        if (desc) {
            descEl.textContent = `${label} : ${desc}`;
        } else {
            descEl.textContent = 'Sélectionnez un type pour voir sa description.';
        }
    }

    function setZoneTypesManageLinkVisible(visible) {
        const link = document.getElementById('zone-types-manage-link');
        if (link) {
            link.style.visibility = visible ? 'visible' : 'hidden';
        }
    }

    function showZoneTypesModal() {
        const modal = document.getElementById('zone-types-modal');
        const listEl = document.getElementById('zone-types-list');
        if (!modal || !listEl) return;

        // Build HTML for zone types
        let html = '';
        if (zoneTypes && zoneTypes.length > 0) {
            zoneTypes.forEach(zt => {
                html += `
                    <div class="zone-type-item" data-zone-type-code="${zt.code}">
                        <div class="zone-type-content">
                            <div class="zone-type-name">${zt.name}</div>
                            <div class="zone-type-desc">${zt.description || '(pas de description)'}</div>
                        </div>
                        <div class="zone-type-actions">
                            <button class="edit-btn" title="Modifier">✏️</button>
                            <button class="delete-btn" title="Supprimer">🗑️</button>
                        </div>
                    </div>
                `;
            });
        } else {
            html = '<p>Aucun type de zone disponible.</p>';
        }

        listEl.innerHTML = html;
        modal.style.display = 'flex';

        // Attach delete button handlers
        const deleteButtons = listEl.querySelectorAll('.delete-btn');
        deleteButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const item = btn.closest('.zone-type-item');
                const code = item?.getAttribute('data-zone-type-code');
                if (!code) return;

                // Find the zone type for display
                const zt = zoneTypes.find(t => t.code === code);
                const typeName = zt?.name || code;

                // Confirm before deleting
                const confirmed = await confirm(`Êtes-vous sûr de vouloir supprimer "${typeName}" ?`);
                if (!confirmed) {
                    return;
                }

                // Set grace period to prevent modal from closing after confirmation
                preventCloseUntil = Date.now() + 500;

                // Delete the zone type
                try {
                    const res = await API.deleteZoneType(code);
                    if (res.success) {
                        notify(`Type "${typeName}" supprimé avec succès`, 'success');
                        await refreshZoneTypesEverywhere();
                        showZoneTypesModal();
                    } else {
                        notify(`Erreur : ${res.error || 'Impossible de supprimer le type'}`, 'error');
                        showZoneTypesModal();
                    }
                } catch (err) {
                    const errorMsg = err.data?.detail || err.message || 'Erreur lors de la suppression';
                    notify(errorMsg, 'error');
                    showZoneTypesModal();
                }
            });
        });

        // Attach edit button handlers
        const editButtons = listEl.querySelectorAll('.edit-btn');
        editButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const item = btn.closest('.zone-type-item');
                const code = item?.getAttribute('data-zone-type-code');
                if (!code) return;
                const zt = zoneTypes.find(t => t.code === code);
                if (!zt) return;
                enterEditZoneType(item, zt);
            });
        });
    }

    async function refreshZoneTypesEverywhere() {
        try {
            const res = await API.getZoneTypes();
            if (res?.success && res.data) {
                if (window.AppState?.setZoneTypes) {
                    window.AppState.setZoneTypes(res.data);
                }
                if (typeof setZoneTypes === 'function') {
                    setZoneTypes(res.data);
                }
            }
        } catch (e) {
            // silent
        }
    }

    function showAddZoneTypeInlineForm() {
        const listEl = document.getElementById('zone-types-list');
        if (!listEl) return;
        const existing = document.getElementById('zone-type-add-form');
        if (existing) return; // already shown
        const form = document.createElement('div');
        form.id = 'zone-type-add-form';
        form.className = 'zone-type-item';
        form.innerHTML = `
            <div class="zone-type-content" style="width: 100%">
                <div style="display:flex; gap:8px; margin-bottom:8px;">
                    <input id="zt-code" class="zt-small" type="text" placeholder="CODE" style="flex:0 0 120px; width:120px; max-width:120px; text-transform: uppercase;" />
                    <input id="zt-name" type="text" placeholder="Nom" style="flex:1;" />
                    <input id="zt-color" class="zt-small" type="text" placeholder="#RRGGBB" style="flex:0 0 80px; width:80px; max-width:80px;" />
                </div>
                <div>
                    <textarea id="zt-desc" rows="2" placeholder="Description" style="width:100%; resize: vertical;"></textarea>
                </div>
                <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px;">
                    <button id="zt-cancel" class="btn btn-secondary btn-sm">Annuler</button>
                    <button id="zt-save" class="btn btn-primary btn-sm">Enregistrer</button>
                </div>
            </div>
        `;
        listEl.prepend(form);

        const saveBtn = form.querySelector('#zt-save');
        const cancelBtn = form.querySelector('#zt-cancel');

        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            form.remove();
        });

        saveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const code = form.querySelector('#zt-code').value.trim();
            const name = form.querySelector('#zt-name').value.trim();
            const color = form.querySelector('#zt-color').value.trim();
            const description = form.querySelector('#zt-desc').value.trim();

            if (!code || !name || !color) {
                notify('Code, nom et couleur sont requis', 'error');
                return;
            }
            if (!description) {
                notify('La description est requise', 'error');
                return;
            }

            try {
                const res = await API.createZoneType({ code, name, color, description });
                if (res?.success) {
                    notify('Type ajouté', 'success');
                    form.remove();
                    await refreshZoneTypesEverywhere();
                    // Don't rebuild modal - just remove the form
                } else {
                    notify(res?.error || 'Échec de la création', 'error');
                }
            } catch (err) {
                const msg = err?.data?.detail || err?.message || 'Erreur lors de la création';
                notify(msg, 'error');
            }
        });
    }



    function enterEditZoneType(item, zt) {
        if (!item || !zt) return;
        const content = item.querySelector('.zone-type-content');
        const actions = item.querySelector('.zone-type-actions');
        if (!content || !actions) return;

        const originalHTML = content.innerHTML;
        const originalActionsDisplay = actions.style.display;

        // Determine if code is editable (created < 90 days)
        let codeEditable = false;
        try {
            if (zt.created_at) {
                const created = new Date(zt.created_at);
                const now = new Date();
                const diffDays = (now - created) / (1000 * 60 * 60 * 24);
                codeEditable = diffDays <= 7;
            }
        } catch (e) {
            codeEditable = false;
        }

        // Hide actions area to match add form layout
        actions.style.display = 'none';

        // Build edit form identical to add form layout
        content.innerHTML = `
            <div class="zone-type-content" style="width: 100%">
                <div style="display:flex; gap:8px; margin-bottom:8px;">
                    <input id="zt-edit-code" class="zt-small" type="text" placeholder="CODE" style="flex:0 0 120px; width:120px; max-width:120px; text-transform: uppercase;" value="${escapeHtml(zt.code)}" ${codeEditable ? '' : 'disabled'} />
                    <input id="zt-edit-name" type="text" placeholder="Nom" style="flex:1;" value="${escapeHtml(zt.name)}" />
                    <input id="zt-edit-color" class="zt-small" type="text" placeholder="#RRGGBB" style="flex:0 0 80px; width:80px; max-width:80px;" value="${escapeHtml(zt.color)}" />
                </div>
                <div>
                    <textarea id="zt-edit-desc" rows="2" placeholder="Description" style="width:100%; resize: vertical;">${escapeHtml(zt.description || '')}</textarea>
                </div>
                <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px;">
                    <button id="zt-edit-cancel" class="btn btn-secondary btn-sm">Annuler</button>
                    <button id="zt-edit-save" class="btn btn-primary btn-sm">Enregistrer</button>
                </div>
            </div>
        `;

        const onCancel = (e) => {
            e.preventDefault();
            e.stopPropagation();
            content.innerHTML = originalHTML;
            actions.style.display = originalActionsDisplay || '';
            // Don't call showZoneTypesModal - just restore the item view
        };

        const onSave = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const name = item.querySelector('#zt-edit-name')?.value?.trim();
            const color = item.querySelector('#zt-edit-color')?.value?.trim();
            const description = item.querySelector('#zt-edit-desc')?.value?.trim();
            const newCodeVal = item.querySelector('#zt-edit-code')?.value?.trim();
            if (!name || !color) {
                notify('Nom et couleur sont requis', 'error');
                return;
            }
            if (!description) {
                notify('La description est requise', 'error');
                return;
            }
            const payload = { name, color, description };
            if (codeEditable && newCodeVal && newCodeVal.toUpperCase() !== zt.code) {
                payload.code = newCodeVal.toUpperCase();
            }
            try {
                const res = await API.updateZoneType(zt.code, payload);
                if (res?.success) {
                    notify('Type mis à jour', 'success');
                    await refreshZoneTypesEverywhere();
                    // Update the zone type object with new values
                    const updatedZt = zoneTypes.find(t => t.code === (payload.code || zt.code));
                    if (updatedZt) {
                        // Restore original view with updated data
                        content.innerHTML = `
                            <div class="zone-type-name">${updatedZt.name}</div>
                            <div class="zone-type-desc">${updatedZt.description || '(pas de description)'}</div>
                        `;
                        actions.style.display = originalActionsDisplay || '';
                        // Update data attribute if code changed
                        if (payload.code) {
                            item.setAttribute('data-zone-type-code', payload.code);
                        }
                    }
                } else {
                    notify(res?.error || 'Échec de la mise à jour', 'error');
                }
            } catch (err) {
                const msg = err?.data?.detail || err?.message || 'Erreur lors de la mise à jour';
                notify(msg, 'error');
            }
        };

        item.querySelector('#zt-edit-cancel')?.addEventListener('click', onCancel);
        item.querySelector('#zt-edit-save')?.addEventListener('click', onSave);
    }

    function escapeHtml(str) {
        if (str === undefined || str === null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function hideZoneTypesModal() {
        const modal = document.getElementById('zone-types-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    return {
        showDrawerDetails,
        showDrawerForm,
        setZoneTypes,
        showDrawerEmpty,
        openDrawer,
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
        updateZoneTypeDescription,
        setZoneTypesManageLinkVisible,
        showZoneTypesModal,
        hideZoneTypesModal,
    };
})();
