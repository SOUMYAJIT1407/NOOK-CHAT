/**
 * models/User.js — account schema.
 * `password` is a bcrypt hash. `googleId` is set for accounts created / linked through Google.
 * `photo` is a /avatars/... path (uploaded) or an https URL (Google profile picture).
 */

import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: true
    },
    // Set when the account was created / linked through "Continue with Google".
    googleId: {
      type: String,
      default: undefined,
      index: { unique: true, sparse: true }
    },
    photo: {
      type: String,
      default: ""
    },
    bio: {
      type: String,
      default: ""
    },
    isOnline: {
      type: Boolean,
      default: false
    },
    lastSeen: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
