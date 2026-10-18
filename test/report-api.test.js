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
let storedReports = [];
let reviewHistory = [];
let deletedTargets = new Set();
let nextReportId = 1;

function ownerFor(targetType, targetId) {
  if (deletedTargets.has(`${targetType}:${targetId}`)) return null;
  if (targetType === "user") {
    return targetId === 404 ? null : { ownerId: targetId };
  }
  if (targetType === "message") {
    return targetId === 20
      ? { id: 20, sender_id: 8, receiver_id: 7, ownerId: 8 }
      : targetId === 21
        ? { id: 21, sender_id: 7, receiver_id: 8, ownerId: 7 }
        : null;
  }
  const owners = {
    post: targetId === 71 ? 7 : 8,
    reel: 9,
    story: 8,
    comment: 9,
  };
  if (targetId === 404) return null;
  return { ownerId: owners[targetType] };
}

function reportRow(report) {
  return {
    ...report,
    reporter_username: `user-${report.reporter_id}`,
    reporter_name: `User ${report.reporter_id}`,
    reporter_profile_image: null,
    reported_username: report.reported_user_id
      ? `user-${report.reported_user_id}`
      : null,
    reported_name: report.reported_user_id
      ? `User ${report.reported_user_id}`
      : null,
    reported_profile_image: null,
    reviewer_username: report.reviewed_by
      ? `user-${report.reviewed_by}`
      : null,
  };
}

function filtersFor(sql, params) {
  let index = 0;
  const status = sql.includes("r.status = ?") ? params[index++] : null;
  const targetType = sql.includes("r.target_type = ?")
    ? params[index++]
    : null;
  const reason = sql.includes("r.reason = ?") ? params[index++] : null;
  let search = null;
  let numericSearch = null;
  if (sql.includes("reporter.username LIKE ?")) {
    if (sql.includes("r.id = ?")) {
      numericSearch = params[index];
      search = params[index + 3].slice(1, -1);
    } else {
      search = params[index].slice(1, -1);
    }
  }
  return { status, targetType, reason, search, numericSearch };
}

function filterReports(sql, params) {
  const filters = filtersFor(sql, params);
  return storedReports.filter((report) => {
    if (filters.status && report.status !== filters.status) return false;
    if (filters.targetType && report.target_type !== filters.targetType) {
      return false;
    }
    if (filters.reason && report.reason !== filters.reason) return false;
    if (filters.numericSearch) {
      const search = String(filters.numericSearch);
      if (
        ![
          report.id,
          report.reporter_id,
          report.reported_user_id,
        ].some((value) => String(value) === search)
      ) {
        return false;
      }
    }
    if (
      filters.search &&
      ![report.reporter_id, report.reported_user_id].some((id) =>
        `user-${id}`.includes(filters.search),
      ) &&
      !String(report.id).includes(filters.search)
    ) {
      return false;
    }
    return true;
  });
}

