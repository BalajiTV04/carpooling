"""Module 3 tests: password/JWT/OTP units (no Mongo) + full auth flow (needs
live Mongo from Module 2: `python init_db.py` first). Run: pytest -q."""

import pytest
from httpx import AsyncClient, ASGITransport

from app.core.security import (
    create_access_token,
    decode_token,
    generate_otp,
    hash_password,
    verify_password,
)
from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ---- pure units (run even without Mongo) ----

def test_password_roundtrip():
    h = hash_password("secret123")
    assert h != "secret123"
    assert verify_password("secret123", h) is True
    assert verify_password("wrong", h) is False


def test_jwt_roundtrip():
    tok = create_access_token("64f000000000000000000001", "+919999999999", ["passenger"])
    payload = decode_token(tok)
    assert payload["sub"] == "64f000000000000000000001"
    assert "passenger" in payload["roles"]


def test_jwt_rejects_tampered():
    tok = create_access_token("x", "+919999999999", ["passenger"])[:-4] + "abcd"
    try:
        decode_token(tok)
        raise AssertionError("should have raised")
    except ValueError:
        assert True


def test_otp_is_six_digits():
    for _ in range(20):
        code = generate_otp()
        assert len(code) == 6 and code.isdigit()


# ---- live flow (needs Mongo; skipped gracefully when down) ----

async def _mongo_up() -> bool:
    from app.core.database import ping_db

    return await ping_db()


@pytest.mark.asyncio
async def test_register_login_otp_me_flow():
    if not await _mongo_up():
        pytest.skip("Mongo down — run `python init_db.py` first")
    from app.core.database import get_db

    db = get_db()
    phone = "+919000000301"  # fixed Module-3 test number (safe to rerun: cleaned first)
    await db.users.delete_one({"phone": phone})
    await db.phone_otps.delete_one({"phone": phone})

    async with _client() as ac:
        # 1. register (dual role) -> 201 + JWT + unverified
        r = await ac.post("/api/v1/auth/register", json={
            "phone": phone, "password": "pass1234",
            "full_name": "Auth Test", "roles": ["driver", "passenger"]})
        assert r.status_code == 201, r.text
        token = r.json()["access_token"]
        assert r.json()["user"]["phone_verified"] is False

        # 2. duplicate register -> 409
        r2 = await ac.post("/api/v1/auth/register", json={
            "phone": phone, "password": "pass1234",
            "full_name": "Auth Test", "roles": ["passenger"]})
        assert r2.status_code == 409

        # 3. admin self-register blocked -> 422
        r3 = await ac.post("/api/v1/auth/register", json={
            "phone": "+919000000399", "password": "pass1234",
            "full_name": "Sneaky", "roles": ["admin"]})
        assert r3.status_code == 422

        # 4. login ok -> 200; wrong password -> 401
        assert (await ac.post("/api/v1/auth/login",
                json={"phone": phone, "password": "pass1234"})).status_code == 200
        assert (await ac.post("/api/v1/auth/login",
                json={"phone": phone, "password": "nope"})).status_code == 401

        # 5. OTP request (dev_code echoed) + verify wrong -> 401
        otp = (await ac.post("/api/v1/auth/otp/request", json={"phone": phone})).json()
        assert otp["sent"] is True and len(otp["dev_code"]) == 6
        bad = await ac.post("/api/v1/auth/otp/verify",
                            json={"phone": phone, "code": "000000"})
        assert bad.status_code == 401

        # 6. verify correct -> phone_verified True
        good = await ac.post("/api/v1/auth/otp/verify",
                             json={"phone": phone, "code": otp["dev_code"]})
        assert good.status_code == 200
        assert good.json()["user"]["phone_verified"] is True

        # 7. replay same code -> 404 (single-use deleted)
        replay = await ac.post("/api/v1/auth/otp/verify",
                               json={"phone": phone, "code": otp["dev_code"]})
        assert replay.status_code == 404

        # 8. /me with token -> profile; without -> 401
        me = await ac.get("/api/v1/auth/me",
                          headers={"Authorization": "Bearer " + token})
        assert me.status_code == 200 and me.json()["phone"] == phone
        assert (await ac.get("/api/v1/auth/me")).status_code == 401

    await db.users.delete_one({"phone": phone})
