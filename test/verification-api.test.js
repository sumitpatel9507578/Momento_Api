process.env.DB_HOST = process.env.DB_HOST || "127.0.0.1";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_NAME = process.env.DB_NAME || "momento_test";
process.env.JWT_SECRET = "test-only-jwt-secret";

const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, beforeEach, test } = require("node:test");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const db = require("../src/config/db");

let server;
let baseUrl;
let application;
let followersCount;
let accountAgeDays;
let userVerified;
let reviewHistory;

function userColumns() {
  return [
    "id",
    "username",
    "email",
    "bio",
    "full_name",
    "profile_image",
    "created_at",
    "is_verified",
    "role",
  ].map((Field) => ({ Field }));
}

async function fakeQuery(sql, params = []) {
  const normalizedSql = sql.replace(/\s+/g, " ").trim();
  if (normalizedSql.startsWith("SELECT id, role FROM users WHERE id = ?")) {
    const id = Number(params[0]);
    return [[{ id, role: id === 99 ? "admin" : "user" }], []];
  }
  if (normalizedSql === "SHOW COLUMNS FROM users") {
    return [userColumns(), []];
  }
  if (normalizedSql.startsWith("SELECT u.id, u.username, u.bio")) {
    return [
      [
        {
          id: Number(params[0]),
          username: "verified-user",
          bio: "Creator",
          full_name: "Verified User",
          profile_image: "https://cdn.example/profile.jpg",
          created_at: new Date(Date.now() - accountAgeDays * 86400000),
          is_verified: userVerified ? 1 : 0,
          followers_count: followersCount,
        },
      ],
      [],
    ];
  }
  if (
    normalizedSql.startsWith("SELECT id, status FROM verification_applications") ||
    normalizedSql.startsWith("SELECT id, status, application_data")
  ) {
    return [[], []];
  }
  if (normalizedSql.startsWith("SELECT COUNT(*) AS total")) {
    if (normalizedSql.includes("FROM verification_applications a")) {
      return [[{ total: 1 }], []];
    }
    return [
      [{ total: 2, pending: 1, approved: 1, rejected: 0 }],
      [],
    ];
  }
  if (normalizedSql.startsWith("SELECT a.id, a.user_id, a.status")) {
    return [
      [
        {
          id: 1,
          user_id: 7,
          status: "submitted",
          application_data: { country: "Canada" },
          requested_details: null,
          resubmit_requested: 0,
          document_public_id: null,
          document_resource_type: null,
          document_format: null,
          username: "verified-user",
          email: "verified@example.test",
          full_name: "Verified User",
          is_verified: 0,
        },
      ],
      [],
    ];
  }
  throw new Error(`Unexpected verification test SQL: ${normalizedSql}`);
}

async function connectionQuery(sql, params = []) {
  const normalizedSql = sql.replace(/\s+/g, " ").trim();
  if (normalizedSql.startsWith("SELECT id, user_id, status FROM verification_applications")) {
    return [
      application && String(application.id) === String(params[0])
        ? [{ id: application.id, user_id: application.user_id, status: application.status }]
        : [],
      [],
    ];
  }
  if (normalizedSql.startsWith("SELECT id, application_data FROM verification_applications")) {
    return [
      application &&
      application.user_id === Number(params[0]) &&
      application.status === "under_review" &&
      application.resubmit_requested
        ? [{ id: application.id, application_data: application.application_data }]
        : [],
      [],
    ];
  }
  if (normalizedSql.startsWith("UPDATE verification_applications SET status = ?")) {
    const [status, requestedDetails, resubmitRequested, id] = params;
    Object.assign(application, {
      status,
      requested_details: requestedDetails,
      resubmit_requested: resubmitRequested,
    });
    return [{ affectedRows: 1 }, []];
  }
  if (normalizedSql.startsWith("UPDATE verification_applications SET application_data = ?")) {
    const [serializedData, publicId, resourceType, format, id] = params;
    assert.equal(String(application.id), String(id));
    application.application_data = JSON.parse(serializedData);
    application.document_public_id = publicId || application.document_public_id;
    application.document_resource_type = resourceType || application.document_resource_type;
    application.document_format = format || application.document_format;
    application.status = "submitted";
    application.resubmit_requested = 0;
    application.requested_details = null;
    return [{ affectedRows: 1 }, []];
  }
  if (normalizedSql.startsWith("UPDATE users SET is_verified = ?")) {
    userVerified = Boolean(params[0]);
    return [{ affectedRows: 1 }, []];
  }
  if (normalizedSql.startsWith("INSERT INTO verification_review_history")) {
    reviewHistory.push(params);
    return [{ insertId: reviewHistory.length, affectedRows: 1 }, []];
  }
  throw new Error(`Unexpected verification transaction SQL: ${normalizedSql}`);
}

