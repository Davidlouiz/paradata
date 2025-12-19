# 🔒 Politique de Sécurité - paradata.fr

## Signalement de failles de sécurité

Si vous découvrez une faille de sécurité, **ne créez pas d'issue publique** !

**Envoyez un email à :** security@paradata.fr (ou contactez directement David)

Nous traiterons votre rapport en confidentialité et vous tiendrons au courant de la résolution.

---

## ⚠️ Pré-requis de sécurité pour la production

### 1. Configuration de l'environnement

**OBLIGATOIRE** : Générer une clé JWT forte

```bash
# Générer une clé de 32 bytes
openssl rand -hex 32

# Ajouter au fichier .env
JWT_SECRET_KEY=votre_clé_générée_ici
```

Ne pas utiliser la clé par défaut `your-secret-key-change-in-production` en production !

### 2. Variables critiques à vérifier

```bash
# .env en production DOIT contenir :
JWT_SECRET_KEY=<clé forte générée>
ALLOWED_ORIGINS=https://paradata.fr
DEBUG=false
DATABASE_PATH=/app/data/alerte_parapente.db
```

### 3. Base de données

- La base SQLite est dans `data/alerte_parapente.db`
- **Faire des sauvegardes régulières** (quotidiennement)
- Utiliser un volume Docker pour la persistance

### 4. CORS

- En dev : `*` autorisé (via config locale)
- En prod : **STRICT** - uniquement `https://paradata.fr`

### 5. SSL/TLS

- **Toujours utiliser HTTPS** en production
- Certificate via Let's Encrypt (automatique avec docker-compose.yml)
- Renouvellement automatique par Certbot

### 6. Authentification

- Tokens JWT : 30 jours d'expiration
- Passwords hashés avec bcrypt (salt cost = 10)
- Brute-force protection : 5 tentatives puis lockout 30 min
- CAPTCHA sur l'inscription

### 7. Logs et monitoring

- Les erreurs 4xx/5xx sont loggées
- Vérifier régulièrement : `docker compose logs -f`
- Sauvegarder les logs pour audit

### 8. Permissions Docker

- Container run en tant qu'utilisateur non-root (uid 1000)
- Volumes en lecture-écriture contrôlée
- Pas d'accès au socket Docker

---

## 🛡️ Bonnes pratiques appliquées

✅ Tous les secrets dans `.env` (exclu du git)  
✅ Pas de clés hardcodées dans le code  
✅ Passwords hashés avec bcrypt  
✅ Tokens JWT HS256 avec expiration  
✅ Rate-limiting sur login  
✅ CAPTCHA anti-bots  
✅ Validation des inputs  
✅ Suppression logique des données (soft delete)  
✅ Audit trail complet  
✅ WebSockets sécurisés (wss://)  

---

## 📋 Checklist déploiement production

- [ ] `.env` créé avec JWT_SECRET_KEY forte
- [ ] `DEBUG=false`
- [ ] `ALLOWED_ORIGINS` limité à `https://paradata.fr`
- [ ] SSL/HTTPS configuré et fonctionnel
- [ ] Sauvegardes BD automatisées
- [ ] Firewall configuré (ports 80, 443 uniquement)
- [ ] Logs collectés et surveillés
- [ ] Domaine DNS pointant correctement
- [ ] Email de sécurité configuré pour reports

---

## 📞 Ressources

- **FastAPI Security** : https://fastapi.tiangolo.com/tutorial/security/
- **OWASP Top 10** : https://owasp.org/www-project-top-ten/
- **JWT Best Practices** : https://tools.ietf.org/html/rfc8949

---

## Historique des mises à jour de sécurité

Aucune faille critique signalée pour le moment. ✅
