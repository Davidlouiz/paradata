#!/usr/bin/env python3
"""
Test de validation des sommets dupliqués
"""

from app.api.zones import _validate_geometry_structure

# Test 1: Polygone valide (pas de doublons)
valid_polygon = {
    "type": "Polygon",
    "coordinates": [
        [
            [5.0, 44.0],
            [6.0, 44.0],
            [6.0, 45.0],
            [5.0, 45.0],
            [5.0, 44.0],  # Fermeture normale
        ]
    ],
}

is_valid, error = _validate_geometry_structure(valid_polygon)
print(f"Test 1 - Polygone valide: {is_valid}")
if not is_valid:
    print(f"  Erreur: {error}")

# Test 2: Polygone avec sommets dupliqués (comme votre cas)
invalid_polygon_duplicates = {
    "type": "Polygon",
    "coordinates": [
        [
            [5.410767, 44.933696],
            [5.08667, 44.984228],
            [5.136108, 45.301939],
            [5.715637, 45.278752],
            [5.688171, 44.923974],
            [5.410767, 44.933696],  # DUPLICATE du premier point (pas la fermeture)
            [5.402527, 45.042478],
            [5.542603, 45.0483],
            [5.539856, 45.166547],
            [5.317383, 45.172356],
            [5.281677, 45.054121],
            [5.402527, 45.042478],  # DUPLICATE d'un point précédent
            [5.406647, 44.988113],
            [5.410767, 44.933696],  # Fermeture (normal)
        ]
    ],
}

is_valid, error = _validate_geometry_structure(invalid_polygon_duplicates)
print(f"\nTest 2 - Polygone avec doublons: {is_valid}")
if not is_valid:
    print(f"  Erreur: {error}")

# Test 3: Polygone avec auto-intersection (forme en 8)
invalid_polygon_self_intersect = {
    "type": "Polygon",
    "coordinates": [
        [
            [0.0, 0.0],
            [1.0, 1.0],
            [1.0, 0.0],
            [0.0, 1.0],  # Crée une auto-intersection
            [0.0, 0.0],
        ]
    ],
}

is_valid, error = _validate_geometry_structure(invalid_polygon_self_intersect)
print(f"\nTest 3 - Polygone avec auto-intersection: {is_valid}")
if not is_valid:
    print(f"  Erreur: {error}")

# Test 4: Polygone sans fermeture correcte
invalid_polygon_not_closed = {
    "type": "Polygon",
    "coordinates": [
        [
            [5.0, 44.0],
            [6.0, 44.0],
            [6.0, 45.0],
            [5.0, 45.0],
            [5.0, 44.1],  # Pas exactement le même point
        ]
    ],
}

is_valid, error = _validate_geometry_structure(invalid_polygon_not_closed)
print(f"\nTest 4 - Polygone non fermé: {is_valid}")
if not is_valid:
    print(f"  Erreur: {error}")

print("\n✓ Tests terminés")
