/**
 * tests/helpers/fakeDb.js — a tiny in-memory stand-in for MongoDB, used ONLY by the automated tests.
 * ------------------------------------------------------------------------------------------
 * The tests must run anywhere (CI, a laptop with no database), so instead of connecting to MongoDB
 * this file replaces the query methods of the real Mongoose models (User, FriendRequest, Message)
 * with versions that work on plain arrays. The application code under test is the REAL code —
 * services, routes and socket handlers — only the storage layer underneath is swapped.
 *
 * It implements exactly the MongoDB behaviour the app relies on, including the easy-to-get-wrong
 * parts: `$ne` and plain equality on ARRAY fields ("array contains"), a missing field matching
 * `{ $ne: true }`, `$or`, `$in`, `$regex`, `$set` / `$unset` / `$addToSet`, dotted paths ("file.stored").
 * It is NOT a full MongoDB: run the app against a real database before going live.
 */
import mongoose from "mongoose";
import User from "../../models/User.js";
import FriendRequest from "../../models/FriendRequest.js";
import Message from "../../models/Message.js";

const MODELS = { User, FriendRequest, Message };
export const store = { User: [], FriendRequest: [], Message: [] };

/** Forget everything (call between tests). */
export function resetDb() {
  for (const key of Object.keys(store)) store[key].length = 0;
}

// ----- query matching ---------------------------------------------------------------------------

const same = (a, b) => {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return String(a) === String(b);
};

/** Read a (possibly dotted) path from a document; ObjectIds stay objects, subdocuments become plain objects. */
function getPath(obj, path) {
  return path.split(".").reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    const next = typeof value.get === "function" && !(value instanceof Map) && value.$__ ? value.get(key) : value[key];
    return next;
  }, obj);
}

/** MongoDB equality: for an array field, "equals" means "contains". */
function eq(field, wanted) {
  if (wanted === null) return field === null || field === undefined;
  if (Array.isArray(field)) return field.some((item) => same(item, wanted));
  if (field === undefined || field === null) return false;
  return same(field, wanted);
}

function matchCondition(field, cond) {
  const isOperatorObject = cond && typeof cond === "object" && !(cond instanceof Date) && !(cond instanceof mongoose.Types.ObjectId) && Object.keys(cond).some((k) => k.startsWith("$"));
  if (!isOperatorObject) return eq(field, cond);

  return Object.entries(cond).every(([op, value]) => {
    switch (op) {
      case "$ne": return !eq(field, value);
      case "$in": return value.some((v) => eq(field, v));
      case "$nin": return !value.some((v) => eq(field, v));
      case "$exists": return (field !== undefined && field !== null) === Boolean(value);
      case "$regex": {
        const re = value instanceof RegExp ? value : new RegExp(value, cond.$options || "");
        return typeof field === "string" && re.test(field);
      }
      case "$options": return true;
      case "$gt": return field > value;
      case "$lt": return field < value;
      default: throw new Error(`fakeDb: unsupported operator ${op}`);
    }
  });
}

export function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return cond.some((f) => matches(doc, f));
    if (key === "$and") return cond.every((f) => matches(doc, f));
    return matchCondition(getPath(doc, key), cond);
  });
}

// ----- chainable query object (find().sort().limit()...) ----------------------------------------

class Query {
  constructor(modelName, filter, { single = false } = {}) {
    this.modelName = modelName; this.filter = filter || {}; this.single = single;
    this._sort = null; this._limit = null; this._populate = [];
  }
  select() { return this; }
  lean() { return this; }
  sort(spec) { this._sort = typeof spec === "string" ? { [spec.replace(/^-/, "")]: spec.startsWith("-") ? -1 : 1 } : spec; return this; }
  limit(n) { this._limit = n; return this; }
  populate(paths) { this._populate.push(...String(paths).split(/\s+/).filter(Boolean)); return this; }

