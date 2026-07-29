const express = require("express");
const router = express.Router();

const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bucket = require("../gcs");

const axios = require("axios");

// Temporary uploads folder
const uploadDir = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
    dest: uploadDir
});

const uploadFields = upload.fields([
    { name: "proofOfIdentity", maxCount: 1 },
    { name: "proofOfAddress", maxCount: 1 },
    { name: "proofOfDOB", maxCount: 1 }
]);

router.post("/", uploadFields, async (req, res) => {

    try {

        const customerDid = req.body.customerDid;

        if (!customerDid) {
            return res.status(400).json({
                success: false,
                message: "Customer DID is required"
            });
        }

        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No documents uploaded"
            });
        }

        const customerFolder = customerDid.replace(/:/g, "_");

        // Check customer exists
        const customerFile = bucket.file(
            `customers/${customerFolder}/customer.json`
        );

        const [exists] = await customerFile.exists();

        if (!exists) {

            Object.values(req.files).flat().forEach(file => {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            });

            return res.status(404).json({
                success: false,
                message: "Invalid Customer DID. Customer not found."
            });
        }

        // Read users.json
        const usersFile = bucket.file("users/users.json");
        const [usersContents] = await usersFile.download();
        const users = JSON.parse(usersContents.toString());

        const userIndex = users.findIndex(
            user => user.customerDid === customerDid
        );

        if (userIndex === -1) {

            Object.values(req.files).flat().forEach(file => {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            });

            return res.status(404).json({
                success: false,
                message: "Customer not found in users.json"
            });
        }

        if (!users[userIndex].documents) {
            users[userIndex].documents = {};
        }

        const uploadedDocuments = [];

        // Process each uploaded document
        let identityHash = "";
        let addressHash = "";
        let dobHash = "";
        for (const [documentCategory, files] of Object.entries(req.files)) {

            const file = files[0];

            // Example:
            // proofOfIdentity -> Passport
            // proofOfAddress -> Driving Licence
            const selectedDocumentType =
                req.body[`${documentCategory}Type`] || "";

            // Read uploaded file
            const fileBuffer = fs.readFileSync(file.path);

            // Generate SHA-256 hash
            const fileHash = crypto
                .createHash("sha256")
                .update(fileBuffer)
                .digest("hex");
            if (documentCategory === "proofOfIdentity") {
                identityHash = fileHash;
                }
            if (documentCategory === "proofOfAddress") {
            addressHash = fileHash;
                }
            if (documentCategory === "proofOfDOB") {
                dobHash = fileHash;
            }    


            // Preserve original extension
            const extension = path.extname(file.originalname);

            // Store using category as filename
            const destination =
                `customers/${customerFolder}/${documentCategory}${extension}`;

            // Upload to Google Cloud Storage
            await bucket.upload(file.path, {
                destination
            });

            // Save metadata
            users[userIndex].documents[documentCategory] = {
                documentType: selectedDocumentType,
                fileName: file.originalname,
                hash: fileHash,
                uploadedAt: new Date().toISOString()
            };

            uploadedDocuments.push({
                documentCategory,
                documentType: selectedDocumentType,
                fileName: file.originalname,
                bucketPath: destination,
                hash: fileHash
            });

            // Delete temp file
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        }

        // Save updated users.json
        await usersFile.save(
            JSON.stringify(users, null, 2),
            {
                contentType: "application/json"
            }
        );

        // ------------------------------
        // Verify KYC on Universal Ledger
        // ------------------------------

        const user = users[userIndex];
        const productType = Object.keys(user.products)[0];

        const ledgerResponse = await axios.post(
            "https://flask-server-385567705550.us-central1.run.app/ledger/verify-kyc",
            {
                participant_account_id: user.ledgerAccountId,
                contract_id: user.ledgerContractId,
                customer_did: user.customerDid,
                product_type: productType,
                identity_hash: identityHash,
                address_hash: addressHash,
                dob_hash: dobHash,
                verified_by: productType,
                verified_timestamp: new Date().toISOString()
            }
        );

        res.status(200).json({
            success: true,
            message: "Documents uploaded and KYC verified successfully",
            customerDid,
            documents: uploadedDocuments,
            ledger: ledgerResponse.data
        });

    } catch (err) {

        // Clean up temp files
        if (req.files) {
            Object.values(req.files).flat().forEach(file => {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            });
        }

        console.error(err);

        res.status(500).json({
            success: false,
            message: "Upload failed",
            error: err.message
        });
    }

});

module.exports = router;