#!/usr/bin/env python3
"""Test script for login lockout mechanism."""

import requests
import time
import sys

BASE_URL = "http://localhost:8000"


def test_login_lockout():
    """Test the login lockout after 5 failed attempts."""

    # Create a test user first (with valid credentials)
    print("Creating test user...")
    resp = requests.post(
        f"{BASE_URL}/auth/register",
        json={
            "username": f"test_user_{int(time.time())}",
            "password": "test123",
            "captcha_token": "dummy",
            "captcha_answer": 0,
        },
    )
    if resp.status_code != 200:
        print(f"✗ Failed to create user: {resp.status_code} - {resp.text}")
        # Try with existing user
        username = "test_lockout_user"
        # Try deleting from DB and recreating
    else:
        print(f"✓ User created (using random username)")
        user_data = resp.json()
        username = user_data.get("data", {}).get("username")

    # Try logging in with wrong password 5 times
    print(f"\n--- Testing login lockout for user '{username}' ---")

    for attempt in range(1, 7):
        print(f"\nAttempt {attempt}:")
        resp = requests.post(
            f"{BASE_URL}/auth/login",
            json={"username": username, "password": "wrongpassword"},
        )

        print(f"  Status: {resp.status_code}")

        if resp.status_code == 429:
            print(f"  ✓ BLOCKED! {resp.json()['detail']}")
            break
        elif resp.status_code == 401:
            error_msg = resp.json().get("detail", "")
            print(f"  ✗ Wrong password: {error_msg}")
        else:
            print(f"  ? Unexpected status: {resp.json()}")

    print("\n✓ Test completed!")


if __name__ == "__main__":
    test_login_lockout()
