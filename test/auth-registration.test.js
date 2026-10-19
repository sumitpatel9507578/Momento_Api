process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_NAME = process.env.DB_NAME || "momento_test";
process.env.JWT_SECRET = "test-only-jwt-secret";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");
const authController = require("../src/controllers/authController");
const db = require("../src/config/db");
const userModel = require("../src/models/userModel");

function mockAuthModel(t) {
  const originalMethods = {
    getUserByEmail: userModel.getUserByEmail,
    createUser: userModel.createUser,
    getUserById: userModel.getUserById,
    saveAuthTokens: userModel.saveAuthTokens,
  };
  let createdRole;

  userModel.getUserByEmail = async () => null;
  userModel.createUser = async (...args) => {
    createdRole = args[6];
    return 42;
  };
  userModel.getUserById = async () => ({
    id: 42,
    username: "test-user",
    email: "test@example.com",
    role: createdRole,
  });
  userModel.saveAuthTokens = async () => true;

  t.after(() => Object.assign(userModel, originalMethods));
  return {
    get createdRole() {
      return createdRole;
    },
  };
}

async function register(body) {
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await authController.register({ body }, response);
  return response;
}

test("admin registration persists the verified role and includes it in the access token", async (t) => {
  const model = mockAuthModel(t);
  const previousCode = process.env.ADMIN_REGISTRATION_CODE;
  process.env.ADMIN_REGISTRATION_CODE = "admin-secret";
  t.after(() => {
    if (previousCode === undefined) delete process.env.ADMIN_REGISTRATION_CODE;
    else process.env.ADMIN_REGISTRATION_CODE = previousCode;
  });

  const response = await register({
    username: " test-user ",
    email: " test@example.com ",
    password: "password",
    registrationType: "admin",
    adminCode: " admin-secret ",
  });

  assert.equal(response.statusCode, 201);
  assert.equal(model.createdRole, "admin");
  assert.equal(response.payload.data.user.role, "admin");
  assert.equal(jwt.verify(response.payload.data.token, process.env.JWT_SECRET).role, "admin");
});

test("admin registration rejects an invalid authorization code before creating an account", async (t) => {
  const model = mockAuthModel(t);
  const previousCode = process.env.ADMIN_REGISTRATION_CODE;
  process.env.ADMIN_REGISTRATION_CODE = "admin-secret";
  t.after(() => {
    if (previousCode === undefined) delete process.env.ADMIN_REGISTRATION_CODE;
    else process.env.ADMIN_REGISTRATION_CODE = previousCode;
  });

  const response = await register({
    username: "test-user",
    email: "test@example.com",
    password: "password",
    registrationType: "admin",
    adminCode: "wrong-code",
  });

  assert.equal(response.statusCode, 403);
  assert.equal(model.createdRole, undefined);
});

test("admin registration reports missing server configuration without creating an account", async (t) => {
  const model = mockAuthModel(t);
  const previousCode = process.env.ADMIN_REGISTRATION_CODE;
  delete process.env.ADMIN_REGISTRATION_CODE;
  t.after(() => {
    if (previousCode !== undefined) process.env.ADMIN_REGISTRATION_CODE = previousCode;
  });

  const response = await register({
    username: "test-user",
    email: "test@example.com",
    password: "password",
    registrationType: "admin",
    adminCode: "admin-secret",
  });

  assert.equal(response.statusCode, 500);
  assert.equal(model.createdRole, undefined);
});

test("ordinary registration ignores a client-supplied admin role", async (t) => {
  const model = mockAuthModel(t);

  const response = await register({
    username: "test-user",
    email: "test@example.com",
    password: "password",
    role: "admin",
  });

  assert.equal(response.statusCode, 201);
  assert.equal(model.createdRole, "user");
  assert.equal(response.payload.data.user.role, "user");
});

test("user creation writes the supplied role when the users schema supports it", async (t) => {
  const originalQuery = db.query;
  let insertQuery;
  let insertParams;
  db.query = async (query, params) => {
    if (query.startsWith("SHOW COLUMNS FROM users")) {
      return [[
        "username",
        "email",
        "password",
        "role",
      ].map((Field) => ({ Field }))];
    }
    insertQuery = query;
    insertParams = params;
    return [{ insertId: 42 }];
  };
  t.after(() => {
    db.query = originalQuery;
  });

  const id = await userModel.createUser(
    "test-user",
    "test@example.com",
    "hashed-password",
    "Test User",
    null,
    null,
    "admin",
  );

  assert.equal(id, 42);
  assert.match(insertQuery, /role/);
  assert.equal(insertParams.at(-1), "admin");
});
