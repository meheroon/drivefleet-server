const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }

    req.user = decoded;
    next();
  });
};

async function run() {
  await client.connect();
  console.log("MongoDB connected successfully");

  const db = client.db("driveFleetDB");
  const carsCollection = db.collection("cars");
  const bookingsCollection = db.collection("bookings");

  app.post("/jwt", async (req, res) => {
    const user = req.body;
    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });

    res
      .cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      })
      .send({ success: true });
  });

  app.post("/logout", (req, res) => {
    res
      .clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      })
      .send({ success: true });
  });

  app.get("/cars", async (req, res) => {
  try {
    const { search, type, limit } = req.query;
    const query = {};

    if (search) {
      query.carName = { $regex: search, $options: "i" };
    }

    if (type && type !== "all") {
      query.carType = type;
    }

    const cursor = carsCollection.find(query).sort({ createdAt: -1 });
    const result = limit
      ? await cursor.limit(Number(limit)).toArray()
      : await cursor.toArray();

    res.send(result);
  } catch (error) {
    console.error("Cars API error:", error.message);
    res.status(500).send({
      message: "Failed to load cars",
      error: error.message,
    });
  }
});

  app.get("/cars/:id", async (req, res) => {
    const result = await carsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    res.send(result);
  });

  app.post("/cars", verifyToken, async (req, res) => {
    const car = {
      ...req.body,
      booking_count: 0,
      createdAt: new Date(),
    };

    const result = await carsCollection.insertOne(car);
    res.send(result);
  });

  app.get("/my-cars", verifyToken, async (req, res) => {
    if (req.query.email !== req.user.email) {
      return res.status(403).send({ message: "Forbidden access" });
    }

    const result = await carsCollection
      .find({ ownerEmail: req.query.email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(result);
  });

  app.patch("/cars/:id", verifyToken, async (req, res) => {
    const result = await carsCollection.updateOne(
      {
        _id: new ObjectId(req.params.id),
        ownerEmail: req.user.email,
      },
      {
        $set: req.body,
      }
    );

    res.send(result);
  });

  app.delete("/cars/:id", verifyToken, async (req, res) => {
    const result = await carsCollection.deleteOne({
      _id: new ObjectId(req.params.id),
      ownerEmail: req.user.email,
    });

    res.send(result);
  });

  app.post("/bookings", verifyToken, async (req, res) => {
    const booking = {
      ...req.body,
      bookingDate: new Date(),
    };

    const bookingResult = await bookingsCollection.insertOne(booking);

    await carsCollection.updateOne(
      { _id: new ObjectId(booking.carId) },
      { $inc: { booking_count: 1 } }
    );

    res.send(bookingResult);
  });

  app.get("/bookings", verifyToken, async (req, res) => {
    if (req.query.email !== req.user.email) {
      return res.status(403).send({ message: "Forbidden access" });
    }

    const result = await bookingsCollection
      .find({ userEmail: req.query.email })
      .sort({ bookingDate: -1 })
      .toArray();

    res.send(result);
  });

  app.get("/", (req, res) => {
    res.send("DriveFleet server is running");
  });
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`DriveFleet server running on port ${port}`);
});