const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const mongoose = require("mongoose");
const Coffee = require("./models/coffee");

let coffees = [];
try {
  coffees = require("./coffees.json");
} catch (err) {
  coffees = [];
}

let dbReady = false;

async function initDb() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.warn(
      "MONGO_URI not set — using local coffees.json for reads only."
    );
    return;
  }
  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    dbReady = true;
    console.log("Connected to MongoDB");

    const count = await Coffee.estimatedDocumentCount();
    if (count === 0 && Array.isArray(coffees) && coffees.length > 0) {
      const docs = coffees.map((c) => ({
        name: c.name,
        image: c.image,
        description: c.description,
        legacyId: c.id,
      }));
      await Coffee.insertMany(docs);
      console.log("Seeded coffees collection from coffees.json");
    }
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err);
    dbReady = false;
  }
}

initDb();

app.use(express.json());
app.get("/", (req, res) => res.send("Express on Vercel"));

app.get("/coffees", async (req, res) => {
  if (dbReady) {
    try {
      const list = await Coffee.find()
        .sort({ legacyId: 1, createdAt: 1 })
        .lean();
      return res.json(list);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "DB error" });
    }
  }
  res.json(coffees);
});

app.get("/coffee/:id", async (req, res) => {
  const param = req.params.id;
  // If DB ready, try to find by Mongo _id first, then legacyId
  if (dbReady) {
    try {
      let coffee = null;
      if (/^[0-9a-fA-F]{24}$/.test(param)) {
        coffee = await Coffee.findById(param).lean();
      }
      if (!coffee) {
        const n = parseInt(param, 10);
        if (!isNaN(n)) coffee = await Coffee.findOne({ legacyId: n }).lean();
      }
      if (!coffee) return res.status(404).json({ error: "Coffee not found" });
      return res.json(coffee);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "DB error" });
    }
  }
  const id = parseInt(param, 10);
  const coffee = coffees.find((c) => c.id === id);
  if (!coffee) return res.status(404).json({ error: "Coffee not found" });
  res.json(coffee);
});

// Find by name (case-insensitive exact match)
app.get("/coffee/name/:name", async (req, res) => {
  const nameParam = decodeURIComponent(req.params.name);
  if (dbReady) {
    try {
      const coffee = await Coffee.findOne({
        name: { $regex: `^${nameParam}$`, $options: "i" },
      }).lean();
      if (!coffee) return res.status(404).json({ error: "Coffee not found" });
      return res.json(coffee);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "DB error" });
    }
  }
  const name = nameParam.toLowerCase();
  const coffee = coffees.find((c) => c.name.toLowerCase() === name);
  if (!coffee) return res.status(404).json({ error: "Coffee not found" });
  res.json(coffee);
});

// Search by description substring (case-insensitive)
app.get("/coffee/desc/:desc", async (req, res) => {
  const descParam = decodeURIComponent(req.params.desc);
  if (dbReady) {
    try {
      const results = await Coffee.find({
        description: { $regex: descParam, $options: "i" },
      }).lean();
      return res.json(results);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "DB error" });
    }
  }
  const desc = descParam.toLowerCase();
  const results = coffees.filter((c) =>
    c.description.toLowerCase().includes(desc)
  );
  res.json(results);
});

// No file persistence for writes when using MongoDB; if DB not configured,
// protected write endpoints will return 503 to avoid EROFS issues on Vercel.

// Patch name and/or description for a coffee by id
app.patch("/coffee/:id", async (req, res) => {
  const provided =
    req.header("x-api-secret") || req.body.api_secret || req.query.api_secret;
  const API_SECRET = process.env.API_SECRET;
  if (!provided || provided !== API_SECRET)
    return res.status(401).json({ error: "Unauthorized" });
  const param = req.params.id;
  if (!dbReady)
    return res
      .status(503)
      .json({ error: "Database not configured for write operations" });
  try {
    let coffee = null;
    if (/^[0-9a-fA-F]{24}$/.test(param)) coffee = await Coffee.findById(param);
    if (!coffee) {
      const n = parseInt(param, 10);
      if (!isNaN(n)) coffee = await Coffee.findOne({ legacyId: n });
    }
    if (!coffee) return res.status(404).json({ error: "Coffee not found" });
    const { name, description } = req.body;
    if (name) coffee.name = name;
    if (description) coffee.description = description;
    await coffee.save();
    res.json(coffee);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update coffee" });
  }
});

// Protected endpoint to add a new coffee
app.post("/add-coffee", async (req, res) => {
  const provided =
    req.header("x-api-secret") || req.body.api_secret || req.query.api_secret;
  const API_SECRET = process.env.API_SECRET;
  if (!provided || provided !== API_SECRET)
    return res.status(401).json({ error: "Unauthorized" });
  if (!dbReady)
    return res
      .status(503)
      .json({ error: "Database not configured for write operations" });
  const { name, image, description } = req.body;
  if (!name) return res.status(400).json({ error: "Missing 'name'" });
  try {
    // legacyId is optional — set to max legacyId + 1 if present
    const maxLegacy = await Coffee.find({ legacyId: { $exists: true } })
      .sort({ legacyId: -1 })
      .limit(1)
      .lean();
    const legacyId =
      maxLegacy && maxLegacy.length > 0 && maxLegacy[0].legacyId
        ? maxLegacy[0].legacyId + 1
        : undefined;
    const doc = new Coffee({
      name,
      image: image || "",
      description: description || "",
      legacyId,
    });
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save new coffee" });
  }
});

app.use("/images", express.static(path.join(__dirname, "images")));
app.listen(3000, () => console.log("Server ready on port 3000"));
