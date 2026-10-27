const router = require("express").Router();
const { login } = require("../controllers/adminauthController");

router.post("/login", login);

module.exports = router;
