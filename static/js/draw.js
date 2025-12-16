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
    let pendingCreateHoverListener = null;

    function getColorByZoneType(zone_type) {
        const state = AppState.getState();
        const zone = state.zoneTypes?.find(t => t.code === zone_type);
        if (zone) return zone.color;
        return '#666';
    }

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
                // Ne pas ajouter les contrôles UI automatiques - on gère tout programmatiquement
                // via les boutons de la toolbar
                isGeomanReady = true;
                console.log('Leaflet-Geoman initialized (ready for programmatic use)');
                // Forcer la langue française pour les infobulles Geoman
                try {
                    map.pm.setLang('fr');
                } catch (err) {
                    console.warn('Unable to set Geoman language to fr:', err);
                }
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

            console.log('Zone dessinée:', coords);

            if (currentMode === 'CREATE') {
                currentDrawnLayer = layer;
                drawnLayers.addLayer(layer);
                AppState.setDrawnGeometry(layer.toGeoJSON().geometry);
                UI.updateDrawStatus('Zone dessinée. Complétez le formulaire et enregistrez.');

                // Déterminer la couleur selon la zone sélectionnée dans le formulaire
                const formZoneType = document.getElementById('form-zone-type');
                const selectedZoneType = formZoneType ? formZoneType.value : '';

                // Appliquer le style avec la bonne couleur
                updateEditingPolygonColor(selectedZoneType);

                // Activer l'édition pour permettre les modifications
                layer.pm.enable({
                    allowSelfIntersection: false,
                });

                // Écouter les événements d'édition pour restaurer la couleur
                layer.on('pm:edit', () => {
                    if (layer._desiredColor) {
                        layer.setStyle({ color: layer._desiredColor });
                    }
                });

                layer.on('pm:vertexadded', () => {
                    if (layer._desiredColor) {
                        layer.setStyle({ color: layer._desiredColor });
                    }
                });

                layer.on('pm:markerdragstart', () => {
                    if (layer._desiredColor) {
                        layer.setStyle({ color: layer._desiredColor });
                    }
                });

                layer.on('pm:markerdrag', () => {
                    if (layer._desiredColor) {
                        layer.setStyle({ color: layer._desiredColor });
                    }
                });

                layer.on('pm:markerdragend', () => {
                    if (layer._desiredColor) {
                        layer.setStyle({ color: layer._desiredColor });
                    }
                });

                layer.on('pm:vertexremoved', () => {
                    if (layer._desiredColor) {
                        layer.setStyle({ color: layer._desiredColor });
                    }
                });
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
        console.log('startCreateMode called, isGeomanReady:', isGeomanReady);
        console.log('window.L.PM:', window.L?.PM);
        console.log('map.pm:', map?.pm);

        if (!isGeomanReady) {
            console.error('Geoman not initialized');
            UI.notify('Erreur: Outils de dessin non disponibles', 'error');
            return;
        }

        currentMode = 'CREATE';
        currentDrawnLayer = null;
        // Réinitialiser le drapeau interne pour permettre une nouvelle activation
        startCreateMode._drawEnabled = false;
        const enableDrawOnce = () => {
            if (startCreateMode._drawEnabled) return;
            startCreateMode._drawEnabled = true;
            try {
                // Activer l'outil de dessin de polygone dans Geoman
                console.log('Calling map.pm.enableDraw("Polygon")...');
                map.pm.enableDraw('Polygon', {
                    snappingOrder: ['marker', 'poly'],
                    templineStyle: {
                        color: '#555',
                    },
                    hintlineStyle: {
                        color: '#555',
                        dashArray: [5, 5],
                    },
                });

                UI.updateDrawStatus('Cliquez sur la carte pour dessiner une zone.');
                console.log('Create mode started successfully');
            } catch (err) {
                console.error('Error enabling draw mode:', err);
                UI.notify('Erreur lors de l\'activation du mode dessin: ' + err.message, 'error');
            }
        };

        // Si la souris est déjà sur la carte, activer tout de suite. Sinon, attendre l'entrée.
        const container = map.getContainer();
        if (container && container.matches(':hover')) {
            enableDrawOnce();
        } else if (container) {
            pendingCreateHoverListener = enableDrawOnce;
            container.addEventListener('mouseenter', pendingCreateHoverListener, { once: true });
        } else {
            enableDrawOnce();
        }
    }

    /**
     * Démarrer le mode EDIT (éditer un polygone existant)
     */
    function startEditMode(mapObject) {
        if (!isGeomanReady) {
            console.error('Geoman not initialized');
            return;
        }

        currentMode = 'EDIT';

        // Extraire la géométrie de l'objet
        const geometry = mapObject.geometry || mapObject;

        // Créer un GeoJSON Feature avec juste la géométrie
        const geoJsonFeature = {
            type: 'Feature',
            geometry: geometry,
            properties: {}
        };

        // Ajouter le polygone à la map
        const baseColor = getColorByZoneType(mapObject.zone_type);
        const layer = L.geoJSON(geoJsonFeature, {
            style: {
                color: baseColor,
                weight: 3,
                opacity: 0.8,
                fillOpacity: 0.2,
            },
        }).addTo(drawnLayers);

        // Récupérer la première couche (il n'y en a qu'une)
        const polyLayer = layer.getLayers()[0];

        // Stocker la couleur désirée dans la couche
        polyLayer._desiredColor = baseColor;

        // Activer l'édition pour cette couche
        polyLayer.pm.enable({
            allowSelfIntersection: false,
        });

        // Écouter les événements d'édition pour restaurer la couleur
        polyLayer.on('pm:edit', () => {
            if (polyLayer._desiredColor) {
                polyLayer.setStyle({ color: polyLayer._desiredColor });
            }
        });

        polyLayer.on('pm:vertexadded', () => {
            if (polyLayer._desiredColor) {
                polyLayer.setStyle({ color: polyLayer._desiredColor });
            }
        });

        polyLayer.on('pm:markerdragstart', () => {
            if (polyLayer._desiredColor) {
                polyLayer.setStyle({ color: polyLayer._desiredColor });
            }
        });

        polyLayer.on('pm:markerdrag', () => {
            if (polyLayer._desiredColor) {
                polyLayer.setStyle({ color: polyLayer._desiredColor });
            }
        });

        polyLayer.on('pm:markerdragend', () => {
            if (polyLayer._desiredColor) {
                polyLayer.setStyle({ color: polyLayer._desiredColor });
            }
        });

        polyLayer.on('pm:vertexremoved', () => {
            if (polyLayer._desiredColor) {
                polyLayer.setStyle({ color: polyLayer._desiredColor });
            }
        });

        currentDrawnLayer = polyLayer;
        UI.updateDrawStatus('Déplacez les sommets pour modifier.');
        console.log('Edit mode started');
    }

    /**
     * Mettre à jour la couleur du polygone en édition/création selon la zone
     */
    function updateEditingPolygonColor(zone_type) {
        if (!currentDrawnLayer) return;
        if (currentMode !== 'EDIT' && currentMode !== 'CREATE') return;

        // Déterminer la couleur via getColorByZoneType (zone types dynamiques)
        const color = getColorByZoneType(zone_type);

        // Stocker la couleur désirée ET appliquer le style
        currentDrawnLayer._desiredColor = color;
        currentDrawnLayer.setStyle({ color: color });
    }

    /**
     * Arrêter les modes de dessin/édition
     */
    function stopDrawMode() {
        if (!map || !map.pm) return;

        // Retirer le listener différé d'activation du mode dessin, s'il existe
        const container = map.getContainer && map.getContainer();
        if (container && pendingCreateHoverListener) {
            container.removeEventListener('mouseenter', pendingCreateHoverListener);
            pendingCreateHoverListener = null;
        }

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
        if (currentDrawnLayer && map && map.hasLayer(currentDrawnLayer)) {
            map.removeLayer(currentDrawnLayer);
        }
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
        updateEditingPolygonColor,
    };
})();
