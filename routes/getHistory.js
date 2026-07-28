const express = require("express");
const router = express.Router();

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

        return res.status(200).json({
            success: true,
            customerDid,
            name: customer.name,
            kycStatus: customer.kycStatus || "Unverified",
            kycHistory: customer.kycHistory || []
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