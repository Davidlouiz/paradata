# Guide de la Clé de Sécurité

## Vue d'ensemble

Le système utilise une **clé de sécurité** comme unique preuve d'identité pour les comptes pseudonymes. Cette clé remplace le besoin d'une adresse e-mail pour la récupération de compte.

---

## Création de compte (3 étapes)

### Étape 1 : Génération de la clé
- Le système génère une clé cryptographiquement sûre (128 bits)
- Format : `AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH` (32 caractères hexadécimaux)
- **La clé est affichée UNE SEULE FOIS**
- Actions disponibles :
  - 📋 Copier dans le presse-papier
  - 💾 Télécharger en fichier `.txt`

### Étape 2 : Vérification
- L'utilisateur doit **retaper la clé en entier** pour prouver qu'il l'a sauvegardée
- Accepte la clé avec ou sans tirets
- La vérification est obligatoire pour continuer

### Étape 3 : Création du compte
- Choix du pseudo
- Définition du mot de passe
- Validation CAPTCHA
- Le compte est créé avec la clé stockée (hashée)

---

## Récupération de compte

### Accès
1. Cliquer sur **"Mot de passe oublié?"** dans le formulaire de connexion

### Processus
La clé de sécurité permet de **redéfinir complètement le compte**:
1. Saisir la **clé de sécurité** (la clé est l'identifiant unique du compte)
2. Définir un **nouveau nom d'utilisateur** (peut être le même ou différent)
3. Définir un **nouveau mot de passe**
4. Le système :
   - Trouve le compte associé à cette clé
   - Vérifie que la clé est valide
   - Vérifie que le nouveau pseudo n'existe pas ailleurs
   - Met à jour PSEUDO et MOT DE PASSE
   - Connecte automatiquement l'utilisateur

### 🔑 Rôle de la clé de sécurité
- **Identifiant unique** du compte (la vraie "adresse" du compte)
- **Seule preuve** que c'est vous
- **Permet tout** : changer le pseudo, changer le mot de passe, récupérer le compte

---

## Sécurité

### Stockage
- **Clé** : uniquement le hash bcrypt est stocké en base
- **Mot de passe** : uniquement le hash bcrypt est stocké
- Aucun secret n'est conservé en clair côté serveur

### Génération
- Utilise `secrets.token_bytes(16)` (générateur cryptographique sûr)
- 128 bits = 2^128 possibilités (sécurité équivalente à AES-128)

### Validation
- Normalisation : majuscules, sans tirets ni espaces
- 32 caractères hexadécimaux exactement [0-9A-F]
- Vérification bcrypt du hash

---

## Conséquences assumées

### ⚠️ Perte de la clé
- Si l'utilisateur perd **ET** son mot de passe **ET** sa clé :
  - **Le compte est irrécupérable**
  - Aucun support ne peut aider (pas d'e-mail, pas de numéro de téléphone)
  - Il faut créer un nouveau compte
- **C'est volontaire** : la clé est l'unique preuve d'identité en cas de besoin

### ✅ Scénarios de récupération
- Oublié le mot de passe → utiliser pseudo + clé → **OK ✓**
- Oublié le pseudo → utiliser la clé seule → **impossible** (mais le pseudo n'a pas d'importance en réalité, pas de lien au compte)
- Oublié la clé → impossible de réinitialiser sans accès à l'email ou support
- Oublié TOUT (pseudo + mdp + clé) → **Compte perdu** ✗

---

## Endpoints API

### Création de compte
```
POST /auth/register/init
→ { session_id, recovery_key }

POST /auth/register/verify-key
{ session_id, recovery_key }
→ { success: true }

POST /auth/register/complete
{ session_id, username, password, captcha_token, captcha_answer }
→ { id, username, token, created_at }
```

### Récupération
```
POST /auth/recover-password
{ username, recovery_key, new_password }
→ { id, username, token, created_at }
```

**Rôle du username** : localiser le compte
**Rôle de la clé** : prouver que vous êtes le propriétaire

---

## Recommandations utilisateur

1. **Sauvegarder la clé immédiatement**
   - Copier dans un gestionnaire de mots de passe
   - Télécharger le fichier `.txt` et le stocker en lieu sûr
   - Prendre une capture d'écran sécurisée

2. **Ne jamais partager la clé**
   - Équivaut à donner accès complet au compte

3. **Conservation multiple**
   - Garder plusieurs copies dans des endroits différents
   - Inclure dans les sauvegardes chiffrées

---

## Messages utilisateur

### À la création
> ⚠️ Cette clé est votre preuve d'identité.
> Sans elle, votre pseudo et votre historique seront perdus définitivement.

### Après création
> Votre compte a été créé.
> Conservez précieusement votre clé de sécurité.
> Elle ne pourra pas être réaffichée.

### À la récupération
> Utilisez votre clé de sécurité pour récupérer l'accès à votre compte.

---

## Tests à effectuer

- ✅ Créer un compte avec sauvegarde de clé
- ✅ Vérifier le rejet d'une clé incorrecte (étape 2)
- ✅ Récupérer le mot de passe avec la bonne clé
- ✅ Vérifier le rejet avec une mauvaise clé
- ✅ Vérifier le rejet avec un pseudo inexistant
- ✅ Tester avec clé formatée (avec tirets)
- ✅ Tester avec clé non formatée (sans tirets)
- ✅ Vérifier la connexion automatique après récupération
