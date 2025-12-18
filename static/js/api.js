/**
 * API Client – Wrapper for all backend endpoints
 */

const API = {
    BASE_URL: window.location.origin,
    token: localStorage.getItem('token') || null,

    /**
     * Generic fetch wrapper
     */
    async request(method, endpoint, data = null) {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        if (this.token) {
            options.headers['Authorization'] = `Bearer ${this.token}`;
        }

        if (data) {
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(`${this.BASE_URL}${endpoint}`, options);
            // Try to parse JSON safely
            let json = null;
            try {
                json = await response.json();
            } catch (parseErr) {
                // Non-JSON response
                console.error('API: failed to parse JSON from', endpoint, 'status', response.status);
                json = null;
            }

            if (!response.ok) {
                // Log details for debugging 4xx/5xx responses
                console.error('API request failed', { method, endpoint, status: response.status, body: json });
                throw {
                    status: response.status,
                    message: (json && (json.detail || json.error)) || response.statusText || 'Unknown error',
                    data: json,
                };
            }

            return json;
        } catch (error) {
            if (error && error.status !== undefined) {
                throw error;
            }
            console.error('API request unexpected error', { method, endpoint, error });
            throw {
                status: 0,
                message: error.message || String(error),
                data: null,
            };
        }
    },

    // ========== Auth Endpoints ==========

    async login(username, password) {
        const res = await this.request('POST', '/auth/login', { username, password });
        this.token = res.data.token;
        localStorage.setItem('token', this.token);
        return res.data;
    },

    // ========== Recovery Key Registration Flow ==========

    async registerInit() {
        /**
         * Step 1: Generate recovery key
         * Returns: { session_id, recovery_key }
         */
        const res = await this.request('POST', '/auth/register/init', {});
        return res.data;
    },

    async registerVerifyKey(session_id, recovery_key) {
        /**
         * Step 2: Verify recovery key was saved by user
         */
        const res = await this.request('POST', '/auth/register/verify-key', {
            session_id,
            recovery_key,
        });
        return res.data;
    },

    async registerComplete(session_id, username, password, captcha_token, captcha_answer) {
        /**
         * Step 3: Complete account creation
         * Returns: { id, username, token, created_at }
         */
        const res = await this.request('POST', '/auth/register/complete', {
            session_id,
            username,
            password,
            captcha_token,
            captcha_answer,
        });
        this.token = res.data.token;
        localStorage.setItem('token', this.token);
        return res.data;
    },

    async recoverPassword(recovery_key, new_username, new_password) {
        /**
         * Recover account using recovery key
         * Allows resetting both username and password
         * Recovery key is the unique identifier and proof of ownership
         * Returns: { id, username, token, created_at }
         */
        const res = await this.request('POST', '/auth/recover-password', {
            recovery_key,
            new_username,
            new_password,
        });
        this.token = res.data.token;
        localStorage.setItem('token', this.token);
        return res.data;
    },

    async getCaptchaChallenge() {
        const res = await this.request('GET', '/captcha/challenge');
        return res; // { token, question }
    },

    async logout() {
        await this.request('POST', '/auth/logout');
        this.token = null;
        localStorage.removeItem('token');
    },

    async getMe() {
        const res = await this.request('GET', '/auth/me');
        return res.data; // Can be null if not authenticated
    },

    async getMyQuota() {
        const res = await this.request('GET', '/auth/quota');
        return res.data;
    },

    // ========== Map Objects Endpoints ==========

    async listZones(bbox) {
        const params = new URLSearchParams({
            minLat: bbox.minLat,
            minLng: bbox.minLng,
            maxLat: bbox.maxLat,
            maxLng: bbox.maxLng,
        });
        const res = await this.request('GET', `/zones?${params}`);
        return res;
    },

    async getMapObject(id) {
        const res = await this.request('GET', `/zones/${id}`);
        return res;
    },

    async createZone(payload) {
        const res = await this.request('POST', '/zones', payload);
        return res;
    },

    async checkoutObject(id) {
        const res = await this.request('POST', `/zones/${id}/checkout`);
        return res;
    },

    async releaseObject(id) {
        const res = await this.request('POST', `/zones/${id}/release`);
        return res;
    },

    async updateZone(id, payload) {
        const res = await this.request('PUT', `/zones/${id}`, payload);
        return res;
    },

    async deleteZone(id) {
        const res = await this.request('DELETE', `/zones/${id}`);
        return res;
    },

    async getLockStatus(id) {
        const res = await this.request('GET', `/zones/${id}/lock`);
        return res;
    },

    // ========= Zone Types =========
    async getZoneTypes() {
        const res = await this.request('GET', '/zone-types');
        return res;
    },

    async createZoneType(payload) {
        const res = await this.request('POST', '/zone-types', payload);
        return res;
    },

    async updateZoneType(code, payload) {
        const res = await this.request('PUT', `/zone-types/${encodeURIComponent(code)}`, payload);
        return res;
    },

    async deleteZoneType(code) {
        const res = await this.request('DELETE', `/zone-types/${code}`);
        return res;
    },
};
