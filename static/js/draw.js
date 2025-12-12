/**
 * Draw Module – Gestion du dessin et édition géométrique avec Leaflet-Geoman
 * 
 * Modes :
 *   - CREATE: Dessiner un nouveau polygone
 *   - EDIT: Éditer les sommets d'un polygone existant
 */

const DRAW = (() => {
    let map = null;
    let drawnLayers = L.featureGroup(); // groupe pour couches de dessin temporaires
    let currentDrawnLayer = null; // polygone en cours de création
    let currentMode = null; // 'CREATE' | 'EDIT' | null
    let isGeomanReady = false;

    /**
     * Initialiser Geoman et ses contrôles
     */
    function init(leafletMap) {
        map = leafletMap;
        map.addLayer(drawnLayers);

        // Attendre que Geoman soit disponible (il peut être chargé async)
        let attempts = 0;
        const maxAttempts = 50;

        const initGeoman = () => {
            if (window.L && window.L.PM) {
                map.pm.addControls({
                    position: 'topleft',
                    drawCircle: false,
                    drawCircleMarker: false,
                    drawPolyline: false,
                    drawRectangle: false,
                    drawText: false,
                    editMode: true,
                    dragMode: false,
                    cutPolygon: false,
                });
                isGeomanReady = true;
                console.log('Leaflet-Geoman initialized');
                setupGeomanListeners();
            } else {
                attempts++;
                if (attempts < maxAttempts) {
                    // Réessayer après un court délai
                    setTimeout(initGeoman, 100);
                } else {
                    console.warn('Leaflet-Geoman failed to load after ' + attempts + ' attempts');
                    console.warn('window.L:', window.L);
                    console.warn('window.L.PM:', window.L?.PM);
                }
            }
        };

        initGeoman();
    }

    /**
     * Configurer les écouteurs d'événements Geoman
     */
    function setupGeomanListeners() {
        if (!map || !map.pm) return;

        // Polygone créé (pm:create)
        map.on('pm:create', (e) => {
            const layer = e.layer;
            const coords = layer.toGeoJSON().geometry.coordinates;

            console.log('Polygone dessiné:', coords);

            if (currentMode === 'CREATE') {
                currentDrawnLayer = layer;
                AppState.setDrawnGeometry(layer.toGeoJSON().geometry);
                UI.updateDrawStatus('Polygone dessiné. Complétez le formulaire et enregistrez.');
            }
        });

        // Édition de couche (pm:edit)
        map.on('pm:edit', (e) => {
            const layer = e.layer;
            if (currentMode === 'EDIT') {
                const geom = layer.toGeoJSON().geometry;
                AppState.updateEditingGeometry(geom);
                UI.updateDrawStatus('Géométrie modifiée. Enregistrez pour sauvegarder.');
            }
        });

        // Couche supprimée (pm:remove)
        map.on('pm:remove', (e) => {
            console.log('Layer removed');
        });

        // Mode de dessin activé/désactivé
        map.on('pm:drawstart', (e) => {
            console.log('Draw started:', e.shape);
        });

        map.on('pm:drawend', (e) => {
            console.log('Draw ended');
        });

        console.log('Geoman event listeners configured');
    }

    /**
     * Démarrer le mode CREATE (dessin d'un nouveau polygone)
     */
    function startCreateMode() {
        if (!isGeomanReady) {
            console.error('Geoman not initialized');
            UI.notify('Erreur: Outils de dessin non disponibles', 'error');
            return;
        }

        currentMode = 'CREATE';
        currentDrawnLayer = null;

        // Activer l'outil de dessin de polygone dans Geoman
        map.pm.enableDraw('Polygon', {
            snappingOrder: ['marker', 'poly'],
        });

        UI.updateDrawStatus('Cliquez sur la carte pour dessiner un polygone. Double-clic pour terminer.');
        console.log('Create mode started');
    }

    /**
     * Démarrer le mode EDIT (éditer un polygone existant)
     */
    function startEditMode(geoJsonFeature) {
        if (!isGeomanReady) {
            console.error('Geoman not initialized');
            return;
        }

        currentMode = 'EDIT';

        // Ajouter le polygone à la map s'il n'y est pas
        const layer = L.geoJSON(geoJsonFeature, {
            style: {
                color: '#ff7800',
                weight: 3,
                opacity: 0.8,
                fillOpacity: 0.2,
            },
        }).addTo(drawnLayers);

        // Récupérer la première couche (il n'y en a qu'une)
        const polyLayer = layer.getLayers()[0];

        // Activer l'édition pour cette couche
        polyLayer.pm.enable({
            allowSelfIntersection: false,
        });

        currentDrawnLayer = polyLayer;
        UI.updateDrawStatus('Édition géométrique activée. Déplacez/ajoutez/supprimez des sommets.');
        console.log('Edit mode started');
    }

    /**
     * Arrêter les modes de dessin/édition
     */
    function stopDrawMode() {
        if (!map || !map.pm) return;

        // Désactiver tous les outils de dessin
        map.pm.disableDraw();

        // Désactiver l'édition sur toutes les couches
        drawnLayers.eachLayer(layer => {
            if (layer.pm) {
                layer.pm.disable();
            }
        });

        currentMode = null;
        currentDrawnLayer = null;
        UI.updateDrawStatus('');
        console.log('Draw mode stopped');
    }

    /**
     * Effacer toutes les couches dessinées
     */
    function clearDrawnLayers() {
        drawnLayers.clearLayers();
        currentDrawnLayer = null;
    }

    /**
     * Obtenir la géométrie GeoJSON dessinée
     */
    function getDrawnGeometry() {
        if (!currentDrawnLayer) return null;
        return currentDrawnLayer.toGeoJSON().geometry;
    }

    /**
     * Valider le dessin (au moins 3 points pour un polygone)
     */
    function isValidDrawing() {
        const geom = getDrawnGeometry();
        if (!geom || geom.type !== 'Polygon') return false;
        // Un polygone valide a au moins 4 coordonnées (3 points + fermeture)
        const coords = geom.coordinates[0];
        return coords && coords.length >= 4;
    }

    /**
     * Obtenir le mode courant
     */
    function getCurrentMode() {
        return currentMode;
    }

    return {
        init,
        startCreateMode,
        startEditMode,
        stopDrawMode,
        clearDrawnLayers,
        getDrawnGeometry,
        isValidDrawing,
        getCurrentMode,
    };
})();
