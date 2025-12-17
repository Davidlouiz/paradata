/**
 * Main App – Core application logic avec machine d'état AppState
 */

const APP = (() => {
    let map = null;
    let quotaHoldActive = false; // Affiche les plafonds uniquement quand Q est enfoncée
    let zoneLayers = {}; // id -> Leaflet layer
    let stateUnsubscribe = null;
    let pollingIntervalId = null;

    /**
     * Initialiser l'application
     */
    async function init() {
        console.log('APP.init()');

        // Charger les types de zones disponibles au démarrage
        try {
            const res = await API.getZoneTypes();
            if (res.success && res.data) {
                AppState.setZoneTypes(res.data);
                if (typeof UI !== 'undefined' && typeof UI.setZoneTypes === 'function') {
                    UI.setZoneTypes(res.data);
                }
            }
        } catch (err) {
            console.warn('Failed to load zone types:', err);
        }

        // Initialiser la carte
        map = L.map('map').setView([45.5, 6.0], 10); // Alpes françaises
        window.map = map; // Expose pour la feuille "Mes périmètres"
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19,
        }).addTo(map);

        // Add map scale (metric only, bottom-right)
        try {
            L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(map);
        } catch (e) {
            console.warn('Failed to add scale control:', e);
        }

        // Initialiser les modules
        DRAW.init(map);

        // Périmètres d'intervention supprimés: pas de couche dédiée

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

        // Appliquer l'état initial immédiatement
        const initialState = AppState.getState();
        applyQuotaVisibility();
        const toolbarCreate = document.getElementById('toolbar-create');
        if (toolbarCreate) {
            toolbarCreate.style.display = initialState.isAuthenticated ? 'flex' : 'none';
        }
        const btnCreate = document.getElementById('btn-create');
        if (btnCreate) {
            btnCreate.style.display = initialState.isAuthenticated ? 'inline-block' : 'none';
            btnCreate.disabled = initialState.mode === 'DRAW' || initialState.mode === 'EDIT';
        }
        // S'assurer que le statut de toolbar est caché s'il est vide
        if (typeof UI !== 'undefined') {
            UI.updateDrawStatus('');
            // Initialiser l'affichage utilisateur
            UI.updateUserDisplay(initialState.currentUser);
        }

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
    // Fonctions de rendu des périmètres supprimées

    async function refreshQuotaPanel() {
        if (typeof UI === 'undefined') {
            // UI non chargé: ignorer l'affichage, la logique de quota reste côté API
            return;
        }
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
     * Obtenir la couleur d'une zone via zone types
     */
    function getColorByZoneType(zoneType) {
        const state = AppState.getState();
        const zone = state.zoneTypes?.find(t => t.code === zoneType);
        if (zone) return zone.color;
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

            const res = await API.listZones(bbox);
            renderZones(res.data || []);
        } catch (err) {
            console.error('Error loading map objects:', err);
        }
    }

    /**
     * Afficher les objets sur la carte
     */
    function renderZones(objects) {
        const state = AppState.getState();

        // Si on est en édition, ne pas recharger la zone en cours d'édition
        if (state.mode === 'EDIT') {
            // Mettre à jour SEULEMENT les autres zones
            const editingObjectId = state.selectedObjectId;
            const objectsToUpdate = objects.filter(obj => obj.id !== editingObjectId);

            // Supprimer les couches non éditées qui ne sont plus dans les données
            Object.keys(zoneLayers).forEach((id) => {
                const intId = parseInt(id);
                if (intId !== editingObjectId && !objectsToUpdate.find(obj => obj.id === intId)) {
                    map.removeLayer(zoneLayers[id]);
                    delete zoneLayers[id];
                }
            });

            // Ajouter/mettre à jour les autres zones
            objectsToUpdate.forEach((obj) => {
                if (!zoneLayers[obj.id]) {
                    renderZone(obj);
                }
            });
            // Mettre à jour le compteur avec le nombre total visible (hors supprimés)
            updateMapCounter(objects.length);
            return; // Arrêter ici, ne pas recharger l'objet en édition
        }

        // Mode normal : Effacer toutes les couches et rafraîchir
        Object.keys(zoneLayers).forEach((id) => {
            map.removeLayer(zoneLayers[id]);
            delete zoneLayers[id];
        });

        // Ajouter les nouvelles couches
        objects.forEach((obj) => {
            if (!zoneLayers[obj.id]) {
                renderZone(obj);
            }
        });

        // Mettre à jour le compteur avec le nombre total visible
        updateMapCounter(objects.length);
    }

    /**
     * Afficher un objet sur la carte
     */
    function renderZone(obj) {
        if (!obj.geometry) return;

        try {
            const layer = L.geoJSON(obj.geometry, {
                style: () => getPolygonStyle(obj),
                onEachFeature: (feature, layer) => {
                    layer.on('click', () => selectZone(obj, layer));
                },
            });

            layer.addTo(map);
            layer.objData = obj;
            zoneLayers[obj.id] = layer;
        } catch (err) {
            console.error('Error rendering polygon:', err, obj);
        }
    }

    /**
     * Mettre à jour le compteur en haut de la carte
     */
    function updateMapCounter(count) {
        try {
            const el = document.getElementById('map-counter');
            if (!el) return;
            const n = typeof count === 'number' ? count : Object.keys(zoneLayers).length;
            if (n > 0) {
                el.textContent = `${n} zone${n > 1 ? 's' : ''} répertoriée${n > 1 ? 's' : ''}`;
                el.style.display = 'block';
            } else {
                el.style.display = 'none';
            }
        } catch (e) {
            console.warn('Failed updating map counter:', e);
        }
    }

    /**
     * Obtenir le style du polygone selon son état
     */
    function getPolygonStyle(obj) {
        const state = AppState.getState();
        const isSelected = obj.id === state.selectedObjectId;
        const isLocked = obj.locked_by;
        const zone_type = obj.zone_type;

        const color = getColorByZoneType(zone_type);

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
        Object.values(zoneLayers).forEach((layer) => {
            if (layer?.objData) {
                layer.setStyle(getPolygonStyle(layer.objData));
            }
        });
    }

    /**
    * Sélectionner une zone
     */
    function selectZone(obj, layer) {
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
            const oldLayer = zoneLayers[state.selectedObjectId];
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
            if (typeof UI !== 'undefined') {
                UI.updateUserDisplay(state.currentUser);
            }

            // Mettre à jour la visibilité des contrôles
            const isAuth = state.isAuthenticated;
            const shellContainer = document.getElementById('toolbar-shell-container');
            if (shellContainer) {
                shellContainer.style.display = isAuth ? 'flex' : 'none';
            }

            // Visibilité des plafonds gérée uniquement par la touche Q
            applyQuotaVisibility();

            const toolbarCreate = document.getElementById('toolbar-create');
            if (toolbarCreate) {
                toolbarCreate.style.display = isAuth ? 'flex' : 'none';
            }

            const btnCreate = document.getElementById('btn-create');
            if (btnCreate) {
                btnCreate.style.display = isAuth ? 'inline-block' : 'none';
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
     * Afficher/masquer le panneau Plafonds selon: touche Q, auth, modale
     */
    function applyQuotaVisibility() {
        // Sécurité: si UI n'est pas encore chargé, on ne fait rien
        if (typeof UI === 'undefined') return;

        const isAuth = AppState.getState().isAuthenticated;
        const quotaModal = document.getElementById('quota-modal');
        const isQuotaModalOpen = quotaModal && quotaModal.style.display === 'flex';
        const allowed = (quotaHoldActive || isQuotaModalOpen) && isAuth;
        if (typeof UI.setQuotaPanelVisible === 'function') {
            UI.setQuotaPanelVisible(allowed);
        } else {
            const panel = document.getElementById('toolbar-quota');
            const shell = panel?.closest('.toolbar-shell');
            if (panel) panel.style.display = allowed ? 'flex' : 'none';
            if (shell) shell.style.display = allowed ? 'flex' : 'none';
        }
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
        // Affichage temporaire des plafonds avec F8 (maintenir pour afficher)
        document.addEventListener('keydown', async (e) => {
            if (e.key === 'F8') {
                e.preventDefault(); // Empêcher le comportement par défaut
                if (!quotaHoldActive) {
                    quotaHoldActive = true;
                    applyQuotaVisibility();
                    try {
                        // Rafraîchir les valeurs quand on affiche
                        if (AppState.getState().isAuthenticated) {
                            const q = await API.getMyQuota();
                            if (typeof UI !== 'undefined') {
                                UI.updateQuotaPanel(q);
                            }
                        }
                    } catch (_) {/* silent */ }
                }
            }
        });
        document.addEventListener('keyup', (e) => {
            // Cacher dès qu'on relâche F8
            if (e.key === 'F8' && quotaHoldActive) {
                quotaHoldActive = false;
                applyQuotaVisibility();
            }
        });
        window.addEventListener('blur', () => {
            if (quotaHoldActive) {
                quotaHoldActive = false;
                applyQuotaVisibility();
            }
        });
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
        const formZoneType = document.getElementById('form-zone-type');
        if (formZoneType) {
            formZoneType.addEventListener('change', (e) => {
                DRAW.updateEditingPolygonColor(e.target.value);
                if (typeof UI !== 'undefined' && typeof UI.updateZoneTypeDescription === 'function') {
                    UI.updateZoneTypeDescription(e.target.value);
                }
            });
        }

        // Fermer le drawer en cliquant sur le fond de la carte
        map.on('click', (e) => {
            if (e.originalEvent.target.id === 'map') {
                const state = AppState.getState();
                if (state.mode === 'VIEW') {
                    AppState.deselectObject();
                    restyleAllLayers();
                    document.getElementById('drawer').classList.remove('open');
                }
            }
        });

        // Échap pour annuler dessin/édition
        document.addEventListener('keydown', async (e) => {
            if (e.key !== 'Escape') return;
            const state = AppState.getState();
            if (state.mode === 'DRAW' || state.mode === 'EDIT') {
                cancelEdit(true); // Ne pas ré-sélectionner
            } else if (state.selectedObjectId !== null) {
                AppState.deselectObject();
                restyleAllLayers();
                UI.closeDrawer();
            }
        });

        // Auth: gestion modale et formulaires
        const btnCloseAuth = document.getElementById('btn-close-auth');
        if (btnCloseAuth) {
            btnCloseAuth.addEventListener('click', (e) => {
                e.preventDefault();
                UI.hideLoginModal();
            });
        }

        const btnToggleRegister = document.getElementById('btn-toggle-register');
        if (btnToggleRegister) {
            btnToggleRegister.addEventListener('click', (e) => {
                e.preventDefault();
                const loginForm = document.getElementById('login-form');
                const registerForm = document.getElementById('register-form');
                if (loginForm) loginForm.style.display = 'none';
                if (registerForm) registerForm.style.display = 'block';
                const regUser = document.getElementById('register-username');
                regUser?.focus();
            });
        }

        const btnToggleLogin = document.getElementById('btn-toggle-login');
        if (btnToggleLogin) {
            btnToggleLogin.addEventListener('click', (e) => {
                e.preventDefault();
                const loginForm = document.getElementById('login-form');
                const registerForm = document.getElementById('register-form');
                if (loginForm) loginForm.style.display = 'block';
                if (registerForm) registerForm.style.display = 'none';
                const userEl = document.getElementById('login-username');
                userEl?.focus();
            });
        }

        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('login-username')?.value.trim();
                const password = document.getElementById('login-password')?.value;
                if (!username || !password) {
                    UI.showAuthMessage('Identifiants manquants', true);
                    return;
                }
                try {
                    await login(username, password);
                    UI.hideLoginModal();
                } catch (err) {
                    UI.showAuthMessage(err?.message || 'Connexion impossible', true);
                }
            });
        }

        const registerForm = document.getElementById('register-form');
        if (registerForm) {
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('register-username')?.value.trim();
                const password = document.getElementById('register-password')?.value;
                const confirm = document.getElementById('register-password-confirm')?.value;
                if (!username || !password) {
                    UI.showAuthMessage('Champs requis manquants', true);
                    return;
                }
                if (password !== confirm) {
                    UI.showAuthMessage('Les mots de passe ne correspondent pas', true);
                    return;
                }
                try {
                    await register(username, password);
                    UI.hideLoginModal();
                } catch (err) {
                    UI.showAuthMessage(err?.message || 'Inscription impossible', true);
                }
            });
        }

        // (F8 géré via les écouteurs keydown/keyup ci-dessus)
    }

    /**
    * FLUX 2 : Démarrer le mode CREATE (dessiner une nouvelle zone)
     */
    function startCreate() {
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
            if (zoneLayers[obj.id]) {
                const layer = zoneLayers[obj.id];
                // Appliquer le style normal (sans sélection) avant de cacher
                layer.setStyle({
                    color: getColorByZoneType(obj.zone_type),
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
            const formZoneType = document.getElementById('form-zone-type');
            if (formZoneType && formZoneType.value) {
                DRAW.updateEditingPolygonColor(formZoneType.value);
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
            const currentZoneType = document.getElementById('form-zone-type').value;
            const currentDescription = document.getElementById('form-description').value;

            // Vérifier si la sévérité ou description a changé
            if (original.zone_type !== currentZoneType || original.description !== currentDescription) {
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
        const zone_type = document.getElementById('form-zone-type').value;
        const description = document.getElementById('form-description').value;

        if (!zone_type) {
            UI.notify('Veuillez remplir tous les champs obligatoires', 'error');
            return;
        }

        try {
            UI.updateDrawStatus('Enregistrement...');

            let savedObjectData = null;

            if (state.mode === 'DRAW') {
                // Créer une nouvelle zone
                const res = await API.createZone({
                    geometry,
                    zone_type,
                    description,
                });
                await refreshQuotaPanel();
                UI.updateDrawStatus(''); // Vider avant affichage toast
                UI.notify('Zone créée!', 'success');
                console.log('Object created:', res.data);
                savedObjectData = res.data;
            } else if (state.mode === 'EDIT') {
                // Mettre à jour une zone existante
                const res = await API.updateZone(state.selectedObjectId, {
                    geometry,
                    zone_type,
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
                const editedLayer = zoneLayers[state.selectedObjectId];
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
            Object.keys(zoneLayers).forEach((id) => {
                const layer = zoneLayers[id];
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

            await API.deleteZone(state.selectedObjectId);
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
        // Sécurité : désactiver tout mode de dessin Geoman en cours
        if (window.map && window.map.pm && window.map.pm.globalDrawModeEnabled()) {
            window.map.pm.disableDraw();
        }
        // Sécurité : désactiver les modes d'édition/suppression Geoman au cas où
        if (window.map && window.map.pm && window.map.pm.globalEditModeEnabled()) {
            window.map.pm.disableGlobalEditMode();
        }
        if (window.map && window.map.pm && window.map.pm.globalRemovalModeEnabled()) {
            window.map.pm.disableGlobalRemovalMode();
        }
        DRAW.stopDrawMode();
        DRAW.clearDrawnLayers();
        UI.hideSaveCancel();
        UI.hideLockBadge();
        UI.updateDrawStatus('');

        // Réappliquer le style standard maintenant que rien n'est sélectionné
        restyleAllLayers();

        // Restaurer les polygones cachés avec le bon style immédiatement
        Object.keys(zoneLayers).forEach((id) => {
            const layer = zoneLayers[id];
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
                    if (zoneLayers[wasEditingObjectId]) {
                        zoneLayers[wasEditingObjectId].objData = objData;
                        zoneLayers[wasEditingObjectId].setStyle(getPolygonStyle(objData));
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
        cancelEdit,
        updateToolbarShellVisibility,
        applyQuotaVisibility,
    };
})();

// Exposer APP globalement pour l'accès depuis UI
window.APP = APP;

// Initialiser au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    APP.init().catch(err => console.error('Initialization error:', err));
});
