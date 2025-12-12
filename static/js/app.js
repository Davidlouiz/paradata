/**
 * Main App – Core application logic
 */

const APP = {
    map: null,
    currentUser: null,
    mapLayers: {},
    selectedPolygonLayer: null,
    creatingNew: false,
    editingObject: null,

    async init() {
        // Initialize map
        this.map = L.map('map').setView([45.5, 6.0], 10); // French Alps
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19,
        }).addTo(this.map);

        // Initialize draw module

        DRAW.init();
        // Initialize Socket.IO
        await SOCKET.init();

        // Check if already logged in
        await this.checkAuth();

        // Load map objects
        await this.loadMapObjects();

        // Set up event handlers
        this.setupEventHandlers();

        // Refresh map objects every 5 seconds (as fallback to WebSocket)
        setInterval(() => this.loadMapObjects(), 5000);
    },

    async checkAuth() {
        try {
            this.currentUser = await API.getMe();
            UI.updateUserDisplay(this.currentUser);
        } catch (err) {
            this.currentUser = null;
            UI.updateUserDisplay(null);
        }
    },

    async login(username, password) {
        const user = await API.login(username, password);
        this.currentUser = user;
        UI.updateUserDisplay(user);
        UI.notify('Connecté!', 'success');

        // Authenticate on Socket.IO
        SOCKET.authenticate(user.id);
    },

    async register(username, password) {
        const user = await API.register(username, password);
        this.currentUser = user;
        UI.updateUserDisplay(user);
        UI.notify('Compte créé! Vous êtes connecté.', 'success');

        // Authenticate on Socket.IO
        SOCKET.authenticate(user.id);
    },

    async logout() {
        if (!await UI.confirm('Déconnexion', 'Êtes-vous sûr?')) {
            return;
        }

        try {
            await API.logout();
            this.currentUser = null;
            UI.updateUserDisplay(null);
            UI.notify('Déconnecté!', 'success');
            UI.closeDrawer();
        } catch (err) {
            UI.notify(`Erreur: ${err.message}`, 'error');
        }
    },

    async loadMapObjects() {
        try {
            const bounds = this.map.getBounds();
            const bbox = {
                minLat: bounds.getSouth(),
                minLng: bounds.getWest(),
                maxLat: bounds.getNorth(),
                maxLng: bounds.getEast(),
            };

            const objects = await API.listMapObjects(bbox);
            this.renderMapObjects(objects);
        } catch (err) {
            console.error('Error loading map objects:', err);
        }
    },

    renderMapObjects(objects) {
        // Clear existing layers (except selected)
        Object.keys(this.mapLayers).forEach((id) => {
            if (parseInt(id) !== UI.selectedObjectId) {
                this.map.removeLayer(this.mapLayers[id]);
                delete this.mapLayers[id];
            }
        });

        // Add new layers
        objects.forEach((obj) => {
            if (!this.mapLayers[obj.id]) {
                this.renderMapObject(obj);
            }
        });
    },

    renderMapObject(obj) {
        if (!obj.geometry) return;

        try {
            const layer = L.geoJSON(obj.geometry, {
                style: () => this.getPolygonStyle(obj),
                onEachFeature: (feature, layer) => {
                    layer.on('click', () => this.selectPolygon(obj, layer));
                },
            });

            layer.addTo(this.map);
            layer.objData = obj;
            this.mapLayers[obj.id] = layer;
        } catch (err) {
            console.error('Error rendering polygon:', err);
        }
    },

    getPolygonStyle(obj) {
        const isSelected = obj.id === UI.selectedObjectId;
        const isLocked = obj.lock && obj.lock.locked_by;
        const severity = obj.severity;

        let color = '#999'; // Default
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
    },

    selectPolygon(obj, layer) {
        // Deselect previous
        if (this.selectedPolygonLayer) {
            this.map.removeLayer(this.selectedPolygonLayer);
            delete this.mapLayers[this.selectedPolygonLayer.objData.id];
        }

        this.selectedPolygonLayer = layer;
        UI.showDrawerDetails(obj);
    },

    setupEventHandlers() {
        // Create button
        document.getElementById('btn-create').addEventListener('click', () => {
            this.startCreate();
        });

        // Edit button
        document.getElementById('btn-edit').addEventListener('click', () => {
            this.startEdit();
        });

        // Delete button
        document.getElementById('btn-delete').addEventListener('click', async () => {
            if (!await UI.confirm('Supprimer', 'Êtes-vous sûr de supprimer ce polygone?')) {
                return;
            }
            this.deletePolygon();
        });

        // Save button
        document.getElementById('btn-save').addEventListener('click', () => {
            this.savePolygon();
        });

        // Cancel button
        document.getElementById('btn-cancel').addEventListener('click', () => {
            this.cancelEdit();
        });

        // Map click to deselect
        this.map.on('click', (e) => {
            if (e.originalEvent.target.id === 'map') {
                UI.closeDrawer();
            }
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && DRAW.isDrawing) {
                this.cancelEdit();
            }
        });
    },

    startCreate() {
        this.creatingNew = true;
        DRAW.startCreateMode();
        UI.showDrawerForm();
    },

    async startEdit() {
        if (!UI.selectedObjectId) return;

        const obj = await API.getMapObject(UI.selectedObjectId);

        // Check if locked
        if (obj.lock && obj.lock.locked_by && obj.lock.locked_by_username !== this.currentUser.username) {
            UI.notify(`Objet en cours d'édition par ${obj.lock.locked_by_username}`, 'error');
            return;
        }

        // Acquire lock
        try {
            await API.checkoutObject(obj.id);
        } catch (err) {
            UI.notify(`Erreur: ${err.message}`, 'error');
            return;
        }

        this.editingObject = obj;
        DRAW.startEditMode();
        DRAW.displayGeometry(obj.geometry);
        UI.showDrawerForm(obj);
    },

    async savePolygon() {
        if (!this.currentUser) {
            UI.notify('Vous devez être connecté', 'error');
            return;
        }

        const geometry = DRAW.getDrawnGeometry();
        if (!geometry) {
            UI.notify('Veuillez dessiner un polygone valide', 'error');
            return;
        }

        const form = document.getElementById('drawer-form');
        const dangerTypeId = parseInt(document.getElementById('form-danger-type').value);
        const severity = document.getElementById('form-severity').value;
        const description = document.getElementById('form-description').value;

        if (!dangerTypeId || !severity) {
            UI.notify('Veuillez remplir tous les champs', 'error');
            return;
        }

        try {
            UI.showToolbarStatus('Sauvegarde...');

            if (this.creatingNew) {
                // Create
                await API.createMapObject(geometry, dangerTypeId, severity, description);
                UI.notify('Polygone créé!', 'success');
                this.creatingNew = false;
            } else if (this.editingObject) {
                // Update
                await API.updateMapObject(
                    this.editingObject.id,
                    geometry,
                    dangerTypeId,
                    severity,
                    description
                );
                UI.notify('Polygone mis à jour!', 'success');
                this.editingObject = null;
            }

            DRAW.stopDrawMode();
            UI.closeDrawer();
            await this.loadMapObjects();
        } catch (err) {
            UI.notify(`Erreur: ${err.message}`, 'error');
        }
    },

    async deletePolygon() {
        if (!UI.selectedObjectId) return;

        try {
            await API.deleteMapObject(UI.selectedObjectId);
            UI.notify('Polygone supprimé!', 'success');
            UI.closeDrawer();
            await this.loadMapObjects();
        } catch (err) {
            UI.notify(`Erreur: ${err.message}`, 'error');
        }
    },

    cancelEdit() {
        if (this.editingObject) {
            API.releaseObject(this.editingObject.id).catch(console.error);
            this.editingObject = null;
        }

        this.creatingNew = false;
        DRAW.stopDrawMode();
        UI.closeDrawer();
    },
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    APP.init();
});
