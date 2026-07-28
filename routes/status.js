const express = require("express");
const router = express.Router();

const bucket = require("../gcs");

router.post("/", async (req, res) => {

    try {

        const { customerDid, kycStatus, productType } = req.body;

        if (!customerDid || !kycStatus || !productType) {
            return res.status(400).json({
                success: false,
                message: "customerDid, kycStatus, and productType are required"
            });
        }

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

        const userIndex = users.findIndex(
            user => user.customerDid === customerDid
        );

        if (userIndex === -1) {
            return res.status(404).json({
                success: false,
                message: "Customer not found."
            });
        }

        // Update KYC status
        users[userIndex].kycStatus[productType] = kycStatus;

        // Save updated users.json
        await usersFile.save(
            JSON.stringify(users, null, 2),
            {
                contentType: "application/json"
            }
        );

        return res.status(200).json({
            success: true,
            message: "KYC status updated successfully.",
            customerDid,
            kycStatus,
            productType
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