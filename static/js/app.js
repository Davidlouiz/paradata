/**
 * Main App – Core application logic avec machine d'état AppState
 */

const APP = (() => {
    let map = null;
    let mapLayers = {}; // id -> Leaflet layer
    let stateUnsubscribe = null;
    let pollingIntervalId = null;
    let coverageLayerGroup = null; // feature group for volunteer coverage perimeters
    let coverageLayers = {}; // coverage id -> Leaflet layer
    function isCoverageSheetOpen() {
        const sheet = document.getElementById('coverage-sheet');
        return !!(sheet && sheet.style.display !== 'none' && sheet.classList.contains('open'));
    }

    /**
     * Initialiser l'application
     */
    async function init() {
        console.log('APP.init()');

        // Initialiser la carte
        map = L.map('map').setView([45.5, 6.0], 10); // Alpes françaises
        window.map = map; // Expose pour la feuille "Mes périmètres"
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19,
        }).addTo(map);

        // Initialiser les modules
        DRAW.init(map);

        // Groupe de couches pour afficher les périmètres de couverture du volontaire
        coverageLayerGroup = L.featureGroup();
        coverageLayerGroup.addTo(map);

        // Initialiser WebSocket pour la synchronisation temps réel
        try {
            await SOCKET.init();
        } catch (err) {
            console.warn('WebSocket initialization failed, will use polling fallback:', err);
        }

        // Vérifier l'authentification
        await checkAuth();
        // Dès que l'état est connu, révéler les éléments masqués et labels
        const knownState = AppState.getState();
        updateLoginButton(knownState);
        updateStatusIndicator(knownState);

        // Charger les objets de la carte
        await loadMapObjects();

        // Configurer les écouteurs d'état et d'événements
        setupStateListener();
        setupEventHandlers();

        // Appliquer l'état initial immédiatement (afficher toolbar couverture si authentifié)
        const initialState = AppState.getState();
        const initialCoverageOpen = isCoverageSheetOpen();
        const toolbarCoverage = document.getElementById('toolbar-coverage');
        if (toolbarCoverage) {
            toolbarCoverage.style.display = initialState.isAuthenticated ? 'flex' : 'none';
        }
        const quotaShell = document.getElementById('toolbar-quota')?.closest('.toolbar-shell');
        if (quotaShell) {
            quotaShell.style.display = initialState.isAuthenticated && !initialCoverageOpen ? 'flex' : 'none';
        }
        const toolbarCreate = document.getElementById('toolbar-create');
        if (toolbarCreate) {
            toolbarCreate.style.display = initialState.isAuthenticated && !initialCoverageOpen ? 'flex' : 'none';
        }
        // Afficher le bouton coverage si authentifié
        const btnCoverage = document.getElementById('btn-coverage');
        if (btnCoverage) {
            btnCoverage.style.display = initialState.isAuthenticated ? 'inline-block' : 'none';
        }
        const btnCreate = document.getElementById('btn-create');
        if (btnCreate) {
            btnCreate.style.display = initialState.isAuthenticated && !initialCoverageOpen ? 'inline-block' : 'none';
            btnCreate.disabled = initialState.mode === 'DRAW' || initialState.mode === 'EDIT';
        }
        // S'assurer que le statut de toolbar est caché s'il est vide
        UI.updateDrawStatus('');

        // Initialiser l'affichage utilisateur
        UI.updateUserDisplay(initialState.currentUser);

        // Démarrer le polling uniquement si le WebSocket n'est pas connecté après un court délai
        setTimeout(() => {
            if (!SOCKET.connected) {
                startPolling();
            }
        }, 1500);

        console.log('APP initialized');

        // Masquer les toolbar-shell vides
        updateToolbarShellVisibility();
    }
    function renderCoverageOnMap(items) {
        if (!coverageLayerGroup) return;
        coverageLayerGroup.clearLayers();
        coverageLayers = {};
        if (!items || !items.length) return;
        try {
            items.forEach((i) => {
                if (!i.geometry) return;
                const layer = L.geoJSON(i.geometry, {
                    style: {
                        color: '#1976d2',
                        weight: 2,
                        opacity: 0.9,
                        fillOpacity: 0.08,
                    },
                    onEachFeature: (feature, layer) => {
                        layer.on('click', () => {
                            UI.highlightCoverageListItem(i.id);
                            highlightCoverageOnMap(i.id);
                        });
                    },
                });
                layer.addTo(coverageLayerGroup);
                coverageLayers[i.id] = layer;
            });
        } catch (err) {
            console.warn('Error rendering coverage perimeters:', err);
        }
    }

    function highlightCoverageOnMap(coverageId) {
        // Remettre le style normal pour tous les périmètres
        Object.values(coverageLayers).forEach(layer => {
            layer.setStyle({
                color: '#1976d2',
                weight: 2,
                opacity: 0.9,
                fillOpacity: 0.08,
            });
        });
        // Mettre en surbrillance le périmètre sélectionné
        if (coverageId && coverageLayers[coverageId]) {
            coverageLayers[coverageId].setStyle({
                color: '#1976d2',
                weight: 3,
                opacity: 1,
                fillOpacity: 0.2,
            });
            // Retirer la surbrillance après 2 secondes
            setTimeout(() => {
                if (coverageLayers[coverageId]) {
                    coverageLayers[coverageId].setStyle({
                        color: '#1976d2',
                        weight: 2,
                        opacity: 0.9,
                        fillOpacity: 0.08,
                    });
                }
            }, 2000);
        }
    }

    async function refreshQuotaPanel() {
        const state = AppState.getState();
        if (!state.isAuthenticated) {
            UI.updateQuotaPanel(null);
            return;
        }
        try {
            const q = await API.getMyQuota();
            UI.updateQuotaPanel(q);
        } catch (e) {
            UI.updateQuotaPanel(null);
            console.warn('Failed to refresh quota panel', e);
        }
    }

    /**
     * Vérifier l'authentification actuelle
     */
    async function checkAuth() {
        try {
            const user = await API.getMe();
            AppState.setCurrentUser(user);
            await refreshQuotaPanel();
        } catch (err) {
            AppState.setCurrentUser(null);
            UI.updateQuotaPanel(null);
        }
    }

    /**
     * Se connecter
     */
    async function login(username, password) {
        const user = await API.login(username, password);
        AppState.setCurrentUser(user);
        UI.notify('Connecté!', 'success');
        await refreshQuotaPanel();
        const state = AppState.getState();
        if (state.mode !== 'VIEW') {
            await cancelEdit(true);
        }
        AppState.deselectObject();
        restyleAllLayers();
        // TODO: Authentifier sur Socket.IO si implémenté
    }

    /**
     * S'inscrire
     */
    async function register(username, password) {
        const user = await API.register(username, password);
        AppState.setCurrentUser(user);
        UI.notify('Compte créé! Vous êtes connecté.', 'success');
        await refreshQuotaPanel();
        const state = AppState.getState();
        if (state.mode !== 'VIEW') {
            await cancelEdit(true);
        }
        AppState.deselectObject();
        restyleAllLayers();
        // TODO: Authentifier sur Socket.IO si implémenté
    }

    /**
     * Se déconnecter
     */
    async function logout() {
        if (!await UI.confirm('Déconnexion', 'Êtes-vous sûr de vouloir vous déconnecter ?')) {
            return;
        }

        try {
            const state = AppState.getState();
            if (state.mode === 'EDIT' || state.mode === 'DRAW') {
                await cancelEdit(true);
            }
            await API.logout();
            AppState.setCurrentUser(null);
            UI.notify('Déconnecté!', 'success');
            UI.updateQuotaPanel(null);
            AppState.deselectObject();
            restyleAllLayers();
            // Fermer le modal des périmètres s'il est ouvert
            if (isCoverageSheetOpen()) {
                closeCoverageSheetWithCleanup();
            }
        } catch (err) {
            UI.notify(`Erreur: ${err.message}`, 'error');
        }
    }

    /**
     * Démarrer le polling de fallback
     */
    function startPolling() {
        if (pollingIntervalId) return; // Déjà actif
        console.log('Starting polling fallback (WebSocket disconnected)');
        pollingIntervalId = setInterval(loadMapObjects, 5000);
    }

    /**
     * Arrêter le polling de fallback
     */
    function stopPolling() {
        if (!pollingIntervalId) return; // Déjà arrêté
        console.log('Stopping polling fallback (WebSocket connected)');
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }

    /**
     * Obtenir la couleur d'une sévérité
     */
    function getColorBySeverity(severity) {
        if (severity === 'ALERT_STANDARD') return '#d32f2f';
        if (severity === 'NO_ALERT') return '#7cb342';
        return '#999'; // Par défaut
    }

    /**
     * Charger les objets de la carte dans la région visible
     */
    async function loadMapObjects() {
        try {
            const bounds = map.getBounds();
            const bbox = {
                minLat: bounds.getSouth(),
                minLng: bounds.getWest(),
                maxLat: bounds.getNorth(),
                maxLng: bounds.getEast(),
            };

            const res = await API.listMapObjects(bbox);
            renderMapObjects(res.data || []);
        } catch (err) {
            console.error('Error loading map objects:', err);
        }
    }

    /**
     * Afficher les objets sur la carte
     */
    function renderMapObjects(objects) {
        const state = AppState.getState();

        // Si on est en édition, ne pas recharger la zone en cours d'édition
        if (state.mode === 'EDIT') {
            // Mettre à jour SEULEMENT les autres zones
            const editingObjectId = state.selectedObjectId;
            const objectsToUpdate = objects.filter(obj => obj.id !== editingObjectId);

            // Supprimer les couches non éditées qui ne sont plus dans les données
            Object.keys(mapLayers).forEach((id) => {
                const intId = parseInt(id);
                if (intId !== editingObjectId && !objectsToUpdate.find(obj => obj.id === intId)) {
                    map.removeLayer(mapLayers[id]);
                    delete mapLayers[id];
                }
            });

            // Ajouter/mettre à jour les autres zones
            objectsToUpdate.forEach((obj) => {
                if (!mapLayers[obj.id]) {
                    renderMapObject(obj);
                }
            });
            return; // Arrêter ici, ne pas recharger l'objet en édition
        }

        // Mode normal : Effacer toutes les couches et rafraîchir
        Object.keys(mapLayers).forEach((id) => {
            map.removeLayer(mapLayers[id]);
            delete mapLayers[id];
        });

        // Ajouter les nouvelles couches
        objects.forEach((obj) => {
            if (!mapLayers[obj.id]) {
                renderMapObject(obj);
            }
        });
    }

    /**
     * Afficher un objet sur la carte
     */
    function renderMapObject(obj) {
        if (!obj.geometry) return;

        try {
            const layer = L.geoJSON(obj.geometry, {
                style: () => getPolygonStyle(obj),
                onEachFeature: (feature, layer) => {
                    layer.on('click', () => selectPolygon(obj, layer));
                },
            });

            layer.addTo(map);
            layer.objData = obj;
            mapLayers[obj.id] = layer;
        } catch (err) {
            console.error('Error rendering polygon:', err, obj);
        }
    }

    /**
     * Obtenir le style du polygone selon son état
     */
    function getPolygonStyle(obj) {
        const state = AppState.getState();
        const isSelected = obj.id === state.selectedObjectId;
        const isLocked = obj.locked_by;
        const severity = obj.severity;

        const color = getColorBySeverity(severity);

        return {
            color: isSelected ? '#000' : color,
            weight: isSelected ? 3 : 2,
            opacity: 0.8,
            fillOpacity: isLocked ? 0.3 : 0.5,
            dashArray: isLocked ? '5, 5' : undefined,
        };
    }

    /**
     * Réappliquer le style standard à toutes les couches (utile après désélection globale)
     */
    function restyleAllLayers() {
        Object.values(mapLayers).forEach((layer) => {
            if (layer?.objData) {
                layer.setStyle(getPolygonStyle(layer.objData));
            }
        });
    }

    /**
     * Fermer le tiroir de périmètres et nettoyer les polygones affichés
     */
    function closeCoverageSheetWithCleanup() {
        UI.closeCoverageSheet();
        APP.clearCoverageOnMap();
    }

    /**
    * Sélectionner une zone
     */
    function selectPolygon(obj, layer) {
        if (isCoverageSheetOpen()) {
            return; // Bloquer les clics quand le coverage sheet est ouvert
        }
        const state = AppState.getState();

        // Ignorer les clics pendant le dessin d'une nouvelle zone
        if (state.mode === 'DRAW') {
            return;
        }

        // Si on est en EDIT et qu'on clique une autre zone, basculer l'édition
        if (state.mode === 'EDIT' && state.selectedObjectId && state.selectedObjectId !== obj.id) {
            // Annuler l'édition courante sans ré-sélection automatique
            cancelEdit(true).then(() => {
                // Sélectionner la nouvelle zone et démarrer l'édition directement
                AppState.selectObject(obj);
                // Pas besoin de showDrawerDetails, startEdit affiche le formulaire
                startEdit();
            });
            return;
        }

        // Sélectionner le nouveau AVANT de mettre à jour les anciens styles
        // pour que getPolygonStyle() reflète la nouvelle sélection
        AppState.selectObject(obj);

        // Maintenant, mettre à jour le style de l'ancien sélectionné
        if (state.selectedObjectId && state.selectedObjectId !== obj.id) {
            const oldLayer = mapLayers[state.selectedObjectId];
            if (oldLayer) {
                oldLayer.setStyle(getPolygonStyle(oldLayer.objData));
            }
        }

        // Afficher le panneau détails ou formulaire selon le mode
        // En mode simplifié: si authentifié et pas déjà en EDIT, entrer en édition
        const current = AppState.getState();
        if (current.isAuthenticated && current.mode !== 'EDIT') {
            // Ne pas afficher les détails, passer directement en mode édition
            // Ne pas appliquer le style noir, startEdit va cacher la couche immédiatement
            startEdit();
        } else {
            // Afficher les détails seulement si non authentifié ou déjà en EDIT
            UI.showDrawerDetails(obj);
            // Appliquer le style du nouveau sélectionné seulement si on ne va pas en EDIT
            layer.setStyle(getPolygonStyle(obj));
        }
    }

    /**
     * Mettre à jour la visibilité des toolbar-shell vides
     */
    function updateToolbarShellVisibility() {
        const shells = document.querySelectorAll('.toolbar-shell');
        shells.forEach((shell) => {
            // Vérifier si le shell a au moins un enfant visible
            const hasVisibleChild = Array.from(shell.children).some((child) => {
                const style = window.getComputedStyle(child);
                return style.display !== 'none';
            });

            if (hasVisibleChild) {
                shell.classList.remove('empty');
            } else {
                shell.classList.add('empty');
            }
        });
    }

    /**
     * Écouteur de changement d'état (s'abonne à AppState)
     */
    function setupStateListener() {
        stateUnsubscribe = AppState.subscribe((state) => {
            console.log('State changed:', state);

            // Mettre à jour l'affichage utilisateur
            UI.updateUserDisplay(state.currentUser);

            // Mettre à jour la visibilité des contrôles
            const isAuth = state.isAuthenticated;
            const coverageOpen = isCoverageSheetOpen();
            const shellContainer = document.getElementById('toolbar-shell-container');
            if (shellContainer) {
                shellContainer.style.display = isAuth ? 'flex' : 'none';
            }
            const toolbarCoverage = document.getElementById('toolbar-coverage');
            if (toolbarCoverage) {
                toolbarCoverage.style.display = isAuth ? 'flex' : 'none';
            }

            const quotaShell = document.getElementById('toolbar-quota')?.closest('.toolbar-shell');
            if (quotaShell) {
                quotaShell.style.display = isAuth && !coverageOpen ? 'flex' : 'none';
            }

            const toolbarCreate = document.getElementById('toolbar-create');
            if (toolbarCreate) {
                toolbarCreate.style.display = isAuth && !coverageOpen ? 'flex' : 'none';
            }

            // Gérer la visibilité du bouton Mes périmètres d'intervention
            const btnCoverage = document.getElementById('btn-coverage');
            if (btnCoverage) {
                btnCoverage.style.display = isAuth ? 'inline-block' : 'none';
            }

            const btnCreate = document.getElementById('btn-create');
            if (btnCreate) {
                btnCreate.style.display = isAuth && !coverageOpen ? 'inline-block' : 'none';
            }

            // Mettre à jour le bouton Créer et le bouton Supprimer du formulaire
            if (btnCreate) {
                // Désactiver Créer lorsqu'on est en mode DRAW ou EDIT
                btnCreate.disabled = state.mode === 'DRAW' || state.mode === 'EDIT';
            }
            const btnDeleteForm = document.getElementById('btn-delete-form');
            if (btnDeleteForm) {
                btnDeleteForm.style.display = state.mode === 'EDIT' ? 'inline-block' : 'none';
            }

            // Afficher/masquer le panneau latéral selon mode
            const drawer = document.getElementById('drawer');
            if (!state.selectedObjectId && state.mode === 'VIEW') {
                drawer?.classList.remove('open');
            }

            // Afficher le statut
            updateStatusIndicator(state);

            // Mettre à jour la visibilité des toolbar-shell vides
            updateToolbarShellVisibility();
        });
    }

    /**
     * Mettre à jour l'indicateur de statut (auth vs lecture seule)
     */
    function updateStatusIndicator(state) {
        const statusInd = document.getElementById('status-indicator');
        if (!statusInd) return;
        statusInd.textContent = state.isAuthenticated ? 'Contributeur' : 'Lecture seule';
        statusInd.style.display = 'inline-block';
    }

    /**
     * Mettre à jour le bouton d'authentification
     */
    function updateLoginButton(state) {
        const loginButton = document.getElementById('auth-btn');
        if (!loginButton) return;
        loginButton.textContent = state.isAuthenticated ? 'Se déconnecter' : 'Se connecter';
        loginButton.style.display = 'inline-block';
    }

    /**
     * Configurer les écouteurs d'événements du DOM
     */
    function setupEventHandlers() {
        // Bouton Créer
        const btnCreate = document.getElementById('btn-create');
        if (btnCreate) {
            btnCreate.addEventListener('click', startCreate);
        }

        // Bouton Supprimer dans le formulaire d'édition
        const btnDeleteForm = document.getElementById('btn-delete-form');
        if (btnDeleteForm) {
            btnDeleteForm.addEventListener('click', async () => {
                if (await UI.confirm('Supprimer', 'Êtes-vous sûr de vouloir supprimer cette zone\u202F?')) {
                    deletePolygon();
                }
            });
        }

        // Bouton Enregistrer
        const btnSave = document.getElementById('btn-save');
        if (btnSave) {
            btnSave.addEventListener('click', savePolygon);
        }

        // Bouton Annuler
        const btnCancel = document.getElementById('btn-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', cancelEdit);
        }

        // Bouton Fermer le drawer = Annuler si on est en EDIT/DRAW
        const btnCloseDrawer = document.getElementById('btn-close-drawer');
        if (btnCloseDrawer) {
            btnCloseDrawer.addEventListener('click', () => {
                const state = AppState.getState();
                if (state.mode === 'DRAW' || state.mode === 'EDIT') {
                    cancelEdit(true); // Ne pas ré-sélectionner
                } else {
                    // Désélectionner l'objet et fermer le drawer
                    AppState.deselectObject();
                    restyleAllLayers();
                    UI.closeDrawer();
                }
            });
        }

        // Écouter les changements de sévérité pour mettre à jour la couleur de la zone en édition
        const formSeverity = document.getElementById('form-severity');
        if (formSeverity) {
            formSeverity.addEventListener('change', (e) => {
                DRAW.updateEditingPolygonColor(e.target.value);
            });
        }

        // Fermer le drawer en cliquant sur le fond de la carte
        map.on('click', (e) => {
            if (e.originalEvent.target.id === 'map') {
                const state = AppState.getState();
                if (state.mode === 'VIEW') {
                    AppState.deselectObject();
                    document.getElementById('drawer').classList.remove('open');
                }
            }
        });

        // Échap pour annuler dessin/édition
        document.addEventListener('keydown', async (e) => {
            if (e.key === 'Escape') {
                // Si le coverage sheet est ouvert, le fermer
                if (isCoverageSheetOpen()) {
                    // Si un dessin de périmètre est en cours, l'arrêter d'abord
                    if (window.map && window.map.pm && window.map.pm.globalDrawModeEnabled()) {
                        window.map.pm.disableDraw();
                    }
                    UI.closeCoverageSheet();
                    UI.updateDrawStatus('');
                    // Restaurer la toolbar coverage
                    const toolbarCoverage = document.getElementById('toolbar-coverage');
                    if (toolbarCoverage && AppState.getState().isAuthenticated) {
                        toolbarCoverage.style.display = 'flex';
                    }
                    // Restaurer le bloc Créer si authentifié
                    const toolbarCreateShell = document.getElementById('toolbar-create')?.closest('.toolbar-shell');
                    const toolbarCreate = document.getElementById('toolbar-create');
                    const btnCreate = document.getElementById('btn-create');
                    if (AppState.getState().isAuthenticated) {
                        if (toolbarCreateShell) toolbarCreateShell.style.display = 'flex';
                        if (toolbarCreate) toolbarCreate.style.display = 'flex';
                        if (btnCreate) {
                            btnCreate.style.display = 'inline-block';
                            btnCreate.disabled = false;
                        }
                    }
                    // Restaurer le bloc Plafonds si authentifié
                    const quotaShell = document.getElementById('toolbar-quota')?.closest('.toolbar-shell');
                    const quotaPanel = document.getElementById('toolbar-quota');
                    if (AppState.getState().isAuthenticated) {
                        if (quotaShell) quotaShell.style.display = 'flex';
                        if (quotaPanel) quotaPanel.style.display = 'flex';
                    }
                    // Recharger les quotas pour réafficher le panneau
                    try {
                        if (AppState.getState().isAuthenticated) {
                            const q = await API.getMyQuota();
                            UI.updateQuotaPanel(q);
                        } else {
                            UI.updateQuotaPanel(null);
                        }
                    } catch (e) {
                        // Ne pas masquer les plafonds si l'appel échoue : garder l'affichage existant
                        console.warn('Failed to reload quota after ESC closing coverage', e);
                    }
                    // Restaurer la visibilité des toolbar-shell
                    APP.updateToolbarShellVisibility();
                    APP.clearCoverageOnMap();
                    return;
                }

                const state = AppState.getState();
                if (state.mode === 'DRAW' || state.mode === 'EDIT') {
                    cancelEdit(true); // Ne pas ré-sélectionner
                } else if (state.selectedObjectId !== null) {
                    AppState.deselectObject();
                    restyleAllLayers();
                    UI.closeDrawer();
                }
            }
        });

        // Auth: soumission login
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('login-username')?.value.trim();
                const password = document.getElementById('login-password')?.value;
                if (!username || !password) {
                    UI.showAuthMessage('Veuillez remplir tous les champs', true);
                    return;
                }
                try {
                    await login(username, password);
                    loginForm.reset();
                    UI.hideLoginModal();
                } catch (err) {
                    UI.showAuthMessage(err.message || 'Échec de la connexion', true);
                }
            });
        }

        // Auth: soumission inscription
        const registerForm = document.getElementById('register-form');
        if (registerForm) {
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('register-username')?.value.trim();
                const password = document.getElementById('register-password')?.value;
                const confirmPassword = document.getElementById('register-password-confirm')?.value;
                if (!username || !password || !confirmPassword) {
                    UI.showAuthMessage('Veuillez remplir tous les champs', true);
                    return;
                }
                if (password !== confirmPassword) {
                    UI.showAuthMessage('Les mots de passe ne correspondent pas', true);
                    return;
                }
                try {
                    await register(username, password);
                    registerForm.reset();
                    UI.hideLoginModal();
                } catch (err) {
                    UI.showAuthMessage(err.message || "Échec de l'inscription", true);
                }
            });
        }

        // Auth: toggle vers inscription
        const btnToggleRegister = document.getElementById('btn-toggle-register');
        if (btnToggleRegister) {
            btnToggleRegister.addEventListener('click', (e) => {
                e.preventDefault();
                document.getElementById('login-form')?.setAttribute('style', 'display: none;');
                document.getElementById('register-form')?.setAttribute('style', 'display: block;');
                const msg = document.getElementById('auth-message');
                if (msg) msg.style.display = 'none';
            });
        }

        // Auth: toggle retour connexion
        const btnToggleLogin = document.getElementById('btn-toggle-login');
        if (btnToggleLogin) {
            btnToggleLogin.addEventListener('click', (e) => {
                e.preventDefault();
                document.getElementById('register-form')?.setAttribute('style', 'display: none;');
                document.getElementById('login-form')?.setAttribute('style', 'display: block;');
                const msg = document.getElementById('auth-message');
                if (msg) msg.style.display = 'none';
            });
        }

        // Auth: fermer la modale
        const btnCloseAuth = document.getElementById('btn-close-auth');
        if (btnCloseAuth) {
            btnCloseAuth.addEventListener('click', (e) => {
                e.preventDefault();
                UI.hideLoginModal();
            });
        }

        // Danger Help Modal
        const dangerHelpLink = document.getElementById('danger-help-link');
        if (dangerHelpLink) {
            dangerHelpLink.addEventListener('click', (e) => {
                e.preventDefault();
                UI.openDangerHelpModal();
            });
        }

        const dangerHelpModal = document.getElementById('danger-help-modal');
        if (dangerHelpModal) {
            // Empêcher les cliques sur le modal de passer au travers
            dangerHelpModal.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Fermer en cliquant sur le backdrop (extérieur du modal-content)
            dangerHelpModal.addEventListener('click', (e) => {
                if (e.target === dangerHelpModal) {
                    UI.closeDangerHelpModal();
                }
            });

            // Fermer en cliquant le bouton X
            const closeBtn = dangerHelpModal.querySelector('.modal-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    UI.closeDangerHelpModal();
                });
            }

            // Fermer avec Échap
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && dangerHelpModal.style.display !== 'none') {
                    e.preventDefault();
                    UI.closeDangerHelpModal();
                }
            });
        }
    }

    /**
    * FLUX 2 : Démarrer le mode CREATE (dessiner une nouvelle zone)
     */
    function startCreate() {
        if (isCoverageSheetOpen()) {
            closeCoverageSheetWithCleanup(); // Fermer et nettoyer les périmètres
        }
        const state = AppState.getState();
        if (!state.isAuthenticated) {
            UI.notify('Vous devez être connecté', 'error');
            return;
        }

        AppState.setDrawMode();
        DRAW.clearDrawnLayers();
        DRAW.startCreateMode();
        UI.updateDrawStatus('Cliquez sur la carte pour dessiner une zone.');
        UI.showDrawerForm(); // Affiche le formulaire vide
        UI.showSaveCancel();
    }

    /**
    * FLUX 3 : Démarrer le mode EDIT (modifier une zone verrouillée)
     */
    async function startEdit() {
        const state = AppState.getState();
        if (!state.selectedObjectId) return;

        try {
            // Charger l'objet frais
            const res = await API.getMapObject(state.selectedObjectId);
            const obj = res.data;

            // Vérifier si verrouillé par quelqu'un d'autre
            if (obj.locked_by && obj.locked_by !== state.currentUser?.id) {
                UI.notify(
                    `Cette zone est en cours de modification par ${obj.locked_by_username}`,
                    'error'
                );
                return;
            }

            // Acquérir le verrou
            const checkoutRes = await API.checkoutObject(obj.id);
            const lockStatus = checkoutRes.data;

            // Préparer l'édition dans AppState
            AppState.prepareEdit(obj, lockStatus);

            // Démarrer le mode édition dans DRAW
            DRAW.clearDrawnLayers();
            DRAW.startEditMode(obj);

            // Retirer la zone originale de la carte (appliquer style normal avant)
            if (mapLayers[obj.id]) {
                const layer = mapLayers[obj.id];
                // Appliquer le style normal (sans sélection) avant de cacher
                layer.setStyle({
                    color: getColorBySeverity(obj.severity),
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0.5,
                });
                map.removeLayer(layer);
                // Marquer comme caché pour pouvoir le restaurer plus tard
                layer._isHidden = true;
            }

            // Afficher le formulaire pré-rempli
            UI.showDrawerForm(obj);
            UI.showSaveCancel();

            // Mettre à jour la couleur de la zone selon la sévérité du formulaire
            const formSeverity = document.getElementById('form-severity');
            if (formSeverity && formSeverity.value) {
                DRAW.updateEditingPolygonColor(formSeverity.value);
            }

            // Ne pas afficher de badge/verrouillage visuel ni notification
        } catch (err) {
            UI.notify(`Erreur lors de la modification: ${err.message}`, 'error');
            console.error('Error starting edit:', err);
        }
    }

    /**
     * Démarrer un timer pour afficher le temps restant avant expiration du verrou
     */
    function startLockTimer() {
        // Désactivé: nous n'affichons plus le compte à rebours de verrou
    }

    /**
    * Vérifier si les données ont changé (création ou édition)
     */
    function hasChanges() {
        const state = AppState.getState();

        // En mode DRAW, on a toujours des changements (nouvelle zone)
        if (state.mode === 'DRAW') {
            return true;
        }

        // En mode EDIT, comparer les valeurs actuelles avec l'objet original
        if (state.mode === 'EDIT' && state.editingObject) {
            const original = state.editingObject;
            const currentSeverity = document.getElementById('form-severity').value;
            const currentDescription = document.getElementById('form-description').value;

            // Vérifier si la sévérité ou description a changé
            if (original.severity !== currentSeverity || original.description !== currentDescription) {
                return true;
            }

            // Vérifier si la géométrie a changé (comparaison basique)
            const drawnGeom = DRAW.getDrawnGeometry();
            if (!drawnGeom) return false;

            // Comparer les coordonnées
            try {
                const originalCoords = JSON.stringify(original.geometry.coordinates);
                const currentCoords = JSON.stringify(drawnGeom.coordinates);
                return originalCoords !== currentCoords;
            } catch (err) {
                console.warn('Error comparing geometry:', err);
                return true; // en cas d'erreur, on considère qu'il y a des changements
            }
        }

        return false;
    }

    /**
    * FLUX 2 & 3 : Enregistrer la zone (créer ou mettre à jour)
     */
    async function savePolygon() {
        const state = AppState.getState();
        if (!state.isAuthenticated) {
            UI.notify('Vous devez être connecté', 'error');
            return;
        }

        // Vérifier s'il y a des changements
        if (!hasChanges()) {
            UI.notify('Aucune modification à enregistrer', 'info');
            return;
        }

        // Valider la géométrie
        const geometry = DRAW.getDrawnGeometry();
        if (!DRAW.isValidDrawing() || !geometry) {
            UI.notify('Veuillez dessiner une zone valide (au moins 3 points)', 'error');
            return;
        }

        // Lire les champs du formulaire
        const severity = document.getElementById('form-severity').value;
        const description = document.getElementById('form-description').value;

        if (!severity) {
            UI.notify('Veuillez remplir tous les champs obligatoires', 'error');
            return;
        }

        try {
            UI.updateDrawStatus('Enregistrement...');

            let savedObjectData = null;

            if (state.mode === 'DRAW') {
                // Créer une nouvelle zone
                const res = await API.createMapObject({
                    geometry,
                    severity,
                    description,
                });
                await refreshQuotaPanel();
                UI.updateDrawStatus(''); // Vider avant affichage toast
                UI.notify('Zone créée!', 'success');
                console.log('Object created:', res.data);
                savedObjectData = res.data;
            } else if (state.mode === 'EDIT') {
                // Mettre à jour une zone existante
                const res = await API.updateMapObject(state.selectedObjectId, {
                    geometry,
                    severity,
                    description,
                });
                await refreshQuotaPanel();
                UI.updateDrawStatus(''); // Vider avant affichage toast
                UI.notify('Zone mise à jour!', 'success');
                console.log('Object updated:', res.data);
                savedObjectData = res.data;
            }

            // Désélectionner AVANT de mettre à jour le style (pour éviter la bordure noire)
            AppState.setViewMode();
            AppState.deselectObject();
            UI.closeDrawer();

            // Si on vient d'éditer, mettre à jour la couche cachée AVANT de la restaurer
            if (state.mode === 'EDIT' && savedObjectData) {
                const editedLayer = mapLayers[state.selectedObjectId];
                if (editedLayer && editedLayer._isHidden) {
                    // Mettre à jour les données de la couche pendant qu'elle est cachée
                    editedLayer.objData = savedObjectData;
                    // Mettre à jour la géométrie
                    editedLayer.clearLayers();
                    editedLayer.addData(savedObjectData.geometry);
                    // Mettre à jour le style (maintenant désélectionné, pas de bordure noire)
                    editedLayer.setStyle(getPolygonStyle(savedObjectData));
                    // Restaurer la couche (elle a déjà les bonnes données)
                    map.addLayer(editedLayer);
                    editedLayer._isHidden = false;
                }
            }

            // Restaurer les autres polygones cachés
            Object.keys(mapLayers).forEach((id) => {
                const layer = mapLayers[id];
                if (layer._isHidden) {
                    map.addLayer(layer);
                    layer._isHidden = false;
                }
            });

            // Nettoyer le layer d'édition Geoman (la couche mise à jour est déjà visible)
            DRAW.stopDrawMode();
            DRAW.clearDrawnLayers();
            UI.hideSaveCancel();
            UI.hideLockBadge();
            UI.updateDrawStatus('');

            // Le WebSocket mettra à jour les autres clients
            // Pas besoin de tout recharger (évite le cintillement)
        } catch (err) {
            console.error('Error saving polygon:', err);
            let errorMessage = 'Erreur inconnue';

            if (err.message && typeof err.message === 'string') {
                errorMessage = err.message;
            } else if (err.data && err.data.detail) {
                errorMessage = typeof err.data.detail === 'string'
                    ? err.data.detail
                    : JSON.stringify(err.data.detail);
            } else if (typeof err === 'string') {
                errorMessage = err;
            }

            UI.notify(`Erreur lors de l'enregistrement: ${errorMessage}`, 'error');
            // Rester en mode courant pour permettre la correction et une nouvelle tentative
            UI.updateDrawStatus('Corrigez la zone puis réessayez.');
            UI.showSaveCancel();
        }
    }

    /**
    * FLUX 5 : Supprimer une zone
     */
    async function deletePolygon() {
        const state = AppState.getState();
        if (!state.selectedObjectId) return;

        try {
            // TODO: Optionnel - exiger le verrou pour supprimer
            // Pour maintenant, supprimer directement

            await API.deleteMapObject(state.selectedObjectId);
            // Notification broadcastée par socket.js à tous les utilisateurs

            // Si on était en mode EDIT, nettoyer les couches d'édition
            if (state.mode === 'EDIT') {
                DRAW.clearDrawnLayers();
                DRAW.stopDrawMode();
            }

            // Revenir au mode VIEW et fermer le tiroir
            AppState.setViewMode();
            AppState.deselectObject();
            UI.closeDrawer();
            await refreshQuotaPanel();
            await loadMapObjects();
        } catch (err) {
            UI.notify(`Erreur lors de la suppression: ${err.message}`, 'error');
            console.error('Error deleting polygon:', err);
        }
    }

    /**
     * Annuler dessin/édition et revenir au mode VIEW
     */
    async function cancelEdit(skipReselect = false) {
        const state = AppState.getState();
        const wasEditingObjectId = state.selectedObjectId; // Sauvegarder avant de changer d'état

        // Si en édition, libérer le verrou (sauf si déjà libéré par update)
        // Libérer sans condition sur lockStatus, certains flux n'initialisent pas 'locked'
        if (state.mode === 'EDIT' && state.selectedObjectId) {
            try {
                await API.releaseObject(state.selectedObjectId);
            } catch (err) {
                console.warn('Error releasing lock:', err);
            }
        }

        // Nettoyer l'état
        AppState.setViewMode();
        // Quand on bascule d'une édition à une autre, enlever immédiatement la sélection
        AppState.deselectObject();
        UI.closeDrawer();
        DRAW.stopDrawMode();
        DRAW.clearDrawnLayers();
        UI.hideSaveCancel();
        UI.hideLockBadge();
        UI.updateDrawStatus('');

        // Réappliquer le style standard maintenant que rien n'est sélectionné
        restyleAllLayers();

        // Restaurer les polygones cachés avec le bon style immédiatement
        Object.keys(mapLayers).forEach((id) => {
            const layer = mapLayers[id];
            if (layer._isHidden) {
                // Appliquer le style normal AVANT de réafficher la couche
                layer.setStyle(getPolygonStyle(layer.objData));
                map.addLayer(layer);
                layer._isHidden = false;
            }
        });

        // Recharger les objets de la carte
        await loadMapObjects();

        if (!skipReselect && wasEditingObjectId) {
            try {
                const res = await API.getMapObject(wasEditingObjectId);
                if (res.success && res.data) {
                    const objData = res.data;
                    AppState.selectObject(objData);
                    if (mapLayers[wasEditingObjectId]) {
                        mapLayers[wasEditingObjectId].objData = objData;
                        mapLayers[wasEditingObjectId].setStyle(getPolygonStyle(objData));
                    }
                    UI.showDrawerDetails(objData);
                }
            } catch (err) {
                console.warn('Error fetching object after cancel:', err);
            }
        }
    }

    // API publique
    return {
        init,
        login,
        register,
        logout,
        loadMapObjects,
        startPolling,
        stopPolling,
        renderCoverageOnMap,
        highlightCoverageOnMap,
        clearCoverageOnMap: () => { if (coverageLayerGroup) coverageLayerGroup.clearLayers(); },
        cancelEdit,
        updateToolbarShellVisibility,
    };
})();