async function fakeQuery(sql, params = []) {
  const normalizedSql = sql.replace(/\s+/g, " ").trim();
  if (normalizedSql.startsWith("SELECT id, role FROM users WHERE id = ?")) {
    const id = Number(params[0]);
    return [
      id === 404
        ? []
        : [{ id, role: id === 99 ? "admin" : "user" }],
      [],
    ];
  }
  if (
    normalizedSql.startsWith(
      "SELECT id, status, admin_note FROM reports WHERE id = ?",
    )
  ) {
    const report = storedReports.find(
      (item) => String(item.id) === String(params[0]),
    );
    return [
      report
        ? [
            {
              id: report.id,
              status: report.status,
              admin_note: report.admin_note,
            },
          ]
        : [],
      [],
    ];
  }
  if (normalizedSql.startsWith("UPDATE reports SET status = ?")) {
    const [status, adminNote, reviewedBy, id] = params;
    const report = storedReports.find(
      (item) => String(item.id) === String(id),
    );
    if (!report) return [{ affectedRows: 0 }, []];
    Object.assign(report, {
      status,
      admin_note: adminNote,
      reviewed_by: reviewedBy,
      reviewed_at: new Date(),
    });
    return [{ affectedRows: 1 }, []];
  }
  if (normalizedSql.startsWith("INSERT INTO report_review_history")) {
    const [reportId, previousStatus, newStatus, adminId, adminNote] = params;
    reviewHistory.push({
      report_id: reportId,
      previous_status: previousStatus,
      new_status: newStatus,
      admin_id: adminId,
      admin_note: adminNote,
      created_at: new Date(),
    });
    return [{ insertId: reviewHistory.length, affectedRows: 1 }, []];
  }
  if (normalizedSql.startsWith("SELECT h.id, h.previous_status")) {
    return [
      reviewHistory
        .filter((entry) => String(entry.report_id) === String(params[0]))
        .map((entry, index) => ({
          id: index + 1,
          ...entry,
          admin_username: `user-${entry.admin_id}`,
        })),
      [],
    ];
  }
  if (normalizedSql.startsWith("SELECT COUNT(*) AS report_count")) {
    return [
      [
        {
          report_count: storedReports.filter(
            (report) => report.reporter_id === Number(params[0]),
          ).length,
        },
      ],
      [],
    ];
  }
  if (normalizedSql.startsWith("SELECT id FROM users WHERE id = ?")) {
    const id = Number(params[0]);
    return [id === 404 ? [] : [{ id }], []];
  }

  const contentOwnerMatch = normalizedSql.match(
    /^SELECT id, user_id AS owner_id FROM (posts|reels|stories|comments) WHERE id = \?/,
  );
  if (contentOwnerMatch) {
    const targetType = {
      posts: "post",
      reels: "reel",
      stories: "story",
      comments: "comment",
    }[contentOwnerMatch[1]];
    const target = ownerFor(targetType, Number(params[0]));
    return [target ? [{ id: Number(params[0]), owner_id: target.ownerId }] : [], []];
  }
  if (
    normalizedSql.startsWith(
      "SELECT id, sender_id, receiver_id FROM messages WHERE id = ? AND",
    )
  ) {
    const target = ownerFor("message", Number(params[0]));
    return [
      target && [target.sender_id, target.receiver_id].includes(Number(params[1]))
        ? [target]
        : [],
      [],
    ];
  }
  if (normalizedSql.startsWith("SELECT id FROM reports")) {
    const existing = storedReports.find(
      (report) =>
        report.reporter_id === Number(params[0]) &&
        report.target_type === params[1] &&
        report.target_id === String(params[2]) &&
        ["open", "under_review"].includes(report.status),
    );
    return [existing ? [{ id: existing.id }] : [], []];
  }
  if (normalizedSql.startsWith("INSERT INTO reports")) {
    const [reporterId, reportedUserId, targetType, targetId, reason, message] =
      params;
    const id = nextReportId++;
    storedReports.push({
      id,
      reporter_id: Number(reporterId),
      reported_user_id: reportedUserId == null ? null : Number(reportedUserId),
      target_type: targetType,
      target_id: String(targetId),
      reason,
      message,
      status: "open",
      admin_note: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return [{ insertId: id, affectedRows: 1 }, []];
  }
  if (normalizedSql.startsWith("SELECT COUNT(*) AS total")) {
    return [[{ total: filterReports(normalizedSql, params).length }], []];
  }
  if (
    normalizedSql.startsWith("SELECT r.id, r.reporter_id") &&
    normalizedSql.includes("FROM reports r")
  ) {
    if (normalizedSql.includes("WHERE r.id = ?")) {
      const report = storedReports.find(
        (item) => String(item.id) === String(params[0]),
      );
      return [report ? [reportRow(report)] : [], []];
    }
    const filtered = filterReports(normalizedSql, params);
    const limit = Number(params.at(-2));
    const offset = Number(params.at(-1));
    return [
      filtered
        .slice(offset, offset + limit)
        .map(reportRow),
      [],
    ];
  }
  if (normalizedSql.startsWith("SELECT id, username, full_name AS name")) {
    const id = Number(params[0]);
    const target = ownerFor("user", id);
    return [
      target
        ? [
            {
              id,
              username: `user-${id}`,
              name: `User ${id}`,
              profile_image: null,
              bio: "",
              created_at: new Date(),
            },
          ]
        : [],
      [],
    ];
  }
  if (normalizedSql.startsWith("SELECT id, user_id, caption, media_url")) {
    const id = Number(params[0]);
    const target = ownerFor("post", id);
    return [
      target
        ? [
            {
              id,
              user_id: target.ownerId,
              caption: "Post content",
              media_url: "https://cdn.example/post.jpg",
              media_type: "image",
              created_at: new Date(),
            },
          ]
        : [],
      [],
    ];
  }
  if (normalizedSql.startsWith("SELECT id, user_id, caption, video_url")) {
    const id = Number(params[0]);
    const target = ownerFor("reel", id);
    return [
      target
        ? [{ id, user_id: target.ownerId, caption: "Reel content" }]
        : [],
      [],
    ];
  }
  if (normalizedSql.startsWith("SELECT id, user_id, caption, media_url")) {
    const id = Number(params[0]);
    const target = ownerFor("story", id);
    return [target ? [{ id, user_id: target.ownerId }] : [], []];
  }
  if (normalizedSql.startsWith("SELECT id, user_id, post_id, reel_id, comment")) {
    const id = Number(params[0]);
    const target = ownerFor("comment", id);
    return [target ? [{ id, user_id: target.ownerId, comment: "Comment" }] : [], []];
  }
  if (normalizedSql.startsWith("SELECT id, sender_id, receiver_id, message")) {
    const id = Number(params[0]);
    const target = ownerFor("message", id);
    return [target ? [{ ...target, message: "Reported message" }] : [], []];
  }
  throw new Error(`Unexpected SQL in report test: ${normalizedSql}`);
}

async function request(path, options = {}) {
  const { authUserId = 7, authToken, ...requestOptions } = options;
  return fetch(`${baseUrl}${path}`, {
    ...requestOptions,
    headers: {
      ...(requestOptions.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(requestOptions.headers || {}),
      Authorization:
        authToken ||
        `Bearer ${jwt.sign({ id: authUserId }, process.env.JWT_SECRET)}`,
    },
  });
}

before(async () => {
  db.query = fakeQuery;
  db.getConnection = async () => ({
    beginTransaction: async () => {},
    query: fakeQuery,
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
  storedReports = [];
  reviewHistory = [];
  deletedTargets = new Set();
  nextReportId = 1;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.end();
});

test("authenticated users can report each target type with server-resolved ownership", async () => {
  const targets = [
    { target_type: "post", target_id: 70, ownerId: 8, reporter: 7 },
    { target_type: "reel", target_id: 80, ownerId: 9, reporter: 8 },
    { target_type: "story", target_id: 90, ownerId: 8, reporter: 9 },
    { target_type: "comment", target_id: 60, ownerId: 9, reporter: 10 },
    { target_type: "message", target_id: 20, ownerId: 8, reporter: 7 },
    { target_type: "user", target_id: 8, ownerId: 8, reporter: 11 },
  ];
  for (const target of targets) {
    const response = await request("/api/reports", {
      method: "POST",
      authUserId: target.reporter,
      body: JSON.stringify({
        target_type: target.target_type,
        target_id: target.target_id,
        reason: "spam",
        message: "Please review this",
        reporter_id: 404,
      }),
    });
    assert.equal(response.status, 201, target.target_type);
    const { data } = await response.json();
    const saved = storedReports.find((report) => report.id === data.id);
    assert.equal(saved.reporter_id, target.reporter);
    assert.equal(saved.reported_user_id, target.ownerId);
    assert.equal(saved.target_id, String(target.target_id));
    assert.equal(saved.status, "open");
  }
});

test("report submission rejects invalid, missing, self-owned, and unauthorized message targets", async () => {
  for (const body of [
    { target_type: "unknown", target_id: 5, reason: "spam" },
    { target_type: "post", target_id: "0", reason: "spam" },
    { target_type: "post", target_id: 5, reason: " " },
  ]) {
    const invalid = await request("/api/reports", {
      method: "POST",
      body: JSON.stringify(body),
    });
    assert.equal(invalid.status, 400);
  }

  const missing = await request("/api/reports", {
    method: "POST",
    body: JSON.stringify({ target_type: "post", target_id: 404, reason: "spam" }),
  });
  assert.equal(missing.status, 404);

  const self = await request("/api/reports", {
    method: "POST",
    body: JSON.stringify({ target_type: "post", target_id: 71, reason: "spam" }),
  });
  assert.equal(self.status, 400);

  const unrelatedMessage = await request("/api/reports", {
    method: "POST",
    authUserId: 15,
    body: JSON.stringify({
      target_type: "message",
      target_id: 20,
      reason: "harassment",
    }),
  });
  assert.equal(unrelatedMessage.status, 404);
});

test("authentication, duplicate submissions, and submission rate limits are enforced", async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_type: "post", target_id: 1, reason: "spam" }),
  });
  assert.equal(unauthenticated.status, 401);

  const first = await request("/api/reports", {
    method: "POST",
    body: JSON.stringify({
      target_type: "post",
      target_id: 40,
      reason: "spam",
      reporter_id: 99,
    }),
  });
  assert.equal(first.status, 201);
  assert.equal(storedReports[0].reporter_id, 7);

  const duplicate = await request("/api/reports", {
    method: "POST",
    body: JSON.stringify({ target_type: "post", target_id: 40, reason: "other" }),
  });
  assert.equal(duplicate.status, 409);

  for (let targetId = 41; targetId <= 44; targetId += 1) {
    const response = await request("/api/reports", {
      method: "POST",
      body: JSON.stringify({ target_type: "post", target_id: targetId, reason: "spam" }),
    });
    assert.equal(response.status, 201);
  }
  const limited = await request("/api/reports", {
    method: "POST",
    body: JSON.stringify({ target_type: "post", target_id: 45, reason: "spam" }),
  });
  assert.equal(limited.status, 429);
});

