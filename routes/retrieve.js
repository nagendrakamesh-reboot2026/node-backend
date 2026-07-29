const express = require("express");
const router = express.Router();

const axios = require("axios");
const crypto = require("crypto");
const bucket = require("../gcs");

router.post("/", async (req, res) => {
    try {
        const { customerDid } = req.body;

        if (!customerDid) {
            return res.status(400).json({
                success: false,
                message: "customerDid is required"
            });
        }

        // Read users.json
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

        const customer = users.find(
            user => user.customerDid === customerDid
        );

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: "Customer not found."
            });
        }

        // Query Universal Ledger
        const ledgerResponse = await axios.post(
            "https://flask-server-385567705550.us-central1.run.app/ledger/query-contract",
            {
                contract_id: customer.ledgerContractId
            }
        );

        if (!ledgerResponse.data.success) {
            return res.status(500).json({
                success: false,
                message: "Failed to retrieve contract from Universal Ledger."
            });
        }

        const ledgerState = ledgerResponse.data.contract_state;

        const folder = `customers/${customerDid.replace(/:/g, "_")}/`;

        const [files] = await bucket.getFiles({
            prefix: folder
        });

        // Ignore customer.json
        const documentFiles = files.filter(file =>
            !file.name.endsWith("customer.json")
        );

        if (documentFiles.length === 0) {
            return res.status(200).json({
                success: true,
                message: "Customer found but no documents uploaded.",
                customerDid,
                name: customer.name,
                email: customer.email,
                documents: []
            });
        }

        const documents = [];

        for (const file of documentFiles) {

            const fileName = file.name.split("/").pop();

            // proofOfIdentity.pdf -> proofOfIdentity
            const documentCategory = fileName.substring(
                0,
                fileName.lastIndexOf(".")
            );

            // Download file
            const [buffer] = await file.download();

            // Generate current SHA-256 hash
            const currentHash = crypto
                .createHash("sha256")
                .update(buffer)
                .digest("hex");

            // Metadata from users.json
            const storedDocument = customer.documents?.[documentCategory];

            if (!storedDocument) {
                return res.status(400).json({
                    success: false,
                    message: `Metadata not found for ${documentCategory}`
                });
            }

            // Get expected hash from Universal Ledger
            let expectedHash = "";

            switch (documentCategory) {
                case "proofOfIdentity":
                    expectedHash = ledgerState.identity_hash;
                    break;

                case "proofOfAddress":
                    expectedHash = ledgerState.address_hash;
                    break;

                case "proofOfDOB":
                    expectedHash = ledgerState.dob_hash;
                    break;

                default:
                    continue;
            }

            // Verify integrity against Universal Ledger
            if (expectedHash !== currentHash) {
                return res.status(403).json({
                    success: false,
                    message: `${documentCategory} has been tampered with`
                });
            }

            // Generate signed URL
            const [url] = await file.getSignedUrl({
                version: "v4",
                action: "read",
                expires: Date.now() + 15 * 60 * 1000
            });

            documents.push({
                documentCategory,
                documentType: storedDocument.documentType,
                originalFileName: storedDocument.fileName,
                uploadedAt: storedDocument.uploadedAt,
                hashVerified: true,
                url
            });
        }

        res.status(200).json({
            success: true,
            message: "All documents verified successfully.",
            customerDid,
            name: customer.name,
            email: customer.email,
            verifiedBy: ledgerState.verified_by,
            verifiedAt: ledgerState.verified_timestamp,
            productType: ledgerState.product_type,
            documents
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