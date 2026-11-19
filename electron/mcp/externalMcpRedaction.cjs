"use strict";
const { randomBytes } = require("node:crypto");
const { BlockList, isIP } = require("node:net");
const { RE2JS } = require("re2js");
module.exports = require("../../domain/aiPrivacyRedaction.shared.cjs").createPrivacyRedaction({randomBytes, BlockList, isIP, RE2JS, Buffer});