test("report requests have a bounded JSON body size and reject malformed JSON", async () => {
  const oversized = await request("/api/reports", {
    method: "POST",
    body: JSON.stringify({
      target_type: "post",
      target_id: 1,
      reason: "spam",
      message: "x".repeat(9000),
    }),
  });
  assert.equal(oversized.status, 413);

  const malformed = await fetch(`${baseUrl}/api/reports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt.sign({ id: 7 }, process.env.JWT_SECRET)}`,
    },
    body: "{",
  });
  assert.equal(malformed.status, 400);
});

test("only current database administrators can list, filter, search, and view reports", async () => {
  const created = await request("/api/reports", {
    method: "POST",
    body: JSON.stringify({
      target_type: "post",
      target_id: 30,
      reason: "spam",
      message: "Review this post",
    }),
  });
  assert.equal(created.status, 201);

  const forgedRole = await request("/api/admin/reports", {
    authToken: `Bearer ${jwt.sign(
      { id: 7, role: "admin" },
      process.env.JWT_SECRET,
    )}`,
  });
  assert.equal(forgedRole.status, 403);

  const filtered = await request(
    "/api/admin/reports?status=open&target_type=post&reason=spam&search=7",
    { authUserId: 99 },
  );
  assert.equal(filtered.status, 200);
  const list = await filtered.json();
  assert.equal(list.data.reports.length, 1);
  assert.equal(list.data.reports[0].reporter.username, "user-7");
  assert.equal(list.data.pagination.total, 1);

  deletedTargets.add("post:30");
  const details = await request("/api/admin/reports/1", { authUserId: 99 });
  assert.equal(details.status, 200);
  assert.equal((await details.json()).data.target.available, false);

  const missing = await request("/api/admin/reports/404", { authUserId: 99 });
  assert.equal(missing.status, 404);

  const invalidFilter = await request("/api/admin/reports?status=unknown", {
    authUserId: 99,
  });
  assert.equal(invalidFilter.status, 400);
});

