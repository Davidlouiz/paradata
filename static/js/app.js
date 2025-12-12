/**
 * Main App – Core application logic avec machine d'état AppState
 */

const APP = (() => {
    let map = null;
    let mapLayers = {}; // id -> Leaflet layer
    let stateUnsubscribe = null;

    /**
     * Initialiser l'application
     */
    async function init() {
        console.log('APP.init()');

        // Initialiser la carte
        map = L.map('map').setView([45.5, 6.0], 10); // Alpes françaises
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19,
        }).addTo(map);

        // Initialiser les modules
        DRAW.init(map);

        // Vérifier l'authentification
        await checkAuth();

        // Charger les objets de la carte
        await loadMapObjects();

        // Configurer les écouteurs d'état et d'événements
        setupStateListener();
        setupEventHandlers();

        // Initialiser l'affichage utilisateur
        const initialState = AppState.getState();
        UI.updateUserDisplay(initialState.currentUser);

        // Rafraîchir les objets de la carte toutes les 5 secondes (fallback WebSocket)
        setInterval(loadMapObjects, 5000);

        console.log('APP initialized');
    }

    /**
     * Vérifier l'authentification actuelle
     */
    async function checkAuth() {
        try {
            const user = await API.getMe();
            AppState.setCurrentUser(user);
        } catch (err) {
            AppState.setCurrentUser(null);
        }
    }

    /**
     * Se connecter
     */
    async function login(username, password) {
        const user = await API.login(username, password);
        AppState.setCurrentUser(user);
        UI.notify('Connecté!', 'success');
        // TODO: Authentifier sur Socket.IO si implémenté
    }

    /**
     * S'inscrire
     */
    async function register(username, password) {
        const user = await API.register(username, password);
        AppState.setCurrentUser(user);
        UI.notify('Compte créé! Vous êtes connecté.', 'success');
        // TODO: Authentifier sur Socket.IO si implémenté
    }

    /**
     * Se déconnecter
     */
    async function logout() {
        if (!await UI.confirm('Déconnexion', 'Êtes-vous sûr?')) {
            return;
        }

        try {
            await API.logout();
            AppState.setCurrentUser(null);
            UI.notify('Déconnecté!', 'success');
            AppState.deselectObject();
        } catch (err) {
            UI.notify(`Erreur: ${err.message}`, 'error');
        }
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

        // Effacer les couches non sélectionnées
        Object.keys(mapLayers).forEach((id) => {
            if (parseInt(id) !== state.selectedObjectId) {
                map.removeLayer(mapLayers[id]);
                delete mapLayers[id];
            }
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

        let color = '#999'; // Par défaut
        if (severity === 'CRITICAL') color = '#d32f2f';
        else if (severity === 'HIGH_RISK') color = '#f57c00';
        else if (severity === 'RISK') color = '#fbc02d';
        else if (severity === 'LOW_RISK') color = '#7cb342';
        else if (severity === 'SAFE') color = '#388e3c';

        return {
            color: isSelected ? '#000' : color,
            weight: isSelected ? 3 : 2,
            opacity: 0.8,
            fillOpacity: isLocked ? 0.3 : 0.5,
            dashArray: isLocked ? '5, 5' : undefined,
        };
    }

    /**
     * Sélectionner un polygone
     */
    function selectPolygon(obj, layer) {
        const state = AppState.getState();

        // Déselectionner le précédent
        if (state.selectedObjectId) {
            const oldLayer = mapLayers[state.selectedObjectId];
            if (oldLayer) {
                oldLayer.setStyle(getPolygonStyle(oldLayer.objData));
            }
        }

        // Sélectionner le nouveau
        AppState.selectObject(obj);
        layer.setStyle(getPolygonStyle(obj));

        // Afficher le panneau détails
        UI.showDrawerDetails(obj);
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
            const toolbar = document.getElementById('toolbar');
            if (toolbar) {
                toolbar.style.display = isAuth ? 'flex' : 'none';
            }

            // Mettre à jour les boutons Créer/Éditer/Supprimer selon sélection
            const btnEdit = document.getElementById('btn-edit');
            const btnDelete = document.getElementById('btn-delete');
            if (btnEdit && btnDelete) {
                const hasSelection = state.selectedObjectId !== null;
                const canEdit = state.isAuthenticated && hasSelection && AppState.canEditObject();
                btnEdit.disabled = !canEdit;
                btnDelete.disabled = !(state.isAuthenticated && hasSelection);
            }

            // Afficher/masquer le panneau latéral selon mode
            const drawer = document.getElementById('drawer');
            if (!state.selectedObjectId && state.mode === 'VIEW') {
                drawer?.classList.remove('open');
            }

            // Afficher le statut
            const statusInd = document.getElementById('status-indicator');
            if (statusInd) {
                statusInd.textContent = state.isAuthenticated ? 'Contributeur' : 'Lecture seule';
            }
        });
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

        // Bouton Éditer
        const btnEdit = document.getElementById('btn-edit');
        if (btnEdit) {
            btnEdit.addEventListener('click', startEdit);
        }

        // Bouton Supprimer
        const btnDelete = document.getElementById('btn-delete');
        if (btnDelete) {
            btnDelete.addEventListener('click', async () => {
                if (await UI.confirm('Supprimer', 'Êtes-vous sûr de supprimer ce polygone?')) {
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
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const state = AppState.getState();
                if (state.mode === 'DRAW' || state.mode === 'EDIT') {
                    cancelEdit();
                }
            }
        });
    }

    /**
     * FLUX 2 : Démarrer le mode CREATE (dessiner un nouveau polygone)
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
        UI.showDrawerForm(); // Affiche le formulaire vide
        UI.showSaveCancel();
    }

    /**
     * FLUX 3 : Démarrer le mode EDIT (éditer un polygone verrouillé)
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
                    `Cet objet est en cours d'édition par ${obj.locked_by_username}`,
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

            // Afficher le formulaire pré-rempli
            UI.showDrawerForm(obj);
            UI.showSaveCancel();

            // Afficher le badge de verrou avec timer
            startLockTimer();

            UI.notify('Objet verrouillé pour édition', 'success');
        } catch (err) {
            UI.notify(`Erreur lors de l'édition: ${err.message}`, 'error');
            console.error('Error starting edit:', err);
        }
    }

    /**
     * Démarrer un timer pour afficher le temps restant avant expiration du verrou
     */
    function startLockTimer() {
        const timerInterval = setInterval(() => {
            const state = AppState.getState();
            if (state.mode !== 'EDIT') {
                clearInterval(timerInterval);
                return;
            }

            const remaining = AppState.getLockExpirySeconds();
            if (remaining !== null) {
                UI.showLockBadge(remaining);
            }
        }, 1000);
    }

    /**
     * FLUX 2 & 3 : Enregistrer le polygone (créer ou mettre à jour)
     */
    async function savePolygon() {
        const state = AppState.getState();
        if (!state.isAuthenticated) {
            UI.notify('Vous devez être connecté', 'error');
            return;
        }

        // Valider la géométrie
        const geometry = DRAW.getDrawnGeometry();
        if (!DRAW.isValidDrawing() || !geometry) {
            UI.notify('Veuillez dessiner un polygone valide (au moins 3 points)', 'error');
            return;
        }

        // Lire les champs du formulaire
        const dangerTypeId = document.getElementById('form-danger-type').value;
        const severity = document.getElementById('form-severity').value;
        const description = document.getElementById('form-description').value;

        if (!dangerTypeId || !severity) {
            UI.notify('Veuillez remplir tous les champs obligatoires', 'error');
            return;
        }

        try {
            UI.updateDrawStatus('Enregistrement...');

            if (state.mode === 'DRAW') {
                // Créer un nouveau polygone
                const res = await API.createMapObject({
                    geometry,
                    danger_type_id: parseInt(dangerTypeId),
                    severity,
                    description,
                });
                UI.notify('Polygone créé!', 'success');
                console.log('Object created:', res.data);
            } else if (state.mode === 'EDIT') {
                // Mettre à jour un polygone existant
                const res = await API.updateMapObject(state.selectedObjectId, {
                    geometry,
                    danger_type_id: parseInt(dangerTypeId),
                    severity,
                    description,
                });
                UI.notify('Polygone mis à jour!', 'success');
                console.log('Object updated:', res.data);

                // Libérer le verrou
                await API.releaseObject(state.selectedObjectId);
            }

            // Nettoyer et revenir au mode VIEW
            cancelEdit();
            await loadMapObjects();
        } catch (err) {
            UI.notify(`Erreur lors de l'enregistrement: ${err.message}`, 'error');
            console.error('Error saving polygon:', err);
        }
    }

    /**
     * FLUX 5 : Supprimer un polygone
     */
    async function deletePolygon() {
        const state = AppState.getState();
        if (!state.selectedObjectId) return;

        try {
            // TODO: Optionnel - exiger le verrou pour supprimer
            // Pour maintenant, supprimer directement

            await API.deleteMapObject(state.selectedObjectId);
            UI.notify('Polygone supprimé!', 'success');
            AppState.deselectObject();
            await loadMapObjects();
        } catch (err) {
            UI.notify(`Erreur lors de la suppression: ${err.message}`, 'error');
            console.error('Error deleting polygon:', err);
        }
    }

    /**
     * Annuler dessin/édition et revenir au mode VIEW
     */
    async function cancelEdit() {
        const state = AppState.getState();

        // Si en édition, libérer le verrou
        if (state.mode === 'EDIT' && state.selectedObjectId) {
            try {
                await API.releaseObject(state.selectedObjectId);
            } catch (err) {
                console.warn('Error releasing lock:', err);
            }
        }

        // Nettoyer l'état
        AppState.setViewMode();
        DRAW.stopDrawMode();
        UI.hideSaveCancel();
        UI.hideLockBadge();
        UI.updateDrawStatus('');

        // Maintenir la sélection si elle existe, mais désactiver l'édition
        const remainingState = AppState.getState();
        if (remainingState.selectedObjectId) {
            // Le polygone reste sélectionné mais pas en édition
            document.getElementById('drawer').classList.add('open');
            loadMapObjects(); // Rafraîchir le style
        }
    }

    // API publique
    return {
        init,
        login,
        register,
        logout,
        loadMapObjects,
    };
})();

// Initialiser au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    APP.init().catch(err => console.error('Initialization error:', err));
});