  async exec() {
    let docs = store[this.modelName].filter((doc) => matches(doc, this.filter));
    if (this._sort) {
      const keys = Object.entries(this._sort);
      const compare = (x, y) => (x instanceof Date || y instanceof Date ? new Date(x) - new Date(y) : String(x).localeCompare(String(y)));
      docs = [...docs].sort((a, b) => {
        for (const [key, dir] of keys) {
          const cmp = compare(getPath(a, key), getPath(b, key));
          if (cmp) return cmp * (dir < 0 ? -1 : 1);
        }
        return 0;
      });
    }
    if (this._limit != null) docs = docs.slice(0, this._limit);
    if (this._populate.length) docs = docs.map((doc) => this.applyPopulate(doc));
    return this.single ? docs[0] || null : docs;
  }

  /** Replace sender / receiver ids with the full user documents (what Mongoose populate does). */
  applyPopulate(doc) {
    const copy = { ...doc.toObject(), _id: doc._id };
    for (const path of this._populate) copy[path] = store.User.find((u) => same(u._id, doc[path])) || doc[path];
    return copy;
  }

  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }
}

// ----- update operators ---------------------------------------------------------------------------

function applyUpdate(doc, update) {
  const ops = Object.keys(update).some((k) => k.startsWith("$")) ? update : { $set: update };
  for (const [path, value] of Object.entries(ops.$set || {})) doc.set(path, value);
  for (const path of Object.keys(ops.$unset || {})) doc.set(path, undefined);
  for (const [path, value] of Object.entries(ops.$addToSet || {})) {
    const list = doc.get(path) || [];
    if (!list.some((item) => same(item, value))) doc.set(path, [...list, value]);
  }
  doc.markModified?.("reactions");
}

const clone = (modelName, doc) => new MODELS[modelName](doc.toObject());

// ----- install --------------------------------------------------------------------------------------

let installed = false;

/** Replace the Mongoose model methods with in-memory versions. Safe to call more than once. */
export function installFakeDb() {
  if (installed) return;
  installed = true;

  for (const [name, Model] of Object.entries(MODELS)) {
    Model.find = (filter) => new Query(name, filter);
    Model.findOne = (filter) => new Query(name, filter, { single: true });
    Model.findById = (id) => new Query(name, { _id: id }, { single: true });
    Model.exists = async (filter) => { const doc = store[name].find((d) => matches(d, filter)); return doc ? { _id: doc._id } : null; };
    Model.countDocuments = async (filter) => store[name].filter((d) => matches(d, filter)).length;
    Model.deleteOne = async (filter) => {
      const index = store[name].findIndex((d) => matches(d, filter));
      if (index >= 0) store[name].splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    };
    Model.create = async (data) => { const doc = new Model(data); await doc.validate(); store[name].push(doc); doc.isNew = false; return doc; };
    Model.findOneAndUpdate = async (filter, update, options = {}) => {
      const doc = store[name].find((d) => matches(d, filter));
      if (!doc) return null;
      const before = clone(name, doc);
      applyUpdate(doc, update);
      return options.new ? doc : before;
    };
    Model.findByIdAndUpdate = (id, update, options) => Model.findOneAndUpdate({ _id: id }, update, options);
    Model.updateMany = async (filter, update) => {
      const docs = store[name].filter((d) => matches(d, filter));
      docs.forEach((d) => applyUpdate(d, update));
      return { modifiedCount: docs.length, matchedCount: docs.length };
    };
    Model.prototype.save = async function save() {
      await this.validate();
      if (!store[name].includes(this)) store[name].push(this);
      this.isNew = false;
      return this;
    };
  }
}

// ----- small builders used by the tests -------------------------------------------------------------

let counter = 0;

/** Create a user directly in the fake database. */
export async function makeUser(username, extra = {}) {
  counter += 1;
  return User.create({ username, email: `${username.toLowerCase()}${counter}@example.com`, password: "x".repeat(10), ...extra });
}

/** Make two users friends. */
export async function makeFriends(a, b, status = "accepted") {
  return FriendRequest.create({ sender: a._id, receiver: b._id, status });
}
