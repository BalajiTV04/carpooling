// phone_otps: single-use dev OTPs. TTL on expires_at auto-deletes (10 min).
db.phone_otps.createIndex({ phone: 1 }, { name: "ix_otps_phone" });
db.phone_otps.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: "ttl_otps_expiry" });
print("otp indexes ok");