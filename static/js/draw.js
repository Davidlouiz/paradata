/**
 * Draw Module – Handle polygon drawing and editing
 */

const DRAW = {

    map: null,
    drawnItems: null,
    isDrawing: false,
    drawMode: null,
    drawnPoints: [],
    currentPolyline: null,
    currentEditableLayer: null,

    init() {
        console.log('DRAW.init()');
        this.drawnItems = L.featureGroup();
        if (APP && APP.map) {
            this.map = APP.map;
            this.map.addLayer(this.drawnItems);
        }
        console.log('DRAW initialized');
    },
    startCreateMode() {
        console.log('DRAW.startCreateMode()');
        this.isDrawing = true;
        this.drawMode = 'create';
        this.drawnPoints = [];
        this.currentPolyline = null;

        this.map.on('click', this.onMapClick.bind(this));

        UI.showToolbarStatus('Cliquez sur la carte pour créer un polygone. Clic droit pour fermer.');
        document.getElementById('btn-save').style.display = 'inline-block';
        document.getElementById('btn-cancel').style.display = 'inline-block';
    },

    startEditMode() {
        this.isDrawing = true;
        this.drawMode = 'edit';
        UI.showToolbarStatus('Modifiez la géométrie du polygone...');
        document.getElementById('btn-save').style.display = 'inline-block';
        document.getElementById('btn-cancel').style.display = 'inline-block';
    },

    stopDrawMode() {
        this.isDrawing = false;
        this.drawMode = null;
        this.drawnPoints = [];

        if (this.currentPolyline) {
            this.map.removeLayer(this.currentPolyline);
            this.currentPolyline = null;
        }

        this.map.off('click', this.onMapClick.bind(this));

        UI.showToolbarStatus('');
        document.getElementById('btn-save').style.display = 'none';
        document.getElementById('btn-cancel').style.display = 'none';
    },

    onMapClick(e) {
        if (!this.isDrawing || this.drawMode !== 'create') return;
        if (e.originalEvent.button === 2) return;

        const latlng = e.latlng;
        console.log(`Point: ${latlng.lat}, ${latlng.lng}`);

        const marker = L.circleMarker(latlng, {
            radius: 5,
            color: 'blue',
            weight: 2,
            opacity: 1,
            fillColor: 'lightblue',
            fillOpacity: 0.8,
        });
        marker.addTo(this.drawnItems);
        this.drawnPoints.push(latlng);

        if (this.currentPolyline) {
            this.map.removeLayer(this.currentPolyline);
        }
        this.currentPolyline = L.polyline(this.drawnPoints, {
            color: 'blue',
            weight: 2,
            opacity: 0.7,
        });
        this.currentPolyline.addTo(this.drawnItems);

        UI.showToolbarStatus(`Points: ${this.drawnPoints.length}`);
    },

    onDrawStart(e) {
        // Nothing special
    },

    onDrawStop(e) {
        // Nothing special
    },

    onDrawCreated(e) {
        const layer = e.layer;
        this.drawnItems.addLayer(layer);
    },

    onDrawEdited(e) {
        // Update current editable layer
        e.layers.eachLayer((layer) => {
            this.currentEditableLayer = layer;
        });
    },

    getDrawnGeometry() {
        console.log('DRAW.getDrawnGeometry()');
        let geometry = null;

        if (this.drawnPoints.length >= 3) {
            const coords = this.drawnPoints.map((ll) => [ll.lng, ll.lat]);
            coords.push([coords[0][0], coords[0][1]]);
            geometry = {
                type: 'Polygon',
                coordinates: [coords],
            };
            console.log('Geometry from drawn points:', geometry);
            return geometry;
        }

        this.drawnItems.eachLayer((layer) => {
            if (layer instanceof L.Polygon && !(layer instanceof L.CircleMarker)) {
                const coords = layer.getLatLngs()[0].map((ll) => [ll.lng, ll.lat]);
                if (coords[0][0] !== coords[coords.length - 1][0] ||
                    coords[0][1] !== coords[coords.length - 1][1]) {
                    coords.push([coords[0][0], coords[0][1]]);
                }
                geometry = {
                    type: 'Polygon',
                    coordinates: [coords],
                };
                console.log('Geometry from existing:', geometry);
            }
        });

        return geometry;
    },

    displayGeometry(geometry) {
        this.drawnItems.clearLayers();
        if (!geometry) return;

        if (geometry.type === 'Polygon') {
            const coords = geometry.coordinates[0].map((ll) => [ll[1], ll[0]]);
            const polygon = L.polygon(coords, {
                color: 'blue',
                weight: 2,
                opacity: 0.7,
                fillColor: 'lightblue',
                fillOpacity: 0.3,
            });
            this.drawnItems.addLayer(polygon);
            console.log('Polygon displayed');
        }
    },

    clearDrawnItems() {
        console.log('DRAW.clearDrawnItems()');
        this.drawnItems.clearLayers();
        this.drawnPoints = [];
        this.currentPolyline = null;
    },
};
