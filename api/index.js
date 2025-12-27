const express = require("express");
const app = express();
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const { createClient } = require("@supabase/supabase-js");

let coffees = [];
try {
  coffees = require("./coffees.json");
} catch (err) {
  throw new Error("Failed to load coffees.json: " + (err.message || err));
}

let supabase = null;
let supabaseReady = false;

async function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    console.warn(
      "SUPABASE_URL or SUPABASE_KEY not set — using local coffees.json for reads only."
    );
    return;
  }
  try {
    supabase = createClient(url, key);
    await new Promise((resolve) => setTimeout(resolve, 2000)); // wait a bit for supabase to be ready
    // quick test to ensure credentials work
    const { data: test, error: testErr } = await supabase
      .from("coffees")
      .select("id")
      .limit(1);
    if (testErr && testErr.code === "42P01") {
      // table doesn't exist
      console.warn(
        "Supabase 'coffees' table not found — reads will still fall back to coffees.json until table is created."
      );
    }
    supabaseReady = true;
    console.log("Supabase client initialized");

    // seed if empty and local coffees available
    try {
      const { data: existing } = await supabase
        .from("coffees")
        .select("id")
        .limit(1);
      if (
        (!existing || existing.length === 0) &&
        Array.isArray(coffees) &&
        coffees.length > 0
      ) {
        const docs = coffees.map((c) => ({
          name: c.name,
          image: c.image,
          description: c.description,
          id: c.id,
        }));
        await supabase.from("coffees").insert(docs);
        console.log("Seeded supabase 'coffees' table from coffees.json");
      }
    } catch (err) {
      console.warn("Supabase seed check/insert failed:", err.message || err);
    }
  } catch (err) {
    console.error("Failed to initialize Supabase:", err);
    supabaseReady = false;
  }
}

await initSupabase();
// Middleware to parse JSON bodies

app.use(express.json());
app.get("/", (req, res) => res.send("Express on Vercel"));

app.get("/coffees", async (req, res) => {
  if (supabaseReady && supabase) {
    try {
      const { data, error } = await supabase
        .from("coffees")
        .select("*")
        .order("id", { ascending: true });
      if (error) {
        console.error(error);
        return res.status(500).json({ error: "DB error" });
      }
      return res.json(data);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "DB error" });
    }
  }
  res.status(503).json({ error: "Database not configured" });
});

app.get("/coffee/:id", async (req, res) => {
  const param = req.params.id;
  if (supabaseReady && supabase) {
    try {
      // try numeric id first
      const n = parseInt(param, 10);
      if (!isNaN(n)) {
        const { data, error } = await supabase
          .from("coffees")
          .select("*")
          .eq("id", n)
          .limit(1)
          .single();
        if (error && error.code !== "PGRST116") {
          // PGRST116: No rows found for single()
          console.error(error);
        }
        if (data) return res.json(data);
      }

      // try by primary key id (uuid or serial)
      const { data: byId, error: byIdErr } = await supabase
        .from("coffees")
        .select("*")
        .eq("id", param)
        .limit(1)
        .single();
      if (byIdErr && byIdErr.code !== "PGRST116") console.error(byIdErr);
      if (byId) return res.json(byId);

      return res.status(404).json({ error: "Coffee not found" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "DB error" });
    }
  }
  //   const id = parseInt(param, 10);
  //   const coffee = coffees.find((c) => c.id === id);
  //   if (!coffee) return res.status(404).json({ error: "Coffee not found" });
  //   res.json(coffee);
  res.status(503).json({ error: "Database not configured" });
});

// Find by name (case-insensitive exact match)
app.get("/coffee/name/:name", async (req, res) => {
  const nameParam = decodeURIComponent(req.params.name);
  if (supabaseReady && supabase) {
    try {
      const { data, error } = await supabase
        .from("coffees")
        .select("*")
        .ilike("name", nameParam)
        .limit(1)
        .single();
      if (error && error.code !== "PGRST116") {
        console.error(error);
        return res.status(500).json({ error: "DB error" });
      }
      if (!data) return res.status(404).json({ error: "Coffee not found" });
      return res.json(data);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "DB error" });
    }
  }
  res.status(503).json({ error: "Database not configured" });
  //   const name = nameParam.toLowerCase();
  //   const coffee = coffees.find((c) => c.name.toLowerCase() === name);
  //   if (!coffee) return res.status(404).json({ error: "Coffee not found" });
  //   res.json(coffee);
});

