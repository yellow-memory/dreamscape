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

app.get("/", (req, res) => {
  res.render("results");
});

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
      res.status(200).json({ data: data.data });
    } else {
      res.status(200).json({ data: [] }); // Empty array if no data
    }
  } catch (error) {
    console.error("=============> Error fetching domain availability:", error);
    res.status(500).json({ error: "Failed to fetch domain availability" });
  }
});

// Payment endpoint (as per your setup)
app.post("/create-payment-intent", async (req, res) => {
  const { amount } = req.query;
  const {
    paymentMethodId,
    domain,
    registrant,
    emailPackagePrice,
    selectedEmailPackage,
  } = req.body;

  console.log("=================> create payment intent ");

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

      if (selectedEmailPackage) {
        await registerEmailPackage(domain, selectedEmailPackage, registrant);
      }

      // const response = await registerDomain(domain, registrant);

      // res.json(response);
    } else {
      console.log("============> payment error");
      res.status(400).json({ error: "Payment failed." });
    }
  } catch (error) {
    console.error("Payment error:", error);
    res.status(500).json({ error: "Payment processing failed." });
  }
});

app.post("/registrant", async (req, res) => {
  const data = req.body;

  console.log("=================> registrant data: ", data);

  try {
    const customerId = await registerCustomer(data);

    try {
      const registrantResult = await createRegistration(data);

      if (registrantResult.status) {
        res.status(200).json({ status: true, customer: customerId });
      }
    } catch (error) {
      console.error("Error registering registrant:", error);
      res.status(500).json({ error: "Failed to register registrant." });
    }
  } catch (error) {
    console.error("Error registering customer:", error);
    res.status(500).json({ error: "Failed to register customer." });
  }
});

async function registerEmailPackage(
  domain,
  selectedEmailPackage,
  registrantData
) {
  const requestId = generateRequestID();
  const signature = generateSignature(requestId, apiKey);

  const emailPackageUrl = constants.urls.emailPackageRegister;

  let plan_id = "";

  switch (selectedEmailPackage) {
    case "basic":
      plan_id = 47;
      break;
    case "standard":
      plan_id = 48;
      break;
    case "business":
      plan_id = 49;
      break;
    default:
      plan_id = "";
  }

  try {
    const customerId = await registerCustomer(registrantData);

    console.log("=================> email package request:", plan_id); // Log request for debugging

    const emailPackageResponse = await fetch(emailPackageUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        "Api-Request-Id": requestId,
        "Api-Signature": signature,
        "Reseller-ID": resellerId,
      },
      body: JSON.stringify({
        domain,
        plan_id: plan_id,
        customer_id: customerId,
        period: 12,
      }),
    });

    const emailPackageResult = await emailPackageResponse.json();
    if (emailPackageResult.status) {
      console.log(
        "============> Email package registered successfully ",
        emailPackageResult
      );
    } else {
      throw new Error(emailPackageResult.error_message);
    }
  } catch (error) {
    console.error("Error registering email package:", error);
    throw new Error("Failed to register email package");
  }
}

async function registerCustomer(registrantData) {
  const requestId = generateRequestID();
  const signature = generateSignature(requestId, apiKey);

  const customerUrl = constants.urls.customerRegister;

  try {
    const customerResponse = await fetch(customerUrl, {
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

    const customerResult = await customerResponse.json();
    if (customerResult.status) {
      console.log(
        "============> Customer registered successfully ",
        customerResult
      );
      return customerResult.data.id;
    } else {
      throw new Error(customerResult.error_message);
    }
  } catch (error) {
    console.error("Error registering customer:", error);
    throw new Error("Failed to register customer");
  }
}

async function createRegistration(registrantData) {
  const requestId = generateRequestID();
  const signature = generateSignature(requestId, apiKey);

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

    return { status: registrantResult.status, data: registrantResult.data };
  } catch (error) {
    return { status: false, error_message: "Failed to register domain" };
  }
}

async function registerDomain(domain, registrantData) {
  console.log(
    "========== Registering domain ",
    domain,
    " : with registrant ",
    registrantData
  );

  const customerId = await registerCustomer(registrantData);
  const registrantResult = await createRegistration(registrantData);

  if (registrantResult.status) {
    const requestId = generateRequestID();
    const signature = generateSignature(requestId, apiKey);

    const registerUrl = constants.urls.domainRegister;
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
        period: 12,
        customer_id: customerId,
      }),
    });

    const domainData = await domainResponse.json();

    console.log("============> domainData API Response:", domainData); // Log API response for debugging

    if (!domainData.status) {
      return { status: false, error_message: domainData.error_message };
    } else {
      return {
        status: true,
        domain: domain,
      };
    }
  } else {
    return { status: false, error_message: registrantResult.error_message };
  }
}

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
