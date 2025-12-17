/**
 * Socket.IO Client – Real-time synchronization with backend
 */

const SOCKET = {
    io: null,
    connected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,

    /**
     * Initialize Socket.IO connection
     */
    async init() {
        // Prevent double-initialization (hot-reload or multiple calls)
        if (this.io) {
            console.log('SOCKET.init() called but socket already exists');
            return;
        }
        // Include Socket.IO client library dynamically if not loaded
        if (typeof io === 'undefined') {
            await this.loadSocketIO();
        }

        this.io = io(window.location.origin, {
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: this.maxReconnectAttempts,
        });

        this.setupEventHandlers();
    },

    /**
     * Load Socket.IO client library
     */
    async loadSocketIO() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    /**
     * Setup Socket.IO event handlers
     */
    setupEventHandlers() {
        this.io.on('connect', () => this.onConnect());

        // receive a reason argument from Socket.IO
        this.io.on('disconnect', (reason) => this.onDisconnect(reason));

        this.io.on('zone_created', (data) => {
            this.onZoneCreated(data);
        });

        this.io.on('zone_updated', (data) => {
            this.onZoneUpdated(data);
        });

        this.io.on('zone_deleted', (data) => {
            this.onZoneDeleted(data);
        });

        this.io.on('zone_locked', (data) => {
            this.onZoneLocked(data);
        });

        this.io.on('zone_released', (data) => {
            this.onZoneReleased(data);
        });
    },

    /**
     * Authenticate user on Socket.IO connection
     */
    authenticate(userId) {
        if (this.io && this.io.connected) {
            this.io.emit('auth_user', { user_id: userId });
        }
    },

    // ========== Event Handlers ==========

    onConnect() {
        console.log('Socket.IO connected');
        this.connected = true;
        this.reconnectAttempts = 0;

        // Ne pas notifier la première connexion pour éviter le bruit
        if (this._hasConnectedOnce) {
            UI.notify('Connexion rétablie', 'success');
        }
        this._hasConnectedOnce = true;

        // Stop polling fallback when WebSocket is connected
        if (typeof APP !== 'undefined' && APP.stopPolling) {
            APP.stopPolling();
        }

        // Authenticate if logged in
        if (APP.currentUser) {
            this.authenticate(APP.currentUser.id);
        }
    },

    onDisconnect(reason) {
        console.log('Socket.IO disconnected:', reason);
        this.connected = false;

        // Start polling fallback when WebSocket disconnects
        if (typeof APP !== 'undefined' && APP.startPolling) {
            APP.startPolling();
        }

        // Throttle repeated disconnect notifications (avoid toast spam)
        const now = Date.now();
        if (!this._lastDisconnectNotifyAt) this._lastDisconnectNotifyAt = 0;
        const delta = now - this._lastDisconnectNotifyAt;
        if (delta < 5000) {
            // Ignore rapid repeated disconnects
            return;
        }
        this._lastDisconnectNotifyAt = now;

        // Show a friendly message depending on reason
        let message = 'Déconnecté du serveur';
        if (reason === 'io server disconnect') {
            message = "Déconnecté par le serveur — tentative de reconnexion...";
        } else if (reason === 'transport close' || reason === 'transport error') {
            message = "Connexion réseau perdue. Reconnexion en cours...";
        }

        UI.notify(message, 'error');
    },

    async onZoneCreated(data) {
        console.log('Map object created:', data);
        await APP.loadMapObjects();
        // Don't show notification if user just created it
        if (data.object.created_by !== APP.currentUser?.id) {
            const createdBy = data.object.created_by_username || 'Un autre utilisateur';
            const zoneId = data.object.id;
            UI.notify(`Nouvelle zone #${zoneId} ajoutée à la carte par ${createdBy}`, 'info');
        }
    },

    async onZoneUpdated(data) {
        console.log('Map object updated:', data);
        await APP.loadMapObjects();

        // Refresh drawer if currently viewing this object
        if (UI.selectedObjectId === data.object.id && !UI.isEditMode) {
            const obj = await API.getZone(data.object.id);
            UI.showDrawerDetails(obj);
        }

        // Don't show notification if user just updated it
        if (data.object.updated_by !== APP.currentUser?.id) {
            const updatedBy = data.object.updated_by_username || 'Un autre utilisateur';
            const zoneId = data.object.id;
            UI.notify(`Zone #${zoneId} mise à jour par ${updatedBy}`, 'info');
        }
    },

    async onZoneDeleted(data) {
        console.log('Map object deleted:', data);
        await APP.loadMapObjects();

        // Close drawer if viewing deleted object
        if (UI.selectedObjectId === data.object_id) {
            UI.closeDrawer();
        }

        // Show notification to all users
        const deletedBy = data.deleted_by_username || 'Un autre utilisateur';
        const zoneId = data.object_id;
        UI.notify(`Zone #${zoneId} supprimée par ${deletedBy}`, 'info');
    },

    async onZoneLocked(data) {
        console.log('Map object locked:', data);

        // Refresh lock status
        if (UI.selectedObjectId === data.object_id) {
            const obj = await API.getZone(data.object_id);
            if (!UI.isEditMode) {
                UI.showDrawerDetails(obj);
            }
        }
    },

    async onZoneReleased(data) {
        console.log('Map object released:', data);

        // Refresh lock status
        if (UI.selectedObjectId === data.object_id) {
            const obj = await API.getZone(data.object_id);
            if (!UI.isEditMode) {
                UI.showDrawerDetails(obj);
            }
        }
    },
};