// Search by description substring (case-insensitive)
app.get("/coffee/desc/:desc", async (req, res) => {
  const descParam = decodeURIComponent(req.params.desc);
  if (supabaseReady && supabase) {
    try {
      const { data, error } = await supabase
        .from("coffees")
        .select("*")
        .ilike("description", `%${descParam}%`);
      if (error) {
        console.error(error);
        return res.status(500).json({ error: "DB error" });
      }
      return res.json(data || []);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "DB error" });
    }
  }
  //   const desc = descParam.toLowerCase();
  //   const results = coffees.filter((c) =>
  //     c.description.toLowerCase().includes(desc)
  //   );
  //   res.json(results);
  res.status(503).json({ error: "Database not configured" });
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
  if (!supabaseReady || !supabase)
    return res
      .status(503)
      .json({ error: "Database not configured for write operations" });
  try {
    const n = parseInt(param, 10);
    let target = null;
    if (!isNaN(n)) {
      const { data, error } = await supabase
        .from("coffees")
        .select("*")
        .eq("id", n)
        .limit(1)
        .single();
      if (error && error.code !== "PGRST116") console.error(error);
      if (data) target = data;
    }
    if (!target) {
      const { data: byId, error: byIdErr } = await supabase
        .from("coffees")
        .select("*")
        .eq("id", param)
        .limit(1)
        .single();
      if (byIdErr && byIdErr.code !== "PGRST116") console.error(byIdErr);
      if (byId) target = byId;
    }
    if (!target) return res.status(404).json({ error: "Coffee not found" });

    const updates = {};
    const { name, description } = req.body;
    if (name) updates.name = name;
    if (description) updates.description = description;
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: "No updatable fields provided" });

    // perform update
    let updateQuery = supabase.from("coffees");
    if (target.id) updateQuery = updateQuery.eq("id", target.id);
    else if (target.id) updateQuery = updateQuery.eq("id", target.id);
    const { data: updated, error: updateErr } = await updateQuery
      .update(updates)
      .select("*")
      .single();
    if (updateErr) {
      console.error(updateErr);
      return res.status(500).json({ error: "Failed to update coffee" });
    }
    res.json(updated);
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
  if (!supabaseReady || !supabase)
    return res
      .status(503)
      .json({ error: "Database not configured for write operations" });
  const { name, image, description } = req.body;
  if (!name) return res.status(400).json({ error: "Missing 'name'" });
  try {
    // prevent duplicates by name (case-insensitive)
    try {
      const { data: exists, error: existsErr } = await supabase
        .from("coffees")
        .select("*")
        .ilike("name", name)
        .limit(1)
        .single();
      if (exists)
        return res.status(409).json({ error: "Coffee already exists" });
      if (existsErr && existsErr.code !== "PGRST116") console.error(existsErr);
    } catch (e) {
      // continue — duplicate check failed but we'll try insert and let DB error surface
      console.warn("Duplicate check failed:", e && e.message ? e.message : e);
    }
    // calculate next id if present
    const { data: maxRow, error: maxErr } = await supabase
      .from("coffees")
      .select("id")
      .not("id", "is", null)
      .order("id", { ascending: false })
      .limit(1)
      .single();
    if (maxErr && maxErr.code !== "PGRST116") console.error(maxErr);
    const id = maxRow && maxRow.id ? maxRow.id + 1 : undefined;
    const payload = {
      name,
      image: image || "",
      description: description || "",
    };
    if (id) payload.id = id;
    const { data, error } = await supabase
      .from("coffees")
      .insert([payload])
      .select("*")
      .single();
    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Failed to save new coffee" });
    }
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save new coffee", err });
  }
});

app.use("/images", express.static(path.join(__dirname, "images")));
app.listen(3000, () => console.log("Server ready on port 3000"));