test("admin status changes enforce transitions and write durable review history", async () => {
  const submitted = await request("/api/reports", {
    method: "POST",
    body: JSON.stringify({ target_type: "message", target_id: 20, reason: "abuse" }),
  });
  assert.equal(submitted.status, 201);

  const forbidden = await request("/api/admin/reports/1/status", {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved" }),
  });
  assert.equal(forbidden.status, 403);

  const invalidStatus = await request("/api/admin/reports/1/status", {
    method: "PATCH",
    authUserId: 99,
    body: JSON.stringify({ status: "approved" }),
  });
  assert.equal(invalidStatus.status, 400);

  const underReview = await request("/api/admin/reports/1/status", {
    method: "PATCH",
    authUserId: 99,
    body: JSON.stringify({ status: "under_review", admin_note: "Investigating" }),
  });
  assert.equal(underReview.status, 200);
  assert.equal(storedReports[0].reviewed_by, 99);
  assert.ok(storedReports[0].reviewed_at);
  assert.equal((await underReview.json()).data.status, "under_review");

  const resolved = await request("/api/admin/reports/1/status", {
    method: "PATCH",
    authUserId: 99,
    body: JSON.stringify({ status: "resolved" }),
  });
  assert.equal(resolved.status, 200);
  assert.equal(storedReports[0].status, "resolved");
  assert.equal(storedReports[0].admin_note, "Investigating");
  assert.equal(reviewHistory.length, 2);

  const invalidTransition = await request("/api/admin/reports/1/status", {
    method: "PATCH",
    authUserId: 99,
    body: JSON.stringify({ status: "dismissed" }),
  });
  assert.equal(invalidTransition.status, 409);
  assert.equal(reviewHistory.length, 2);

  const messageDetails = await request("/api/admin/reports/1", {
    authUserId: 99,
  });
  const detailBody = await messageDetails.json();
  const target = detailBody.data.target.data;
  assert.equal(target.id, 20);
  assert.equal(target.sender_id, 8);
  assert.equal(target.receiver_id, 7);
  const history = detailBody.data.reviewHistory;
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((entry) => [entry.previous_status, entry.new_status]),
    [
      ["open", "under_review"],
      ["under_review", "resolved"],
    ],
  );
});
