const express = require("express");
const router = express.Router();

const crypto = require("crypto");
const bucket = require("../gcs");

router.post("/", async (req, res) => {

    try {

        const { email, password, productType } = req.body;

        if (!email || !password || !productType) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        // Hash entered password
        const hashedPassword = crypto
            .createHash("sha256")
            .update(password)
            .digest("hex");

        const usersFile = bucket.file("users/users.json");

        const [exists] = await usersFile.exists();

        if (!exists) {
            return res.status(404).json({
                success: false,
                message: "No registered customers found."
            });
        }

        const [contents] = await usersFile.download();
        const users = JSON.parse(contents.toString());

        // Find user by email
        const existingUser = users.find(
            user => user.email.toLowerCase() === email.toLowerCase()
        );

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        // Check whether the user has registered for this product
        if (
            !existingUser.products ||
            !existingUser.products[productType]
        ) {
            return res.status(404).json({
                success: false,
                message: `User is not registered for ${productType}.`
            });
        }

        // Verify password
        if (
            existingUser.products[productType].hashedPassword !== hashedPassword
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid password."
            });
        }

        const sampleReq = await axios.post("https://flask-server-385567705550.us-central1.run.app/ledger/query-contract", {
            "contract_id": "1:CTR:00443aKgJA2TaQMtJZf4jzhLpULPEb4DEuNfAQEL8WFd8"
        });

        console.log("Sample request response:", sampleReq);

        return res.status(200).json({
            success: true,
            message: "Login successful.",
            customerDid: existingUser.customerDid,
            name: existingUser.name,
            email: existingUser.email,
            productType,
            kycStatus: existingUser.kycStatus || "Unverified",
            kycHistory: existingUser.kycHistory || []
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

module.exports = router;