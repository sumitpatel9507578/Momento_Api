const { v2: cloudinary } = require("cloudinary");
require("dotenv").config();

const sanitize = (value) =>
  typeof value === "string" ? value.trim().replace(/,$/, "") : value;

cloudinary.config({
  cloud_name: sanitize(process.env.CLOUDINARY_CLOUD_NAME),
  api_key: sanitize(process.env.CLOUDINARY_API_KEY),
  api_secret: sanitize(process.env.CLOUDINARY_API_SECRET),
});

module.exports = cloudinary;