async function request(path, { userId = 7, body, headers = {}, ...options } = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    body,
    headers: {
      ...(body === undefined || body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${jwt.sign({ id: userId }, process.env.JWT_SECRET)}`,
      ...headers,
    },
  });
}

before(async () => {
  db.query = fakeQuery;
  db.getConnection = async () => ({
    beginTransaction: async () => {},
    query: connectionQuery,
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  });
  server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  application = {
    id: 4,
    user_id: 7,
    status: "submitted",
    application_data: { country: "Canada" },
    requested_details: null,
    resubmit_requested: 0,
  };
  followersCount = 5000;
  accountAgeDays = 91;
  userVerified = false;
  reviewHistory = [];
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.end();
});

test("eligibility uses the follower, account-age, and completed-profile thresholds", async () => {
  const eligible = await request("/api/verification/eligibility");
  assert.equal(eligible.status, 200);
  const eligibleData = (await eligible.json()).data;
  assert.equal(eligibleData.eligible, true);
  assert.equal(eligibleData.requirements.followers.met, true);
  assert.equal(eligibleData.requirements.accountAgeDays.met, true);
  assert.equal(eligibleData.requirements.profileComplete.met, true);

  followersCount = 4999;
  const belowThreshold = await request("/api/verification/eligibility");
  assert.equal((await belowThreshold.json()).data.eligible, false);
});

test("verification status and application endpoints require authentication and an ID upload", async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/verification/status`);
  assert.equal(unauthenticated.status, 401);

  const form = new FormData();
  const missingDocument = await request("/api/verification/apply", {
    method: "POST",
    body: form,
  });
  assert.equal(missingDocument.status, 400);
});

test("admin verification APIs enforce database roles and return statistics and filtered applications", async () => {
  const forbidden = await request("/api/admin/verification/stats");
  assert.equal(forbidden.status, 403);

  const stats = await request("/api/admin/verification/stats", { userId: 99 });
  assert.equal(stats.status, 200);
  assert.deepEqual((await stats.json()).data, {
    total: 2,
    pending: 1,
    approved: 1,
    rejected: 0,
  });

  const applications = await request(
    "/api/admin/verification/applications?status=submitted&search=verified",
    { userId: 99 },
  );
  assert.equal(applications.status, 200);
  const body = await applications.json();
  assert.equal(body.data.applications[0].status, "submitted");
  assert.equal(body.data.pagination.total, 1);
});

test("admin can request additional details and a user can resubmit them", async () => {
  const review = await request("/api/admin/verification/review", {
    method: "POST",
    userId: 99,
    body: JSON.stringify({
      application_id: 4,
      action: "request_info",
      note: "Please add your passport country",
    }),
  });
  assert.equal(review.status, 200);
  assert.equal(application.resubmit_requested, 1);

  const resubmission = await request("/api/verification/resubmit", {
    method: "POST",
    body: JSON.stringify({
      application_data: JSON.stringify({ passportCountry: "Canada" }),
    }),
  });
  assert.equal(resubmission.status, 200);
  assert.equal(application.status, "submitted");
  assert.deepEqual(application.application_data, {
    country: "Canada",
    passportCountry: "Canada",
  });
  assert.equal(application.resubmit_requested, 0);
});

test("admin approval updates the account verification flag", async () => {
  const approval = await request("/api/admin/verification/review", {
    method: "POST",
    userId: 99,
    body: JSON.stringify({ application_id: 4, action: "approve" }),
  });
  assert.equal(approval.status, 200);
  assert.equal(application.status, "approved");
  assert.equal(userVerified, true);
});
