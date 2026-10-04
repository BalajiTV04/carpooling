"""Module 4 tests: profile view/edit, public card, role add, password change.
Needs live Mongo (`python init_db.py`). Run: pytest -q."""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _register(ac, phone, name="Profile Test", roles=None):
    roles = roles or ["passenger"]
    await ac.post("/api/v1/auth/register", json={
        "phone": phone, "password": "pass1234",
        "full_name": name, "roles": roles})


async def _login(ac, phone, password="pass1234"):
    r = await ac.post("/api/v1/auth/login",
                      json={"phone": phone, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": "Bearer " + token}


@pytest.mark.asyncio
async def test_profile_flow():
    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    phone_a = "+919000000401"
    phone_b = "+919000000402"
    for p in (phone_a, phone_b):
        await db.users.delete_one({"phone": p})

    async with _client() as ac:
        await _register(ac, phone_a)
        await _register(ac, phone_b, name="Second User")
        tok = await _login(ac, phone_a)

        # 1. GET /users/me -> full profile incl. email None
        me = await ac.get("/api/v1/users/me", headers=_h(tok))
        assert me.status_code == 200, me.text
        assert me.json()["phone"] == phone_a
        assert me.json()["email"] is None
        uid = me.json()["id"]

        # 2. PATCH name+email+avatar -> reflected + email lowercased
        p = await ac.patch("/api/v1/users/me", headers=_h(tok), json={
            "full_name": "Renamed User", "email": "Driver@Example.COM",
            "avatar_url": "https://example.com/a.png"})
        assert p.status_code == 200, p.text
        assert p.json()["full_name"] == "Renamed User"
        assert p.json()["email"] == "driver@example.com"

        # 3. bad email -> 422; bad avatar scheme -> 422; empty patch -> 422
        assert (await ac.patch("/api/v1/users/me", headers=_h(tok),
                json={"email": "not-an-email"})).status_code == 422
        assert (await ac.patch("/api/v1/users/me", headers=_h(tok),
                json={"avatar_url": "ftp://x/y.png"})).status_code == 422
        assert (await ac.patch("/api/v1/users/me", headers=_h(tok),
                json={})).status_code == 422

        # 4. duplicate email -> 409 (second user takes it first... actually A holds it)
        tok_b = await _login(ac, phone_b)
        clash = await ac.patch("/api/v1/users/me", headers=_h(tok_b),
                               json={"email": "driver@example.com"})
        assert clash.status_code == 409

        # 5. public card: visible, no phone/email/hash
        pub = await ac.get("/api/v1/users/" + uid, headers=_h(tok_b))
        assert pub.status_code == 200, pub.text
        assert "phone" not in pub.json() and "email" not in pub.json()
        assert pub.json()["full_name"] == "Renamed User"

        # 6. public card needs auth -> 401/403 without token
        assert (await ac.get("/api/v1/users/" + uid)).status_code in (401, 403)

        # 7. add driver role while unverified -> 403; verify via OTP then OK
        denied = await ac.post("/api/v1/users/me/roles", headers=_h(tok),
                               json={"role": "driver"})
        assert denied.status_code == 403
        otp = (await ac.post("/api/v1/auth/otp/request",
                             json={"phone": phone_a})).json()
        okv = await ac.post("/api/v1/auth/otp/verify",
                            json={"phone": phone_a, "code": otp["dev_code"]})
        assert okv.status_code == 200
        added = await ac.post("/api/v1/users/me/roles", headers=_h(tok),
                              json={"role": "driver"})
        assert added.status_code == 200, added.text
        assert "driver" in added.json()["roles"]
        # duplicate role -> 409
        assert (await ac.post("/api/v1/users/me/roles", headers=_h(tok),
                json={"role": "driver"})).status_code == 409

        # 8. password change: wrong current -> 401; right -> login with new
        bad = await ac.post("/api/v1/users/me/password", headers=_h(tok), json={
            "current_password": "wrong", "new_password": "newpass123"})
        assert bad.status_code == 401
        good = await ac.post("/api/v1/users/me/password", headers=_h(tok), json={
            "current_password": "pass1234", "new_password": "newpass123"})
        assert good.status_code == 200
        tok2 = await _login(ac, phone_a, password="newpass123")
        assert (await ac.get("/api/v1/users/me", headers=_h(tok2))).status_code == 200

    for p in (phone_a, phone_b):
        await db.users.delete_one({"phone": p})
