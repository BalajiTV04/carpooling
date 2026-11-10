"""Seed demo driver + passenger accounts for the live admin demo.

Inserts accounts directly into MongoDB (bypassing schema validation so the
admin username "Admin" and demo E.164 phones can coexist). Registration can
never self-create the admin role, so direct DB insert is the supported path.
"""
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, ".")

from app.core.database import get_client
from app.core.config import get_settings
from app.core.security import hash_password

DEMO_PASSWORD = "pass1234"
NOW = datetime.now(timezone.utc)

ACCOUNTS = [
    {
        "phone": "+919000000002",
        "full_name": "Rahul Sharma",
        "roles": ["driver"],
        "driver_approval": "approved",
    },
    {
        "phone": "+919000000003",
        "full_name": "Priya Singh",
        "roles": ["passenger"],
        "driver_approval": None,
    },
    {
        "phone": "+919000000004",
        "full_name": "Amit Patel",
        "roles": ["driver", "passenger"],
        "driver_approval": "approved",
    },
]


async def main() -> None:
    settings = get_settings()
    client = get_client()
    db = client[settings.MONGO_DB]

    for acc in ACCOUNTS:
        doc = {
            "phone": acc["phone"],
            "password_hash": hash_password(DEMO_PASSWORD),
            "full_name": acc["full_name"],
            "roles": acc["roles"],
            "phone_verified": True,
            "status": "active",
            "driver_approval": acc["driver_approval"],
            "driver_approval_note": None,
            "driver_approval_at": NOW if acc["driver_approval"] else None,
            "driver_approval_by": None,
            "rating_avg": None,
            "rating_count": 0,
            "created_at": NOW,
            "updated_at": NOW,
        }
        await db.users.update_one(
            {"phone": acc["phone"]},
            {"$set": doc},
            upsert=True,
            bypass_document_validation=True,
        )
        print(
            f"Seeded {acc['phone']}  {acc['full_name']}  roles={acc['roles']}"
        )


if __name__ == "__main__":
    asyncio.run(main())
