"""One-time dev seed: create the admin account (phone=Admin, password=admin).

This bypasses the users-collection JSON-schema validator because the admin
identifier is a username ("Admin") rather than an E.164 phone number — which is
fine for the login path (it only does find_one by phone) but not for a normal
insert. Registration can never create admin roles, so this direct seed is the
supported path for the demo admin console.
"""
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, ".")

from app.core.database import get_client
from app.core.config import get_settings
from app.core.security import hash_password


async def main() -> None:
    settings = get_settings()
    client = get_client()
    db = client[settings.MONGO_DB]
    now = datetime.now(timezone.utc)
    doc = {
        "phone": "Admin",
        "password_hash": hash_password("admin"),
        "full_name": "Admin",
        "roles": ["admin"],
        "phone_verified": True,
        "status": "active",
        "rating_avg": None,
        "rating_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    res = await db.users.update_one(
        {"phone": "Admin"}, {"$set": doc}, upsert=True, bypass_document_validation=True
    )
    print(
        "Upserted admin user. Matched:", res.matched_count,
        "Modified:", res.modified_count, "UpsertedId:", res.upserted_id,
    )
    u = await db.users.find_one({"phone": "Admin"})
    print("Verify user exists:", bool(u), "| roles:", u.get("roles") if u else None)


if __name__ == "__main__":
    asyncio.run(main())