// Exposer APP globalement pour l'accès depuis UI
window.APP = APP;

// Initialiser au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    APP.init().catch(err => console.error('Initialization error:', err));
    // Coverage sheet wiring
    console.log('DOMContentLoaded: Setting up coverage button handler');
    const btnCoverage = document.getElementById('btn-coverage');
    console.log('btnCoverage element:', btnCoverage);
    const btnCoverageAdd = document.getElementById('coverage-add');
    console.log('btnCoverageAdd element:', btnCoverageAdd);
    const btnCoverageClose = document.getElementById('coverage-close');
    console.log('btnCoverageClose element:', btnCoverageClose);
    if (btnCoverage) {
        btnCoverage.addEventListener('click', async () => {
            console.log('Coverage button clicked');
            // Revenir en mode par défaut avant d'ouvrir Mes périmètres d'intervention
            const state = AppState.getState();
            if (state.mode === 'DRAW' || state.mode === 'EDIT') {
                await APP.cancelEdit(true);
            } else {
                AppState.setViewMode();
                AppState.deselectObject();
                UI.closeDrawer();
                DRAW.stopDrawMode();
                DRAW.clearDrawnLayers();
                UI.hideSaveCancel();
                UI.updateDrawStatus('');
            }

            console.log('Opening coverage sheet...');
            UI.openCoverageSheet();
            // Masquer la toolbar couverture pendant la gestion des périmètres
            const toolbarCoverage = document.getElementById('toolbar-coverage');
            if (toolbarCoverage) {
                toolbarCoverage.style.display = 'none';
            }
            // Masquer le bloc Créer pendant la gestion des périmètres
            const toolbarCreateShell = document.getElementById('toolbar-create')?.closest('.toolbar-shell');
            if (toolbarCreateShell) {
                toolbarCreateShell.style.display = 'none';
            }
            // Masquer le bloc Plafonds pendant la gestion des périmètres
            const quotaShell = document.getElementById('toolbar-quota')?.closest('.toolbar-shell');
            if (quotaShell) {
                quotaShell.style.display = 'none';
            }
            // Masquer les toolbar-shell vides
            APP.updateToolbarShellVisibility();
            // Afficher le message d'instruction dans le modal
            const coverageInstruction = document.getElementById('coverage-instruction');
            if (coverageInstruction) {
                coverageInstruction.innerHTML = `
                    <span style="display: block; line-height: 1.5;">
                    En définissant vos périmètres, vous acceptez d'être alerté lorsqu'un parapentiste 
                    s'y pose et de vérifier, dans la mesure du possible, que tout va bien.
                    </span>
                    <span style="display: block; margin-top: 10px; font-size: 13px; color: #888;">
                    Cliquez sur « Ajouter un périmètre » pour définir votre zone d'intervention.
                    </span>
                `;
            }
            try {
                console.log('Fetching coverage list...');
                const res = await API.listMyCoverage();
                console.log('Coverage list response:', res);
                const items = (res && res.data) || [];
                UI.renderCoverageList(items, (data) => APP.renderCoverageOnMap(data || []));
                APP.renderCoverageOnMap(items);
                console.log('Coverage list rendered');
            } catch (err) {
                console.error('Error loading coverage:', err);
                UI.renderCoverageList([]);
                APP.renderCoverageOnMap([]);
                console.warn('Failed to load coverage perimeters:', err);
            }
        });
    }
    if (btnCoverageClose) {
        btnCoverageClose.addEventListener('click', async () => {
            // Si un dessin de périmètre est en cours, l'arrêter d'abord
            if (window.map && window.map.pm && window.map.pm.globalDrawModeEnabled()) {
                window.map.pm.disableDraw();
            }
            UI.closeCoverageSheet();
            UI.updateDrawStatus('');
            // Restaurer la toolbar couverture
            const toolbarCoverage = document.getElementById('toolbar-coverage');
            if (toolbarCoverage && AppState.getState().isAuthenticated) {
                toolbarCoverage.style.display = 'flex';
            }
            // Restaurer le bloc Créer si authentifié
            const toolbarCreateShell = document.getElementById('toolbar-create')?.closest('.toolbar-shell');
            const toolbarCreate = document.getElementById('toolbar-create');
            const btnCreate = document.getElementById('btn-create');
            if (AppState.getState().isAuthenticated) {
                if (toolbarCreateShell) toolbarCreateShell.style.display = 'flex';
                if (toolbarCreate) toolbarCreate.style.display = 'flex';
                if (btnCreate) {
                    btnCreate.style.display = 'inline-block';
                    btnCreate.disabled = false;
                }
            }
            // Restaurer le bloc Plafonds si authentifié
            const quotaShell = document.getElementById('toolbar-quota')?.closest('.toolbar-shell');
            const quotaPanel = document.getElementById('toolbar-quota');
            if (AppState.getState().isAuthenticated) {
                if (quotaShell) quotaShell.style.display = 'flex';
                if (quotaPanel) quotaPanel.style.display = 'flex';
            }
            // Recharger les quotas pour réafficher le panneau
            try {
                if (AppState.getState().isAuthenticated) {
                    const q = await API.getMyQuota();
                    UI.updateQuotaPanel(q);
                } else {
                    UI.updateQuotaPanel(null);
                }
            } catch (e) {
                // Ne pas masquer les plafonds si l'appel échoue : garder l'affichage existant
                console.warn('Failed to reload quota after closing coverage', e);
            }
            // Restaurer la visibilité des toolbar-shell
            APP.updateToolbarShellVisibility();
            // Nettoyer les périmètres affichés
            APP.clearCoverageOnMap();
        });
    }
    if (btnCoverageAdd) {
        btnCoverageAdd.addEventListener('click', async () => {
            if (!window.map || !window.map.pm) {
                UI.notify("Outil de dessin indisponible", 'error');
                return;
            }
            // Indiquer à l'utilisateur qu'il peut dessiner
            UI.updateDrawStatus('Dessinez un périmètre de couverture sur la carte.');
            UI.notify('Cliquez pour dessiner un périmètre, puis terminez.', 'info');
            window.map.pm.enableDraw('Polygon', {
                snappable: true,
                allowSelfIntersection: false,
            });
            const onCreate = async (e) => {
                try {
                    const layer = e.layer;
                    const geo = layer.toGeoJSON().geometry;
                    await API.addCoverage(geo);
                    UI.notify('Périmètre ajouté', 'success');
                    // Retirer la couche temporaire dessinée (elle sera rechargée depuis l'API)
                    try {
                        if (layer && window.map && window.map.hasLayer(layer)) {
                            window.map.removeLayer(layer);
                        }
                    } catch (_) { /* ignore cleanup errors */ }
                    // Rafraîchir la liste et l'affichage carte
                    try {
                        const res = await API.listMyCoverage();
                        const items = (res && res.data) || [];
                        UI.renderCoverageList(items, (data) => APP.renderCoverageOnMap(data || []));
                        APP.renderCoverageOnMap(items);
                    } catch (err2) {
                        console.warn('Failed to refresh coverage list/map:', err2);
                    }
                } catch (err) {
                    const detail = err?.data?.detail || err?.message || 'Erreur inconnue';
                    const errorMsg = `Échec de l'ajout du périmètre: ${detail}`;
                    UI.notify(errorMsg, 'error');
                    console.error(err);
                    // Remove the temp layer if the add failed
                    try {
                        if (e?.layer && window.map && window.map.hasLayer(e.layer)) {
                            window.map.removeLayer(e.layer);
                        }
                    } catch (_) { /* ignore cleanup errors */ }
                } finally {
                    window.map.off('pm:create', onCreate);
                    window.map.pm.disableDraw('Polygon');
                    // Nettoyer le statut de dessin
                    UI.updateDrawStatus('');
                }
            };
            window.map.on('pm:create', onCreate);
        });
    }
});
