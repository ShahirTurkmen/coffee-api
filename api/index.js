const express = require("express");
const app = express();
const coffees = require("./coffees.json");
const path = require("path");
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

app.use("/images", express.static(path.join(__dirname, "images")));
app.listen(3000, () => console.log("Server ready on port 3000"));

module.exports = app;
