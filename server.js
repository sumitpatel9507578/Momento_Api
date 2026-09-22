require("dotenv").config();

const app = require("./src/app");
const db = require("./src/config/db");

const PORT = process.env.PORT || 3000;

// Verify the database before starting the HTTP server
async function startServer() {
  try {
    const connection = await db.getConnection();
    connection.release();
    console.log("Database connected successfully");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error(
      `Database connection failed at ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}. ` +
        "Start MySQL or update DB_HOST/DB_USER/DB_PASSWORD/DB_NAME in .env.",
    );
    console.error({
      code: error.code,
      errno: error.errno,
      message: error.message,
    });
    process.exitCode = 1;
  }
}

startServer();

//////////////////////////////////////////////////////////////////////////////////////////////////////
