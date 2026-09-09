const userModel = require("../models/userModel");

// Get the currently authenticated user's profile
async function getMe(req, res) {
  try {
    const user = await userModel.getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "User profile fetched successfully",
      data: user,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Registration failed",
      data: null,
    });
  }
}

module.exports = {
  getMe,
};
