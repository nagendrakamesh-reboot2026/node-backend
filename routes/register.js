const express = require("express");
const router = express.Router();

const axios = require("axios");

const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const bucket = require("../gcs");

router.post("/", async (req, res) => {

    try {

        const { name, email, password, productType } = req.body;

        if (!name || !email || !password || !productType) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        const hashedPassword = crypto
            .createHash("sha256")
            .update(password)
            .digest("hex");

        const usersFile = bucket.file("users/users.json");

        let users = [];

        const [exists] = await usersFile.exists();

        if (exists) {
            const [contents] = await usersFile.download();
            users = JSON.parse(contents.toString());
        }

        // Check whether user already exists
        const existingUser = users.find(
            user => user.email.toLowerCase() === email.toLowerCase()
        );

        if (existingUser) {

            // Create products object if missing
            if (!existingUser.products) {
                existingUser.products = {};
            }

            // Product already registered
            if (existingUser.products[productType]) {
                return res.status(409).json({
                    success: false,
                    message: `Already registered for ${productType}`,
                    customerDid: existingUser.customerDid
                });
            }

            // Register new product
            existingUser.products[productType] = {
                hashedPassword
            };

            await usersFile.save(
                JSON.stringify(users, null, 2),
                {
                    contentType: "application/json"
                }
            );

            return res.status(200).json({
                success: true,
                message: `${productType} registered successfully`,
                customerDid: existingUser.customerDid,
                name: existingUser.name,
                email: existingUser.email,
                productType
            });
        }

        // --------------------------
        // New Customer Registration
        // --------------------------

        const customerDid = "did:bank:" + uuidv4();
        const ledgerResponse = await axios.post(
        "https://flask-server-385567705550.us-central1.run.app/ledger/create-account",{});
        const ledgerAccountId = ledgerResponse.data.ledger.account_id;
        const ledgerContractId = ledgerResponse.data.ledger.contract_id;
                                                        
        

        const newUser = {
            customerDid,
            ledgerAccountId,
            ledgerContractId,
            name,
            email,
            products: {
                [productType]: {
                    hashedPassword
                }
            },
            kycStatus: {[productType]: "Registered"},
            kycHistory: []
        };

        users.push(newUser);

        // Save users.json
        await usersFile.save(
            JSON.stringify(users, null, 2),
            {
                contentType: "application/json"
            }
        );

        // Save customer.json
        const customer = {
            customerDid,
            ledgerAccountId,
            ledgerContractId,
            name,
            email
        };

        await bucket.file(
            `customers/${customerDid.replace(/:/g, "_")}/customer.json`
        ).save(
            JSON.stringify(customer, null, 2),
            {
                contentType: "application/json"
            }
        );

        res.status(201).json({
            success: true,
            message: "Customer Registered Successfully",
            customerDid,
            ledgerAccountId,
            ledgerContractId,
            name,
            email,
            productType
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

module.exports = router;