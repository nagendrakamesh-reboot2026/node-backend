const { Storage } = require("@google-cloud/storage");

const storage = new Storage();

const bucketName = "reboot-renegades-kyc-backend";

const bucket = storage.bucket(bucketName);

module.exports = bucket;