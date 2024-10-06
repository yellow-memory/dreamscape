import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import Stripe from "stripe";
import dotenv from "dotenv";

import constants from "./config/constants.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Set up EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Serve static files from 'public'
app.use(express.static("public"));

// Parse JSON bodies
app.use(express.json());

const apiKey = process.env.API_KEY;
const resellerId = process.env.RESELLER_ID;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = new Stripe(stripeSecretKey);

const domainTypes = ["co.uk", "online", "com", "org", "org.uk"];

function generateRequestID() {
  return crypto
    .createHash("md5")
    .update(Date.now().toString() + Math.random().toString())
    .digest("hex");
}

function generateSignature(requestId, apiKey) {
  return crypto
    .createHash("md5")
    .update(requestId + apiKey)
    .digest("hex");
}

// Endpoint for checking domain availability
app.get("/domain-availability", async (req, res) => {
  const domain = req.query.domain;

  if (!domain) {
    return res.status(400).json({ error: "Domain name is required" });
  }

  try {
    const domainName = domain.split(".")[0]; // Extract base domain name
    const requestId = generateRequestID();
    const signature = generateSignature(requestId, apiKey);

    let url = constants.urls.domainAvailability + "?";

    const domainQueries = domainTypes.map(
      (type) => `domain_names[]=${domainName}.${type}`
    );
    url += domainQueries.join("&");
    url += "&currency=GBP";

    console.log("==============> Request URL:", url); // Log URL for debugging

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Api-Request-Id": requestId,
        "Api-Signature": signature,
        "Reseller-ID": resellerId,
        accept: "application/json",
      },
    });

    const data = await response.json();
    // console.log("============> Dreamscape API Response:", data); // Log API response for debugging

    if (data && Array.isArray(data.data)) {
      res.render("results", { data: data.data });
    } else {
      res.render("results", { data: [] }); // Empty array if no data
    }
  } catch (error) {
    console.error("=============> Error fetching domain availability:", error);
    res.status(500).json({ error: "Failed to fetch domain availability" });
  }
});

// Payment endpoint (as per your setup)
app.post("/create-payment-intent", async (req, res) => {
  const { amount } = req.query;
  const { paymentMethodId, domain, registrant, emailPackagePrice } = req.body;

  if (!amount || !paymentMethodId || !domain || !registrant) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const totalAmount = parseInt(amount);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: "gbp",
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
    });

    if (paymentIntent.status === "succeeded") {
      console.log("============> payment successful");
      await registerDomain(domain, registrant);
      res.json({ message: "Payment successful! Domain registered." });
    } else {
      console.log("============> payment error");
      res.status(400).json({ error: "Payment failed." });
    }
  } catch (error) {
    console.error("Payment error:", error);
    res.status(500).json({ error: "Payment processing failed." });
  }
});

async function registerDomain(domain, registrantData) {
  const requestId = generateRequestID();
  const signature = generateSignature(requestId, apiKey);

  console.log(
    "========== Registering domain ",
    domain,
    " : with registrant ",
    registrantData
  );

  const registrantUrl = constants.urls.domainResistrant;

  try {
    const registrantResponse = await fetch(registrantUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "Api-Request-Id": requestId,
        "Api-Signature": signature,
        "Reseller-ID": resellerId,
      },
      body: JSON.stringify(registrantData),
    });

    const registrantResult = await registrantResponse.json();

    console.log(
      "============> registrantResult API Response:",
      registrantResult
    ); // Log API response for debugging

    if (registrantResult.status) {
      const registerUrl = constants.urls.domainRegister;
      l;
      const domainResponse = await fetch(registerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          "Api-Request-Id": requestId,
          "Api-Signature": signature,
          "Reseller-ID": resellerId,
        },
        body: JSON.stringify({
          domain_name: domain,
          registrant_id: registrantResult.data.id,
        }),
      });

      const domainData = await domainResponse.json();

      console.log("============> domainData API Response:", domainData); // Log API response for debugging

      if (!domainData.status) throw new Error(domainData.error_message);
    } else {
      throw new Error(registrantResult.error_message);
    }
  } catch (error) {
    console.error("Registration error:", error);
    throw new Error("Registration failed.");
  }
}

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
