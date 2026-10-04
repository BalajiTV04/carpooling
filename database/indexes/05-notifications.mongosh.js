// Notifications (Module 23): per-user feed + one-per-user dedupe.
db.notifications.createIndex({ user_id: 1, created_at: -1 }, { name: "ix_notifications_user" });
db.notifications.createIndex({ user_id: 1, read_at: 1 }, { name: "ix_notifications_unread" });
// PARTIAL, not sparse: for a compound index MongoDB indexes a document when ANY
// indexed field is present, and user_id always is — so a sparse index would
// still index SOS rows (which have no dedupe_key) as null and the unique build
// would collide on the second one. The filter is the only way to say
// "index only rows that actually carry a key".
db.notifications.createIndex(
  { user_id: 1, dedupe_key: 1 },
  { unique: true, name: "uq_notifications_dedupe",
    partialFilterExpression: { dedupe_key: { $type: "string" } } }
);
print("notifications indexes ok");