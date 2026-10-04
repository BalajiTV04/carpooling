"""Module 5 tests: garage CRUD, plate rules, ownership, admin verify.
Needs live Mongo. Admin user is promoted directly in DB (no self-register).
Run: pytest -q."""

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _h(tok):
    return {"Authorization": "Bearer " + tok}


CAR = {"make": "Maruti", "model": "Swift", "year": 2019, "color": "Blue",
       "plate_no": "KA 05 mn 4321", "seats_total": 3,
       "fuel_type": "petrol", "mileage_kmpl": 18.0}


@pytest.mark.asyncio
async def test_vehicle_flow():
    from app.core.database import get_db, ping_db

    if not await ping_db():
        pytest.skip("Mongo down")
    db = get_db()
    drv, pax, adm = "+919000000501", "+919000000502", "+919000000503"
    for p in (drv, pax, adm):
        await db.users.delete_many({"phone": p})
    await db.vehicles.delete_many({"plate_no": "KA05MN4321"})

    async with _client() as ac:
        for p, roles in ((drv, ["driver"]), (pax, ["passenger"]), (adm, ["passenger"])):
            r = await ac.post("/api/v1/auth/register", json={
                "phone": p, "password": "pass1234",
                "full_name": "V " + p[-3:], "roles": roles})
            assert r.status_code == 201, r.text
        # promote admin directly (only path to admin in this project)
        await db.users.update_one({"phone": adm}, {"$set": {"roles": ["admin"]}})
        t_drv = (await ac.post("/api/v1/auth/login",
                 json={"phone": drv, "password": "pass1234"})).json()["access_token"]
        t_pax = (await ac.post("/api/v1/auth/login",
                 json={"phone": pax, "password": "pass1234"})).json()["access_token"]
        t_adm = (await ac.post("/api/v1/auth/login",
                 json={"phone": adm, "password": "pass1234"})).json()["access_token"]

        # 1. passenger (no driver role) blocked -> 403
        assert (await ac.post("/api/v1/vehicles", json=CAR,
                headers=_h(t_pax))).status_code == 403

        # 2. create -> 201, plate normalised, pending
        c = await ac.post("/api/v1/vehicles", json=CAR, headers=_h(t_drv))
        assert c.status_code == 201, c.text
        vid = c.json()["id"]
        assert c.json()["plate_no"] == "KA05MN4321"
        assert c.json()["verification_status"] == "pending"

        # 3. duplicate plate (diff spacing/case) -> 409
        dup = dict(CAR, plate_no="ka05mn4321")
        assert (await ac.post("/api/v1/vehicles", json=dup,
                headers=_h(t_drv))).status_code == 409

        # 4. bad fuel -> 422; bad seats -> 422
        assert (await ac.post("/api/v1/vehicles", json=dict(CAR, plate_no="KA01XX9999", fuel_type="water"),
                headers=_h(t_drv))).status_code == 422
        assert (await ac.post("/api/v1/vehicles", json=dict(CAR, plate_no="KA01XX9999", seats_total=9),
                headers=_h(t_drv))).status_code == 422

        # 5. list mine -> 1; other driver sees 0 (ownership)
        assert len((await ac.get("/api/v1/vehicles", headers=_h(t_drv))).json()) == 1

        # 6. admin pending lists it; verify -> verified
        pend = await ac.get("/api/v1/vehicles/admin/pending", headers=_h(t_adm))
        assert pend.status_code == 200 and any(v["id"] == vid for v in pend.json())
        vok = await ac.post("/api/v1/vehicles/admin/" + vid + "/verify?decision=verified&note=ok",
                            headers=_h(t_adm))
        assert vok.status_code == 200 and vok.json()["verification_status"] == "verified"

        # 7. driver cannot hit admin routes -> 403
        assert (await ac.get("/api/v1/vehicles/admin/pending",
                headers=_h(t_drv))).status_code == 403

        # 8. edit color -> resets to pending (safety rule)
        upd = await ac.patch("/api/v1/vehicles/" + vid, json={"color": "Red"},
                             headers=_h(t_drv))
        assert upd.status_code == 200, upd.text
        assert upd.json()["color"] == "Red"
        assert upd.json()["verification_status"] == "pending"

        # 9. delete (soft) -> gone from default list, visible with flag
        assert (await ac.delete("/api/v1/vehicles/" + vid,
                headers=_h(t_drv))).status_code == 200
        assert (await ac.get("/api/v1/vehicles", headers=_h(t_drv))).json() == []
        flagged = await ac.get("/api/v1/vehicles?include_inactive=true", headers=_h(t_drv))
        assert len(flagged.json()) == 1 and flagged.json()[0]["is_active"] is False

    for p in (drv, pax, adm):
        await db.users.delete_many({"phone": p})
    await db.vehicles.delete_many({"plate_no": "KA05MN4321"})
