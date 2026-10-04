// Ratings (Module 22): one vote per (booking, rater) + per-user review feed.
db.ratings.createIndex({ booking_id: 1, rater_id: 1 }, { unique: true, name: "uq_ratings_booking_rater" });
db.ratings.createIndex({ target_id: 1, created_at: -1 }, { name: "ix_ratings_target" });
print("ratings indexes ok");