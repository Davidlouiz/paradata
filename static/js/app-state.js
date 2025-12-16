/**
 * AppState – Gestion centralisée de l'état de l'application
 * 
 * Modes :
 *   - VIEW: Consultation, pas en train de créer/éditer
 *   - DRAW: Dessin d'un nouveau polygone
 *   - EDIT: Édition d'un polygone existant (verrouillé)
 * 
 * États de verrou :
 *   - NONE: Pas de verrou
 *   - ACQUIRED: Verrou acquis par l'utilisateur courant
 *   - LOCKED_BY_OTHER: Verrou détenu par un autre utilisateur
 * 
 */

const AppState = (() => {
    let state = {
        // Mode global
        mode: 'VIEW', // 'VIEW' | 'DRAW' | 'EDIT'

        // Authentification
        isAuthenticated: false,
        currentUser: null,

        // Sélection et édition
        selectedObjectId: null,
        selectedObject: null,
        editingObject: null, // copie pour édition avant PUT
        lockStatus: null, // { locked_by, lock_expires_at }
        lockTimerId: null, // ID du timer pour rafraîchissement du verrou

        // Dessin
        drawnGeometry: null, // GeoJSON geometry en cours de dessin

        // Quota
        remainingQuota: null,

        // Zone types (severity list)
        zoneTypes: [],
    };

    const listeners = new Set();

    /**
     * S'abonner aux changements d'état
     */
    function subscribe(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
    }

    /**
     * Notifier tous les observateurs
     */
    function notify() {
        listeners.forEach(callback => {
            try {
                callback(state);
            } catch (e) {
                console.error('Error in state listener:', e);
            }
        });
    }

    /**
     * Passer en mode VIEW (réinitialiser sélection/édition)
     */
    function setViewMode() {
        state.mode = 'VIEW';
        state.drawnGeometry = null;
        state.editingObject = null;
        clearLockTimer();
        notify();
    }

    /**
     * Passer en mode DRAW (création)
     */
    function setDrawMode() {
        state.mode = 'DRAW';
        state.selectedObjectId = null;
        state.selectedObject = null;
        state.drawnGeometry = null;
        notify();
    }

    /**
     * Passer en mode EDIT (édition d'un objet verrouillé)
     */
    function setEditMode() {
        state.mode = 'EDIT';
        // editingObject et lockStatus doivent être définis avant
        notify();
    }

    /**
     * Définir l'utilisateur courant
     */
    function setCurrentUser(user) {
        state.currentUser = user;
        state.isAuthenticated = !!user;
        // En cas de déconnexion, revenir au mode VIEW
        if (!user) {
            setViewMode();
            state.selectedObjectId = null;
            state.selectedObject = null;
        }
        notify();
    }

    /**
     * Sélectionner un polygone (sans l'éditer)
     */
    function selectObject(object) {
        if (state.mode === 'VIEW' || state.mode === 'EDIT') {
            state.selectedObjectId = object.id;
            state.selectedObject = object;
            state.lockStatus = {
                locked_by: object.locked_by,
                lock_expires_at: object.lock_expires_at,
            };
            // Si verrouillé, relancer le timer de rafraîchissement
            refreshLockStatus();
            notify();
        }
    }

    /**
     * Déselectionner (fermeture du panneau détails)
     */
    function deselectObject() {
        state.selectedObjectId = null;
        state.selectedObject = null;
        state.lockStatus = null;
        clearLockTimer();
        notify();
    }

    /**
     * Définir la géométrie dessinée (mode DRAW)
     */
    function setDrawnGeometry(geojsonGeometry) {
        state.drawnGeometry = geojsonGeometry;
        notify();
    }

    /**
     * Préparer l'édition (après checkout réussi)
     */
    function prepareEdit(object, lockStatus) {
        state.editingObject = JSON.parse(JSON.stringify(object)); // copie profonde
        state.lockStatus = lockStatus;
        state.selectedObject = object;
        state.selectedObjectId = object.id;
        setEditMode();
        startLockTimer();
    }

    /**
     * Annuler l'édition (revenir aux données originales)
     */
    function cancelEdit() {
        state.editingObject = null;
        state.lockStatus = null;
        clearLockTimer();
        setViewMode();
        notify();
    }

    /**
     * Mettre à jour les champs du formulaire en édition
     */
    function updateEditingField(field, value) {
        if (state.editingObject) {
            state.editingObject[field] = value;
            notify();
        }
    }

    /**
     * Mettre à jour la géométrie en édition
     */
    function updateEditingGeometry(geojsonGeometry) {
        if (state.editingObject) {
            state.editingObject.geometry = geojsonGeometry;
            notify();
        }
    }

    /**
     * Définir le verrou (verrouillé par quelqu'un)
     */
    function setLockStatus(lockStatus) {
        state.lockStatus = lockStatus;
        notify();
    }

    /**
     * Rafraîchir l'état du verrou (polling ou lors de la sélection)
     */
    function refreshLockStatus() {
        if (!state.selectedObjectId) return;

        clearLockTimer();

        // Rafraîchir immédiatement
        API.getLockStatus(state.selectedObjectId)
            .then(res => {
                if (res.success) {
                    state.lockStatus = {
                        locked_by: res.data.locked_by,
                        lock_expires_at: res.data.lock_expires_at,
                    };
                    notify();
                }
            })
            .catch(e => console.warn('Error refreshing lock status:', e));

        // Relancer un timer (toutes les 5 secondes si verrouillé)
        if (state.lockStatus?.locked_by) {
            state.lockTimerId = setTimeout(refreshLockStatus, 5000);
        }
    }

    /**
     * Démarrer un timer de rafraîchissement du verrou pendant l'édition
     */
    function startLockTimer() {
        // Rafraîchir toutes les 5 secondes
        state.lockTimerId = setInterval(() => {
            if (!state.selectedObjectId) return;

            API.getLockStatus(state.selectedObjectId)
                .then(res => {
                    if (res.success) {
                        const oldLock = state.lockStatus;
                        state.lockStatus = {
                            locked_by: res.data.locked_by,
                            lock_expires_at: res.data.lock_expires_at,
                        };
                        // Notifier uniquement si changement
                        if (oldLock?.locked_by !== state.lockStatus?.locked_by) {
                            notify();
                        }
                    }
                })
                .catch(e => console.warn('Error refreshing lock:', e));
        }, 5000);
    }

    /**
     * Arrêter le timer de rafraîchissement
     */
    function clearLockTimer() {
        if (state.lockTimerId) {
            clearTimeout(state.lockTimerId);
            clearInterval(state.lockTimerId);
            state.lockTimerId = null;
        }
    }

    /**
     * Définir le quota restant
     */
    function setRemainingQuota(quota) {
        state.remainingQuota = quota;
        notify();
    }

    /**
     * Définir les types de zone disponibles
     */
    function setZoneTypes(types) {
        state.zoneTypes = Array.isArray(types) ? [...types] : [];
        notify();
    }

    /**
     * Obtenir l'état courant (en lecture seule)
     */
    function getState() {
        return Object.freeze(JSON.parse(JSON.stringify(state)));
    }

    /**
     * Vérifier si un polygone peut être édité (verrou disponible)
     */
    function canEditObject() {
        if (!state.selectedObject) return false;
        if (state.selectedObject.locked_by && state.selectedObject.locked_by !== state.currentUser?.id) {
            return false; // verrouillé par quelqu'un d'autre
        }
        return true;
    }

    /**
     * Vérifier si on peut dessiner (mode DRAW autorisé)
     */
    function canDraw() {
        return state.isAuthenticated && state.mode === 'VIEW';
    }

    /**
     * Vérifier si le verrou est expiré
     */
    function isLockExpired() {
        if (!state.lockStatus?.lock_expires_at) return false;
        return new Date(state.lockStatus.lock_expires_at) < new Date();
    }

    /**
     * Obtenir le temps restant avant expiration du verrou (en secondes)
     */
    function getLockExpirySeconds() {
        if (!state.lockStatus?.lock_expires_at) return null;
        const expiryTime = new Date(state.lockStatus.lock_expires_at);
        const now = new Date();
        const diffMs = expiryTime - now;
        return Math.max(0, Math.ceil(diffMs / 1000));
    }

    return {
        subscribe,
        getState,

        setViewMode,
        setDrawMode,
        setEditMode,
        setCurrentUser,
        selectObject,
        deselectObject,
        setDrawnGeometry,
        prepareEdit,
        cancelEdit,
        updateEditingField,
        updateEditingGeometry,
        setLockStatus,
        refreshLockStatus,
        setRemainingQuota,
        setZoneTypes,

        canEditObject,
        canDraw,
        isLockExpired,
        getLockExpirySeconds,
    };
})();
