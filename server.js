import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import Stripe from "stripe";

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

const apiKey = "a86ee953175fb654f83bc1e1fb91cdd6"; // Your API key
const resellerId = "28076"; // Your Reseller ID
const stripeSecretKey =
  "sk_test_51IZk6CLWcouNeT9dL7L1GbbW6GbgUJg1Z6ChLOT3j5uSgl5vK8k7rrB0oQXGiB1s5GEcnemlPIRgYVgJCl7AEuPZ00xvvidDnH";
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

    let url = "https://reseller-api.ds.network/domains/availability?";
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
    console.log("============> Dreamscape API Response:", data); // Log API response for debugging

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

  try {
    // const totalAmount = parseInt(amount) + parseInt(emailPackagePrice) * 100;
    const totalAmount = parseInt(amount);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: "gbp",
      payment_method: paymentMethodId,
      confirm: true,
    });

    if (paymentIntent.status === "succeeded") {
      await registerDomain(domain, registrant);
      res.json({ message: "Payment successful! Domain registered." });
    } else {
      res.status(400).json({ error: "Payment failed." });
    }
  } catch (error) {
    console.error("Payment error:", error);
    console.log("========= Ahhhhhhhh server.js error: " + error);
    res.status(500).json({ error: "Payment processing failed." });
  }
});

async function registerDomain(domain, registrantData) {
  const requestId = generateRequestID();
  const signature = generateSignature(requestId, apiKey);

  try {
    const registrantResponse = await fetch(
      "https://reseller-api.ds.network/domains/registrants",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          "Api-Request-Id": requestId,
          "Api-Signature": signature,
          "Reseller-ID": resellerId,
        },
        body: JSON.stringify(registrantData),
      }
    );

    const registrantResult = await registrantResponse.json();
    if (registrantResult.status) {
      const domainResponse = await fetch(
        "https://reseller-api.ds.network/domains/register",
        {
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
        }
      );

      const domainData = await domainResponse.json();
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
