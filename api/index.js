const express = require("express");
const app = express();
let coffees = require("./coffees.json");
const path = require("path");
const fs = require("fs").promises;

app.use(express.json());
app.get("/", (req, res) => res.send("Express on Vercel"));

app.get("/coffees", (req, res) => {
  res.json(coffees);
});

app.get("/coffee/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const coffee = coffees.find((c) => c.id === id);
  if (!coffee) return res.status(404).json({ error: "Coffee not found" });
  res.json(coffee);
});

// Find by name (case-insensitive exact match)
app.get("/coffee/name/:name", (req, res) => {
  const name = decodeURIComponent(req.params.name).toLowerCase();
  const coffee = coffees.find((c) => c.name.toLowerCase() === name);
  if (!coffee) return res.status(404).json({ error: "Coffee not found" });
  res.json(coffee);
});

// Search by description substring (case-insensitive)
app.get("/coffee/desc/:desc", (req, res) => {
  const desc = decodeURIComponent(req.params.desc).toLowerCase();
  const results = coffees.filter((c) =>
    c.description.toLowerCase().includes(desc)
  );
  res.json(results);
});

async function saveCoffees() {
  const file = path.join(__dirname, "coffees.json");
  await fs.writeFile(file, JSON.stringify(coffees, null, 2), "utf8");
}

// Patch name and/or description for a coffee by id
app.patch("/coffee/:id", async (req, res) => {
  const provided =
    req.header("x-api-secret") || req.body.api_secret || req.query.api_secret;
  const API_SECRET = process.env.API_SECRET;
  if (!provided || provided !== API_SECRET)
    return res.status(401).json({ error: "Unauthorized" });

  const id = parseInt(req.params.id, 10);
  const coffee = coffees.find((c) => c.id === id);
  if (!coffee) return res.status(404).json({ error: "Coffee not found" });
  const { name, description } = req.body;
  if (name) coffee.name = name;
  if (description) coffee.description = description;
  try {
    await saveCoffees();
    res.json(coffee);
  } catch (err) {
    res.status(500).json({ error: "Failed to save coffee" });
  }
});

// Protected endpoint to add a new coffee
app.post("/add-coffee", async (req, res) => {
  const provided =
    req.header("x-api-secret") || req.body.api_secret || req.query.api_secret;
  const API_SECRET = process.env.API_SECRET;
  if (!provided || provided !== API_SECRET)
    return res.status(401).json({ error: "Unauthorized" });

  const { name, image, description } = req.body;
  if (!name) return res.status(400).json({ error: "Missing 'name'" });

  const maxId = coffees.reduce((max, c) => Math.max(max, c.id), 0);
  const newCoffee = {
    id: maxId + 1,
    name,
    image: image || "",
    description: description || "",
  };
  coffees.push(newCoffee);
  try {
    await saveCoffees();
    res.status(201).json(newCoffee);
  } catch (err) {
    res.status(500).json({ error: "Failed to save new coffee", err: err });
  }
});

app.use("/images", express.static(path.join(__dirname, "images")));
app.listen(3000, () => console.log("Server ready on port 3000"));

module.exports = app;
