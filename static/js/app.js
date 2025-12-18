/**
 * Main App – Core application logic avec machine d'état AppState
 */

const APP = (() => {
    let map = null;
    let quotaHoldActive = false; // Affiche les plafonds uniquement quand Q est enfoncée
    let counterHoldActive = false; // Affiche le compteur de zones uniquement quand F8 est enfoncée
    let zoneLayers = {}; // id -> Leaflet layer
    let stateUnsubscribe = null;
    let pollingIntervalId = null;
    let lastHitZoneIds = [];
    let lastHitIndex = -1;

    /**
     * Ajouter le contrôle de géolocalisation
     */
    function addGeolocateControl() {
        const GeolocateControl = L.Control.extend({
            options: {
                position: 'bottomright'
            },
            onAdd: function (map) {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
                const button = L.DomUtil.create('a', 'leaflet-control-geolocate', container);
                button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="6"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';
                button.href = '#';
                button.title = 'Me localiser';
                button.setAttribute('role', 'button');
                button.setAttribute('aria-label', 'Me localiser');

                L.DomEvent.disableClickPropagation(button);
                L.DomEvent.on(button, 'click', function (e) {
                    L.DomEvent.preventDefault(e);
                    geolocateUser(button);
                });

                return container;
            }
        });

        map.addControl(new GeolocateControl());
    }

    /**
     * Géolocaliser l'utilisateur et recentrer la carte
     */
    function geolocateUser(button) {
        if (!navigator.geolocation) {
            alert('La géolocalisation n\'est pas supportée par votre navigateur.');
            return;
        }

        button.classList.add('loading');

        navigator.geolocation.getCurrentPosition(
            (position) => {
                button.classList.remove('loading');
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const accuracy = position.coords.accuracy;

                // Recentrer la carte sur la position
                map.setView([lat, lng], 14);

                // Ajouter un marqueur temporaire
                const marker = L.marker([lat, lng], {
                    icon: L.divIcon({
                        className: 'user-location-marker',
                        html: '<div style="background: #4285F4; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>',
                        iconSize: [22, 22],
                        iconAnchor: [11, 11]
                    })
                }).addTo(map);

                // Ajouter un cercle de précision
                const circle = L.circle([lat, lng], {
                    radius: accuracy,
                    color: '#4285F4',
                    fillColor: '#4285F4',
                    fillOpacity: 0.1,
                    weight: 1
                }).addTo(map);

                // Retirer le marqueur et le cercle après 10 secondes
                setTimeout(() => {
                    map.removeLayer(marker);
                    map.removeLayer(circle);
                }, 10000);
            },
            (error) => {
                button.classList.remove('loading');
                let message = 'Impossible de vous localiser.';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        message = 'Accès à la position refusé.\n\n';
                        if (location.protocol === 'http:' && location.hostname !== 'localhost') {
                            message += '⚠️ La géolocalisation nécessite HTTPS (connexion sécurisée).\n\n';
                        }
                        message += 'Vérifiez les permissions de votre navigateur pour autoriser la géolocalisation.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = 'Position indisponible. Vérifiez que le GPS est activé.';
                        break;
                    case error.TIMEOUT:
                        message = 'La demande de localisation a expiré. Réessayez.';
                        break;
                }
                alert(message);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    }

    /**
     * Charger un challenge CAPTCHA depuis le serveur
     */
    async function loadCaptcha() {
        try {
            const challenge = await API.getCaptchaChallenge();
            window._currentCaptchaToken = challenge.token;
            const questionEl = document.getElementById('captcha-question');
            if (questionEl) {
                questionEl.textContent = challenge.question + ' = ?';
            }
            const answerEl = document.getElementById('captcha-answer');
            if (answerEl) {
                answerEl.value = '';
                answerEl.focus();
            }
        } catch (err) {
            console.error('Erreur chargement CAPTCHA:', err);
            UI.notify('Erreur de chargement du CAPTCHA', 'error');
        }
    }

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
        map = L.map('map');

        // Lecture éventuelle de la vue depuis l'URL (format: #map=zoom/lat/lng)
        const parseViewFromURL = () => {
            try {
                const h = window.location.hash || '';
                const m = h.match(/#map=(\d{1,2})\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
                if (!m) return null;
                let zoom = parseInt(m[1], 10);
                let lat = parseFloat(m[2]);
                let lng = parseFloat(m[3]);
                // Clamp raisonnable
                if (!Number.isFinite(zoom)) zoom = 10;
                if (!Number.isFinite(lat)) lat = 45.5;
                if (!Number.isFinite(lng)) lng = 6.0;
                zoom = Math.max(1, Math.min(19, zoom));
                lat = Math.max(-90, Math.min(90, lat));
                lng = Math.max(-180, Math.min(180, lng));
                return { zoom, lat, lng };
            } catch (_) {
                return null;
            }
        };

        const defaultCenter = [45.5, 6.0]; // Alpes françaises
        const defaultZoom = 10;
        const initialView = parseViewFromURL();
        if (initialView) {
            map.setView([initialView.lat, initialView.lng], initialView.zoom);
        } else {
            map.setView(defaultCenter, defaultZoom);
        }
        window.map = map; // Expose pour la feuille "Mes périmètres"
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19,
        }).addTo(map);

        // Mettre à jour l'URL quand la vue change
        const updateURLFromMapView = () => {
            try {
                const center = map.getCenter();
                const zoom = map.getZoom();
                const hash = `#map=${zoom}/${center.lat.toFixed(5)}/${center.lng.toFixed(5)}`;
                const url = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
                window.history.replaceState(null, '', url);
            } catch (_) { /* silent */ }
        };
        map.on('moveend', updateURLFromMapView);
        map.on('zoomend', updateURLFromMapView);
        // Écrire l'état initial dans l'URL si absent
        if (!initialView) {
            updateURLFromMapView();
        }

        // Add map scale (metric only, bottom-right)
        try {
            L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(map);
        } catch (e) {
            console.warn('Failed to add scale control:', e);
        }

        // Add geolocate control (top-right)
        addGeolocateControl();

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
            if (n > 0 && counterHoldActive) {
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

    function ringContainsPoint(ring, point) {
        if (!Array.isArray(ring) || ring.length < 3) return false;
        const [x, y] = point;
        let inside = false;

        for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
            const xi = ring[i][0];
            const yi = ring[i][1];
            const xj = ring[j][0];
            const yj = ring[j][1];
            const intersects = ((yi > y) !== (yj > y))
                && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
            if (intersects) inside = !inside;
        }

        return inside;
    }

    function polygonContainsPoint(rings, point) {
        if (!Array.isArray(rings) || rings.length === 0) return false;
        if (!ringContainsPoint(rings[0], point)) return false;

        for (let i = 1; i < rings.length; i += 1) {
            if (ringContainsPoint(rings[i], point)) return false; // Dans un trou
        }

        return true;
    }

    function geometryContainsPoint(geometry, latlng) {
        if (!geometry || !latlng) return false;
        const point = [latlng.lng, latlng.lat];

        if (geometry.type === 'Polygon') {
            return polygonContainsPoint(geometry.coordinates, point);
        }

        if (geometry.type === 'MultiPolygon') {
            return geometry.coordinates.some(poly => polygonContainsPoint(poly, point));
        }

        return false;
    }

    function computeRingArea(ring) {
        if (!Array.isArray(ring) || ring.length < 3) return 0;
        let area = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
            const xi = ring[i][0];
            const yi = ring[i][1];
            const xj = ring[j][0];
            const yj = ring[j][1];
            area += (xj * yi) - (xi * yj);
        }
        return Math.abs(area) / 2;
    }

    function computePolygonArea(rings) {
        if (!Array.isArray(rings) || rings.length === 0) return 0;
        const outer = computeRingArea(rings[0]);
        const holes = rings.slice(1).reduce((sum, ring) => sum + computeRingArea(ring), 0);
        return Math.max(0, outer - holes);
    }

    function computeGeometryArea(geometry) {
        if (!geometry) return 0;
        if (geometry.type === 'Polygon') {
            return computePolygonArea(geometry.coordinates);
        }
        if (geometry.type === 'MultiPolygon') {
            return geometry.coordinates.reduce((sum, poly) => sum + computePolygonArea(poly), 0);
        }
        return 0;
    }

    function getZonesAtPoint(latlng) {
        const hits = [];
        Object.values(zoneLayers).forEach((layer) => {
            const obj = layer?.objData;
            if (!obj?.geometry) return;
            if (geometryContainsPoint(obj.geometry, latlng)) {
                hits.push({ obj, area: computeGeometryArea(obj.geometry) });
            }
        });

        return hits
            .sort((a, b) => {
                if (a.area === b.area) {
                    return Number(a.obj.id) - Number(b.obj.id);
                }
                return a.area - b.area;
            })
            .map(item => item.obj);
    }

    function areSameZoneList(idsA, idsB) {
        if (!Array.isArray(idsA) || !Array.isArray(idsB)) return false;
        if (idsA.length !== idsB.length) return false;
        for (let i = 0; i < idsA.length; i += 1) {
            if (idsA[i] !== idsB[i]) return false;
        }
        return true;
    }

    function resetAmbiguityCycle() {
        lastHitZoneIds = [];
        lastHitIndex = -1;
    }

    function pickZoneFromCycle(zones) {
        const currentIds = zones.map(z => z.id);
        const sameList = areSameZoneList(currentIds, lastHitZoneIds);

        if (!sameList) {
            lastHitZoneIds = currentIds;
            lastHitIndex = 0;
            return zones[0];
        }

        lastHitIndex = (lastHitIndex + 1) % zones.length;
        return zones[lastHitIndex];
    }

    async function handleMapClick(e) {
        if (!e?.latlng) return;
        const state = AppState.getState();

        // Bloquer les clics pendant le déplacement d'un sommet
        if (state.isDraggingVertex) {
            return;
        }

        // Bloquer les clics immédiatement après le relâchement d'un sommet
        // pour éviter que la souris ne sélectionne un autre polygone
        if (state.justReleasedVertex) {
            return;
        }

        if (state.mode === 'DRAW') {
            return; // Ne pas interrompre le dessin
        }

        const zonesAtPoint = getZonesAtPoint(e.latlng);

        if (zonesAtPoint.length === 0) {
            resetAmbiguityCycle();
            if (state.mode === 'VIEW') {
                AppState.deselectObject();
                restyleAllLayers();
                document.getElementById('drawer')?.classList.remove('open');
            }
            return;
        }

        const targetZone = pickZoneFromCycle(zonesAtPoint);
        const targetLayer = zoneLayers[targetZone.id];
        selectZone(targetZone, targetLayer);
    }

    /**
    * Sélectionner une zone
     */
    function selectZone(obj, layer) {
        const state = AppState.getState();

        const resolvedLayer = layer || zoneLayers[obj.id];

        // Ignorer les clics pendant le dessin d'une nouvelle zone
        if (state.mode === 'DRAW') {
            return;
        }

        if (state.mode === 'EDIT' && state.selectedObjectId === obj.id) {
            return; // Déjà en édition de cette zone
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
            resolvedLayer?.setStyle(getPolygonStyle(obj));
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

        // Afficher/masquer le lien de gestion des types de zone
        const zoneTypesLink = document.getElementById('zone-types-manage-link');
        const zoneTypesModal = document.getElementById('zone-types-modal');
        const isZoneTypesModalOpen = zoneTypesModal && zoneTypesModal.style.display === 'flex';
        const showLink = (quotaHoldActive || isZoneTypesModalOpen) && isAuth;
        if (zoneTypesLink) {
            zoneTypesLink.style.visibility = showLink ? 'visible' : 'hidden';
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
            // Affichage du compteur de zones avec F8
            if (e.key === 'F8') {
                e.preventDefault();
                if (!counterHoldActive) {
                    counterHoldActive = true;
                    updateMapCounter();
                }
            }
        });
        document.addEventListener('keyup', (e) => {
            // Cacher dès qu'on relâche F8
            if (e.key === 'F8' && quotaHoldActive) {
                quotaHoldActive = false;
                applyQuotaVisibility();
            }
            // Cacher le compteur dès qu'on relâche F8
            if (e.key === 'F8' && counterHoldActive) {
                counterHoldActive = false;
                updateMapCounter();
            }
        });
        window.addEventListener('blur', () => {
            if (quotaHoldActive) {
                quotaHoldActive = false;
                applyQuotaVisibility();
            }
            if (counterHoldActive) {
                counterHoldActive = false;
                updateMapCounter();
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

        // Sélection/cycle des zones en cliquant sur la carte
        map.on('click', async (e) => {
            await handleMapClick(e);
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
            btnToggleRegister.addEventListener('click', async (e) => {
                e.preventDefault();
                const loginForm = document.getElementById('login-form');
                const registerForm = document.getElementById('register-form');
                if (loginForm) loginForm.style.display = 'none';
                if (registerForm) registerForm.style.display = 'block';

                // Initialize Step 1: Generate recovery key
                await startRecoveryKeyRegistration();
            });
        }

        const btnToggleLogin = document.getElementById('btn-toggle-login');
        if (btnToggleLogin) {
            btnToggleLogin.addEventListener('click', (e) => {
                e.preventDefault();
                const loginForm = document.getElementById('login-form');
                const registerForm = document.getElementById('register-form');
                const recoverForm = document.getElementById('recover-form');
                if (loginForm) loginForm.style.display = 'block';
                if (registerForm) registerForm.style.display = 'none';
                if (recoverForm) recoverForm.style.display = 'none';
                const userEl = document.getElementById('login-username');
                userEl?.focus();
            });
        }

        // ========== PASSWORD RECOVERY FLOW ==========

        const btnToggleRecover = document.getElementById('btn-toggle-recover');
        if (btnToggleRecover) {
            btnToggleRecover.addEventListener('click', (e) => {
                e.preventDefault();
                const loginForm = document.getElementById('login-form');
                const registerForm = document.getElementById('register-form');
                const recoverForm = document.getElementById('recover-form');
                if (loginForm) loginForm.style.display = 'none';
                if (registerForm) registerForm.style.display = 'none';
                if (recoverForm) recoverForm.style.display = 'block';
                const usernameEl = document.getElementById('recover-username');
                usernameEl?.focus();
            });
        }

        const btnRecoverBack = document.getElementById('btn-recover-back');
        if (btnRecoverBack) {
            btnRecoverBack.addEventListener('click', (e) => {
                e.preventDefault();
                const loginForm = document.getElementById('login-form');
                const recoverForm = document.getElementById('recover-form');
                if (loginForm) loginForm.style.display = 'block';
                if (recoverForm) recoverForm.style.display = 'none';
                const userEl = document.getElementById('login-username');
                userEl?.focus();
            });
        }

        const recoverForm = document.getElementById('recover-form');
        if (recoverForm) {
            recoverForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const recoveryKey = document.getElementById('recover-key')?.value.trim();
                const newUsername = document.getElementById('recover-new-username')?.value.trim();
                const newPassword = document.getElementById('recover-new-password')?.value;
                const confirmPassword = document.getElementById('recover-new-password-confirm')?.value;

                if (!recoveryKey || !newUsername || !newPassword) {
                    UI.showAuthMessage('Tous les champs sont requis', true);
                    return;
                }

                if (newPassword !== confirmPassword) {
                    UI.showAuthMessage('Les mots de passe ne correspondent pas', true);
                    return;
                }

                if (newPassword.length < 6) {
                    UI.showAuthMessage('Le mot de passe doit contenir au moins 6 caractères', true);
                    return;
                }

                if (newUsername.length < 3) {
                    UI.showAuthMessage('Le nom d\'utilisateur doit contenir au moins 3 caractères', true);
                    return;
                }

                try {
                    const userData = await API.recoverPassword(recoveryKey, newUsername, newPassword);

                    AppState.setCurrentUser(userData);
                    UI.notify('Compte récupéré! Pseudo et mot de passe redéfinis. Vous êtes connecté.', 'success');
                    await refreshQuotaPanel();

                    const state = AppState.getState();
                    if (state.mode !== 'VIEW') {
                        await cancelEdit(true);
                    }
                    AppState.deselectObject();
                    restyleAllLayers();

                    UI.hideLoginModal();

                    // Clear form
                    document.getElementById('recover-key').value = '';
                    document.getElementById('recover-new-username').value = '';
                    document.getElementById('recover-new-password').value = '';
                    document.getElementById('recover-new-password-confirm').value = '';
                } catch (err) {
                    UI.showAuthMessage(err?.message || 'Récupération impossible. Vérifiez votre clé.', true);
                }
            });
        }

        // ========== RECOVERY KEY REGISTRATION FLOW ==========

        // Store session data for multi-step registration
        window._recoveryKeySession = {
            session_id: null,
            recovery_key: null,
            verified: false,
        };

        // Step 1 handlers
        const btnRegisterStep1Next = document.getElementById('btn-register-step1-next');
        if (btnRegisterStep1Next) {
            btnRegisterStep1Next.addEventListener('click', (e) => {
                e.preventDefault();
                showRegisterStep(2);
            });
        }

        const btnRegisterCancel = document.getElementById('btn-register-cancel');
        if (btnRegisterCancel) {
            btnRegisterCancel.addEventListener('click', (e) => {
                e.preventDefault();
                UI.hideLoginModal();
                resetRecoveryKeyRegistration();
            });
        }

        const btnCopyKey = document.getElementById('btn-copy-key');
        if (btnCopyKey) {
            btnCopyKey.addEventListener('click', async (e) => {
                e.preventDefault();
                const keyText = document.getElementById('register-key-text')?.textContent;
                if (keyText && navigator.clipboard) {
                    try {
                        await navigator.clipboard.writeText(keyText);
                        UI.notify('Clé copiée dans le presse-papier', 'success');
                    } catch (err) {
                        console.error('Copy failed', err);
                        UI.notify('Échec de la copie', 'error');
                    }
                }
            });
        }

        const btnDownloadKey = document.getElementById('btn-download-key');
        if (btnDownloadKey) {
            btnDownloadKey.addEventListener('click', (e) => {
                e.preventDefault();
                const keyText = document.getElementById('register-key-text')?.textContent;
                if (keyText) {
                    const blob = new Blob([`Ma clé de sécurité Zones Parapente\n\n${keyText}\n\nConservez cette clé en lieu sûr. Elle ne peut pas être réaffichée.`], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'zones-parapente-recovery-key.txt';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    UI.notify('Clé téléchargée', 'success');
                }
            });
        }

        // Step 2 handlers
        const btnRegisterStep2Verify = document.getElementById('btn-register-step2-verify');
        if (btnRegisterStep2Verify) {
            btnRegisterStep2Verify.addEventListener('click', async (e) => {
                e.preventDefault();
                const enteredKey = document.getElementById('register-key-verify')?.value.trim();
                if (!enteredKey) {
                    UI.showAuthMessage('Veuillez saisir la clé', true);
                    return;
                }

                // Verify with backend
                try {
                    await API.registerVerifyKey(window._recoveryKeySession.session_id, enteredKey);
                    window._recoveryKeySession.verified = true;

                    // Hide error, show step 3
                    const errorEl = document.getElementById('register-key-verify-error');
                    if (errorEl) errorEl.style.display = 'none';

                    showRegisterStep(3);
                    // Load CAPTCHA for step 3
                    await loadCaptcha();
                } catch (err) {
                    // Show toast notification
                    UI.notify(err?.message || 'La clé ne correspond pas', 'error');
                }
            });
        }

        const btnRegisterStep2Back = document.getElementById('btn-register-step2-back');
        if (btnRegisterStep2Back) {
            btnRegisterStep2Back.addEventListener('click', (e) => {
                e.preventDefault();
                showRegisterStep(1);
            });
        }

        // Step 3 handlers
        const btnRegisterStep3Complete = document.getElementById('btn-register-step3-complete');
        if (btnRegisterStep3Complete) {
            btnRegisterStep3Complete.addEventListener('click', async (e) => {
                e.preventDefault();

                const username = document.getElementById('register-username-step3')?.value.trim();
                const password = document.getElementById('register-password-step3')?.value;
                const confirm = document.getElementById('register-password-confirm-step3')?.value;
                const captchaAnswer = parseInt(document.getElementById('captcha-answer')?.value, 10);

                if (!username || !password) {
                    UI.showAuthMessage('Champs requis manquants', true);
                    return;
                }
                if (password !== confirm) {
                    UI.showAuthMessage('Les mots de passe ne correspondent pas', true);
                    return;
                }
                if (password.length < 6) {
                    UI.showAuthMessage('Le mot de passe doit contenir au moins 6 caractères', true);
                    return;
                }
                if (username.length < 3) {
                    UI.showAuthMessage('Le nom d\'utilisateur doit contenir au moins 3 caractères', true);
                    return;
                }
                if (isNaN(captchaAnswer) || !window._currentCaptchaToken) {
                    UI.showAuthMessage('Veuillez résoudre le CAPTCHA', true);
                    return;
                }

                try {
                    const userData = await API.registerComplete(
                        window._recoveryKeySession.session_id,
                        username,
                        password,
                        window._currentCaptchaToken,
                        captchaAnswer
                    );

                    AppState.setCurrentUser(userData);
                    UI.notify('Compte créé! Vous êtes connecté.', 'success');
                    await refreshQuotaPanel();

                    const state = AppState.getState();
                    if (state.mode !== 'VIEW') {
                        await cancelEdit(true);
                    }
                    AppState.deselectObject();
                    restyleAllLayers();

                    UI.hideLoginModal();
                    resetRecoveryKeyRegistration();
                } catch (err) {
                    UI.showAuthMessage(err?.message || 'Inscription impossible', true);
                    // Reload CAPTCHA on error
                    await loadCaptcha();
                }
            });
        }

        const btnRegisterStep3Back = document.getElementById('btn-register-step3-back');
        if (btnRegisterStep3Back) {
            btnRegisterStep3Back.addEventListener('click', (e) => {
                e.preventDefault();
                showRegisterStep(2);
            });
        }

        /**
         * Start recovery key registration - Step 1
         */
        async function startRecoveryKeyRegistration() {
            resetRecoveryKeyRegistration();
            showRegisterStep(1);

            // Show loading spinner
            const spinner = document.getElementById('register-loading-spinner');
            const keyDisplay = document.getElementById('register-key-display');
            const buttons = document.getElementById('register-buttons-step1');

            if (spinner) spinner.style.display = 'block';
            if (keyDisplay) keyDisplay.style.display = 'none';
            if (buttons) buttons.style.display = 'none';

            try {
                const data = await API.registerInit();
                window._recoveryKeySession.session_id = data.session_id;
                window._recoveryKeySession.recovery_key = data.recovery_key;

                // Display the key
                const keyTextEl = document.getElementById('register-key-text');
                if (keyTextEl) keyTextEl.textContent = data.recovery_key;

                // Hide spinner, show key
                if (spinner) spinner.style.display = 'none';
                if (keyDisplay) keyDisplay.style.display = 'block';
                if (buttons) buttons.style.display = 'flex';
            } catch (err) {
                UI.showAuthMessage('Impossible de générer la clé. Réessayez.', true);
                console.error('Failed to init recovery key', err);
            }
        }

        /**
         * Show a specific step in the registration process
         */
        function showRegisterStep(step) {
            const step1 = document.getElementById('register-step-1');
            const step2 = document.getElementById('register-step-2');
            const step3 = document.getElementById('register-step-3');

            if (step1) step1.style.display = step === 1 ? 'block' : 'none';
            if (step2) step2.style.display = step === 2 ? 'block' : 'none';
            if (step3) step3.style.display = step === 3 ? 'block' : 'none';

            // Clear verification input when returning to step 2
            if (step === 2) {
                const verifyInput = document.getElementById('register-key-verify');
                if (verifyInput) verifyInput.value = '';
                const errorEl = document.getElementById('register-key-verify-error');
                if (errorEl) errorEl.style.display = 'none';
            }
        }

        /**
         * Reset recovery key registration state
         */
        function resetRecoveryKeyRegistration() {
            window._recoveryKeySession = {
                session_id: null,
                recovery_key: null,
                verified: false,
            };

            // Clear all fields
            const verifyInput = document.getElementById('register-key-verify');
            if (verifyInput) verifyInput.value = '';

            const usernameInput = document.getElementById('register-username-step3');
            if (usernameInput) usernameInput.value = '';

            const passwordInput = document.getElementById('register-password-step3');
            if (passwordInput) passwordInput.value = '';

            const confirmInput = document.getElementById('register-password-confirm-step3');
            if (confirmInput) confirmInput.value = '';

            const captchaInput = document.getElementById('captcha-answer');
            if (captchaInput) captchaInput.value = '';
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

        // Note: Register form now uses multi-step handlers above (Step 1, 2, 3)
        // No submit handler needed

        // Bouton refresh CAPTCHA
        const btnRefreshCaptcha = document.getElementById('btn-refresh-captcha');
        if (btnRefreshCaptcha) {
            btnRefreshCaptcha.addEventListener('click', async (e) => {
                e.preventDefault();
                await loadCaptcha();
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
        logout,
        loadMapObjects,
        startPolling,
        stopPolling,
        cancelEdit,
        updateToolbarShellVisibility,
        applyQuotaVisibility,
        restyleAllLayers,
    };
})();

// Exposer APP globalement pour l'accès depuis UI
window.APP = APP;

// Initialiser au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    APP.init().catch(err => console.error('Initialization error:', err));
});
