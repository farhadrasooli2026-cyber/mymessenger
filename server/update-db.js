const db = require("./database");
try { db.prepare( "ALTER TABLE users ADD COLUMN gender TEXT DEFAULT 'female'" ).run();
console.log("Gender column added successfully");
} catch (error) { if (error.message.includes("duplicate column name")) { console.log("Gender column already exists"); } else { console.error(error); } }