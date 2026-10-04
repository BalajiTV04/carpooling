// Recurring series (Module 15): groups + driver index.
db.recurring_groups.createIndex({ group_id: 1 }, { unique: true, name: "uq_recurring_group" });
db.recurring_groups.createIndex({ driver_id: 1, active: 1 }, { name: "ix_recurring_driver" });
print("recurring indexes ok");